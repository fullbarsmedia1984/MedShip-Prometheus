// =============================================================================
// Zeus Packaging Estimator — shared LLM provider plumbing
// Providers implement one method: complete a prompt into raw JSON. Prompt
// construction, zod validation, conservative fallbacks, and call logging are
// shared here so Anthropic/OpenRouter behave identically.
// =============================================================================

import { createHash } from 'node:crypto'
import { CONSERVATIVE_ATTRIBUTES, normalizeAttributes } from '@/lib/packing-engine'
import type { PackResult } from '@/lib/packing-engine'
import {
  classificationResponseSchema,
  dimSuggestionResponseSchema,
  reviewResponseSchema,
  CLASSIFICATION_JSON_SCHEMA,
  DIM_SUGGESTION_JSON_SCHEMA,
  REVIEW_JSON_SCHEMA,
} from './schemas'
import type {
  AttributeClassification,
  DimSuggestion,
  EstimatorLlmProvider,
  ItemToClassify,
  LlmCallLogger,
  LlmPurpose,
  PackPlanFlag,
} from './types'

export interface JsonCompletion {
  data: unknown
  inputTokens: number | null
  outputTokens: number | null
}

export interface JsonCompleter {
  readonly providerName: string
  readonly model: string
  completeJson(
    system: string,
    user: string,
    jsonSchema: Record<string, unknown>
  ): Promise<JsonCompletion>
}

const CLASSIFY_SYSTEM = `You classify medical supply items for shipping. For each item, based only on its part number and description, decide:
- liquid: item contains liquid (solutions, reagents, disinfectants, media)
- fragile: breakable (glass, precision instruments, electronics)
- stackable: other boxed goods can safely sit on top of it inside a carton
- nestable: identical units nest inside each other (cups, basins, unlidded trays); nesting_factor = fraction of a unit's volume each additional nested unit consumes (e.g. 0.25). Use 0 when not nestable.
- orientation_lock: must stay upright (liquids, sealed sterile trays with gel, equipment with compressors)
- hazmat: regulated hazardous material (flammables, oxidizers, lithium batteries, compressed gas)
Set confidence to how certain you are given only the name. Be conservative: when in doubt, mark fragile, not stackable, orientation locked, and lower confidence.`

const SUGGEST_SYSTEM = `You estimate outer shipping-carton dimensions (inches) and weight (pounds) for a single medical supply item, based on its part number and description. Use typical manufacturer case/each dimensions for this kind of product. If you cannot make a reasonable estimate, set found=false. Set shipsInOwnCarton=true only for items that ship as their own sealed carton (equipment, large kits). Confidence reflects how much you are guessing. Never invent a sourceUrl — use null unless you are certain of a real product page.`

const REVIEW_SYSTEM = `You review a deterministic packing plan for a medical supply shipment and flag anomalies a shipping rep should double-check. You NEVER change numbers — you only emit short display-only flags (severity info or warning). Look for: implausible weights or dims for the item type, heavy liquids stacked in large boxes, fragile items in heavily packed cartons, suspicious quantities, and items whose description suggests attributes the plan seems to ignore. If nothing looks wrong, return an empty flags array.`

function promptHash(system: string, user: string): string {
  return createHash('sha256').update(system).update('\n').update(user).digest('hex')
}

export class JsonEstimatorLlmProvider implements EstimatorLlmProvider {
  readonly available = true

  constructor(
    private readonly completer: JsonCompleter,
    private readonly log: LlmCallLogger
  ) {}

  get name(): string {
    return this.completer.providerName
  }

  private async run<T>(
    purpose: LlmPurpose,
    system: string,
    user: string,
    jsonSchema: Record<string, unknown>,
    parse: (data: unknown) => T
  ): Promise<T> {
    const startedAt = Date.now()
    const hash = promptHash(system, user)
    try {
      const completion = await this.completer.completeJson(system, user, jsonSchema)
      const parsed = parse(completion.data)
      await this.safeLog({
        purpose,
        provider: this.completer.providerName,
        model: this.completer.model,
        promptHash: hash,
        latencyMs: Date.now() - startedAt,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        success: true,
        error: null,
        result: completion.data,
      })
      return parsed
    } catch (err) {
      await this.safeLog({
        purpose,
        provider: this.completer.providerName,
        model: this.completer.model,
        promptHash: hash,
        latencyMs: Date.now() - startedAt,
        inputTokens: null,
        outputTokens: null,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
      throw err
    }
  }

  private async safeLog(record: Parameters<LlmCallLogger>[0]): Promise<void> {
    try {
      await this.log(record)
    } catch {
      // Monitoring must never break the estimate pipeline.
    }
  }

  async classifyItemAttributes(items: ItemToClassify[]): Promise<AttributeClassification[]> {
    if (items.length === 0) return []
    const user = JSON.stringify({
      items: items.map((i) => ({ partNumber: i.partNumber, description: i.description })),
    })
    try {
      const response = await this.run(
        'classify_attributes',
        CLASSIFY_SYSTEM,
        user,
        CLASSIFICATION_JSON_SCHEMA as unknown as Record<string, unknown>,
        (data) => classificationResponseSchema.parse(data)
      )
      const byPart = new Map(response.items.map((i) => [i.partNumber, i]))
      // Every requested item gets a result; unanswered items fall back conservative.
      return items.map((item) => {
        const match = byPart.get(item.partNumber)
        if (!match) {
          return {
            partNumber: item.partNumber,
            attributes: { ...CONSERVATIVE_ATTRIBUTES },
            confidence: 0,
            rationale: 'No classification returned — conservative defaults applied.',
          }
        }
        return {
          partNumber: item.partNumber,
          attributes: normalizeAttributes(match.attributes),
          confidence: match.confidence,
          rationale: match.rationale,
        }
      })
    } catch {
      return conservativeClassifications(items)
    }
  }

  async suggestDimensions(item: ItemToClassify): Promise<DimSuggestion | null> {
    const user = JSON.stringify({ partNumber: item.partNumber, description: item.description })
    try {
      const response = await this.run(
        'suggest_dimensions',
        SUGGEST_SYSTEM,
        user,
        DIM_SUGGESTION_JSON_SCHEMA as unknown as Record<string, unknown>,
        (data) => dimSuggestionResponseSchema.parse(data)
      )
      if (!response.found || !response.lengthIn || !response.widthIn || !response.heightIn) {
        return null
      }
      return {
        lengthIn: response.lengthIn,
        widthIn: response.widthIn,
        heightIn: response.heightIn,
        weightLb: response.weightLb ?? 1,
        attributes: normalizeAttributes(response.attributes),
        shipsInOwnCarton: response.shipsInOwnCarton,
        confidence: response.confidence,
        sourceUrl: response.sourceUrl,
        rationale: response.rationale,
      }
    } catch {
      return null
    }
  }

  async reviewPackPlan(plan: PackResult, items: ItemToClassify[]): Promise<PackPlanFlag[]> {
    const user = JSON.stringify({
      items,
      plan: {
        boxes: plan.boxes,
        totals: plan.totals,
        routing: plan.routing,
        palletPlan: plan.palletPlan,
      },
    })
    try {
      const response = await this.run(
        'review_pack_plan',
        REVIEW_SYSTEM,
        user,
        REVIEW_JSON_SCHEMA as unknown as Record<string, unknown>,
        (data) => reviewResponseSchema.parse(data)
      )
      return response.flags
    } catch {
      // Review is best-effort; no flags on failure.
      return []
    }
  }
}

export function conservativeClassifications(
  items: ItemToClassify[]
): AttributeClassification[] {
  return items.map((item) => ({
    partNumber: item.partNumber,
    attributes: { ...CONSERVATIVE_ATTRIBUTES },
    confidence: 0,
    rationale: 'LLM unavailable — conservative defaults applied.',
  }))
}

/** No-op provider: pipeline never blocks on the LLM. */
export class DisabledLlmProvider implements EstimatorLlmProvider {
  readonly name = 'disabled'
  readonly available = false

  async classifyItemAttributes(items: ItemToClassify[]): Promise<AttributeClassification[]> {
    return conservativeClassifications(items)
  }

  async suggestDimensions(): Promise<DimSuggestion | null> {
    return null
  }

  async reviewPackPlan(): Promise<PackPlanFlag[]> {
    return []
  }
}
