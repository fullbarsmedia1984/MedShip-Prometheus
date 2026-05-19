import type { SupabaseClient } from '@supabase/supabase-js'

type LinkSource =
  | 'fb_sales_orders.sf_opportunity_id'
  | 'sf_opportunities.fishbowl_so_number'
  | 'sync_events.P1_OPP_TO_SO'
  | 'fb_sales_orders.raw_data'

type LinkConfidence = 'explicit' | 'high' | 'medium' | 'low'

type SalesOrderRow = {
  id: string
  so_number: string
  sf_opportunity_id: string | null
  raw_data: unknown
}

type OpportunityRow = {
  sf_id: string
  fishbowl_so_number: string | null
}

type SyncEventRow = {
  id: string
  source_record_id: string | null
  target_record_id: string | null
  idempotency_key: string | null
  payload: unknown
  response: unknown
}

type Candidate = {
  sfOpportunityId: string
  source: LinkSource
  confidence: LinkConfidence
  rawMatchData: Record<string, unknown>
}

type CandidateSet = {
  ids: Set<string>
  samples: Array<Record<string, unknown>>
}

export type SalesOrderLinkResolverResult = {
  scanned: number
  resolved: number
  linkRowsUpserted: number
  salesOrdersUpdated: number
  skipped: number
  bySource: Record<LinkSource, number>
  skippedByReason: Record<string, number>
  samples: Array<{
    soNumber: string
    sfOpportunityId: string
    source: LinkSource
    action: 'linked' | 'already_linked'
  }>
  skippedSamples: Array<{
    soNumber: string
    reason: string
    detail?: string
  }>
}

const SALESFORCE_OPPORTUNITY_ID_REGEX = /\b006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g

const SOURCE_CONFIDENCE: Record<LinkSource, LinkConfidence> = {
  'fb_sales_orders.sf_opportunity_id': 'explicit',
  'sf_opportunities.fishbowl_so_number': 'high',
  'sync_events.P1_OPP_TO_SO': 'high',
  'fb_sales_orders.raw_data': 'medium',
}

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return String(value).trim() || null
}

function isSalesforceOpportunityId(value: unknown): value is string {
  const text = normalizeText(value)
  return Boolean(text && /^006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(text))
}

function addSkip(
  result: SalesOrderLinkResolverResult,
  soNumber: string,
  reason: string,
  detail?: string
) {
  result.skipped++
  result.skippedByReason[reason] = (result.skippedByReason[reason] ?? 0) + 1
  if (result.skippedSamples.length < 10) {
    result.skippedSamples.push({ soNumber, reason, detail })
  }
}

function addCandidate(target: Map<string, CandidateSet>, soNumber: string, sfOpportunityId: string, sample: Record<string, unknown>) {
  const existing = target.get(soNumber) ?? { ids: new Set<string>(), samples: [] }
  existing.ids.add(sfOpportunityId)
  if (existing.samples.length < 3) existing.samples.push(sample)
  target.set(soNumber, existing)
}

function extractOpportunityIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(SALESFORCE_OPPORTUNITY_ID_REGEX)) {
      ids.add(match[0])
    }
    return ids
  }

  if (Array.isArray(value)) {
    for (const item of value) extractOpportunityIds(item, ids)
    return ids
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      extractOpportunityIds(item, ids)
    }
  }

  return ids
}

function extractSalesOrderNumbers(
  value: unknown,
  numbers = new Set<string>(),
  path: string[] = []
): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) extractSalesOrderNumbers(item, numbers, path)
    return numbers
  }

  if (!value || typeof value !== 'object') return numbers

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[_\s-]/g, '').toLowerCase()
    const normalizedPath = path.join('.').toLowerCase()
    const isSalesOrderKey = [
      'sonumber',
      'salesordernumber',
      'salesorderid',
      'fishbowlsalesordernumber',
      'fishbowlsonumber',
      'targetrecordid',
    ].includes(normalizedKey)
    const isTopLevelResultNumber =
      normalizedKey === 'number' &&
      (path.length === 0 || normalizedPath === 'response' || normalizedPath.includes('salesorder'))

    if ((isSalesOrderKey || isTopLevelResultNumber) && typeof item === 'string') {
      const text = normalizeText(item)
      if (text) numbers.add(text)
    } else {
      extractSalesOrderNumbers(item, numbers, [...path, key])
    }
  }

  return numbers
}

function pickUniqueCandidate(
  candidates: Map<string, CandidateSet>,
  soNumber: string,
  source: LinkSource
): Candidate | null | 'ambiguous' {
  const candidateSet = candidates.get(soNumber)
  if (!candidateSet || candidateSet.ids.size === 0) return null
  if (candidateSet.ids.size > 1) return 'ambiguous'

  const sfOpportunityId = [...candidateSet.ids][0]
  return {
    sfOpportunityId,
    source,
    confidence: SOURCE_CONFIDENCE[source],
    rawMatchData: {
      source,
      samples: candidateSet.samples,
    },
  }
}

function pickRawDataCandidate(order: SalesOrderRow): Candidate | null | 'ambiguous' {
  const ids = extractOpportunityIds(order.raw_data)
  if (ids.size === 0) return null
  if (ids.size > 1) return 'ambiguous'

  const source: LinkSource = 'fb_sales_orders.raw_data'
  return {
    sfOpportunityId: [...ids][0],
    source,
    confidence: SOURCE_CONFIDENCE[source],
    rawMatchData: {
      source,
      matchedFrom: 'raw_data',
    },
  }
}

async function fetchOpportunityCandidates(
  supabase: SupabaseClient,
  soNumbers: string[]
): Promise<Map<string, CandidateSet>> {
  const bySoNumber = new Map<string, CandidateSet>()
  if (soNumbers.length === 0) return bySoNumber

  for (let index = 0; index < soNumbers.length; index += 100) {
    const batch = soNumbers.slice(index, index + 100)
    const { data, error } = await supabase
      .from('sf_opportunities')
      .select('sf_id, fishbowl_so_number')
      .in('fishbowl_so_number', batch)

    if (error) throw new Error(`Could not read sf_opportunities: ${error.message}`)

    for (const row of (data ?? []) as OpportunityRow[]) {
      const soNumber = normalizeText(row.fishbowl_so_number)
      if (soNumber && isSalesforceOpportunityId(row.sf_id)) {
        addCandidate(bySoNumber, soNumber, row.sf_id, {
          sfOpportunityId: row.sf_id,
          fishbowlSoNumber: soNumber,
        })
      }
    }
  }

  return bySoNumber
}

async function fetchSyncEventCandidates(
  supabase: SupabaseClient,
  soNumbers: Set<string>,
  limit: number
): Promise<Map<string, CandidateSet>> {
  const bySoNumber = new Map<string, CandidateSet>()
  if (soNumbers.size === 0) return bySoNumber

  const { data, error } = await supabase
    .from('sync_events')
    .select('id, source_record_id, target_record_id, idempotency_key, payload, response')
    .eq('automation', 'P1_OPP_TO_SO')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not read P1 sync_events: ${error.message}`)

  for (const event of (data ?? []) as SyncEventRow[]) {
    const opportunityIds = new Set<string>()
    if (isSalesforceOpportunityId(event.source_record_id)) opportunityIds.add(event.source_record_id)
    if (isSalesforceOpportunityId(event.idempotency_key)) opportunityIds.add(event.idempotency_key)
    for (const id of extractOpportunityIds(event.payload)) opportunityIds.add(id)
    for (const id of extractOpportunityIds(event.response)) opportunityIds.add(id)

    const eventSoNumbers = new Set<string>()
    const targetRecordId = normalizeText(event.target_record_id)
    if (targetRecordId) eventSoNumbers.add(targetRecordId)
    for (const number of extractSalesOrderNumbers(event.payload, new Set<string>(), ['payload'])) {
      eventSoNumbers.add(number)
    }
    for (const number of extractSalesOrderNumbers(event.response, new Set<string>(), ['response'])) {
      eventSoNumbers.add(number)
    }

    const matchedSoNumbers = [...eventSoNumbers].filter((number) => soNumbers.has(number))
    if (opportunityIds.size !== 1 || matchedSoNumbers.length !== 1) continue

    addCandidate(bySoNumber, matchedSoNumbers[0], [...opportunityIds][0], {
      syncEventId: event.id,
      targetRecordId: event.target_record_id,
      sourceRecordId: event.source_record_id,
    })
  }

  return bySoNumber
}

function chooseCandidate(
  order: SalesOrderRow,
  opportunityCandidates: Map<string, CandidateSet>,
  syncEventCandidates: Map<string, CandidateSet>
): Candidate | null | 'ambiguous_sf_opportunities' | 'ambiguous_sync_events' | 'ambiguous_raw_data' | 'invalid_explicit_opportunity_id' {
  if (order.sf_opportunity_id) {
    if (!isSalesforceOpportunityId(order.sf_opportunity_id)) return 'invalid_explicit_opportunity_id'

    const source: LinkSource = 'fb_sales_orders.sf_opportunity_id'
    return {
      sfOpportunityId: order.sf_opportunity_id,
      source,
      confidence: SOURCE_CONFIDENCE[source],
      rawMatchData: {
        source,
        matchedFrom: 'fb_sales_orders.sf_opportunity_id',
      },
    }
  }

  const sfOpportunityCandidate = pickUniqueCandidate(
    opportunityCandidates,
    order.so_number,
    'sf_opportunities.fishbowl_so_number'
  )
  if (sfOpportunityCandidate === 'ambiguous') return 'ambiguous_sf_opportunities'
  if (sfOpportunityCandidate) return sfOpportunityCandidate

  const syncEventCandidate = pickUniqueCandidate(
    syncEventCandidates,
    order.so_number,
    'sync_events.P1_OPP_TO_SO'
  )
  if (syncEventCandidate === 'ambiguous') return 'ambiguous_sync_events'
  if (syncEventCandidate) return syncEventCandidate

  const rawDataCandidate = pickRawDataCandidate(order)
  if (rawDataCandidate === 'ambiguous') return 'ambiguous_raw_data'
  if (rawDataCandidate) return rawDataCandidate

  return null
}

export async function resolveSalesOrderOpportunityLinks(
  supabase: SupabaseClient,
  options: { limit?: number; syncEventLimit?: number } = {}
): Promise<SalesOrderLinkResolverResult> {
  const result: SalesOrderLinkResolverResult = {
    scanned: 0,
    resolved: 0,
    linkRowsUpserted: 0,
    salesOrdersUpdated: 0,
    skipped: 0,
    bySource: {
      'fb_sales_orders.sf_opportunity_id': 0,
      'sf_opportunities.fishbowl_so_number': 0,
      'sync_events.P1_OPP_TO_SO': 0,
      'fb_sales_orders.raw_data': 0,
    },
    skippedByReason: {},
    samples: [],
    skippedSamples: [],
  }

  const { data: orders, error: ordersError } = await supabase
    .from('fb_sales_orders')
    .select('id, so_number, sf_opportunity_id, raw_data')
    .order('last_synced_at', { ascending: false })
    .limit(options.limit ?? 500)

  if (ordersError) throw new Error(`Could not read fb_sales_orders: ${ordersError.message}`)

  const salesOrders = (orders ?? []) as SalesOrderRow[]
  result.scanned = salesOrders.length
  if (salesOrders.length === 0) return result

  const soNumbers = salesOrders.map((order) => order.so_number)
  const soNumberSet = new Set(soNumbers)
  const [opportunityCandidates, syncEventCandidates] = await Promise.all([
    fetchOpportunityCandidates(supabase, soNumbers),
    fetchSyncEventCandidates(supabase, soNumberSet, options.syncEventLimit ?? 1000),
  ])

  const now = new Date().toISOString()
  const linkRows: Array<Record<string, unknown>> = []
  const salesOrderUpdates: Array<{ soNumber: string; sfOpportunityId: string }> = []

  for (const order of salesOrders) {
    const candidate = chooseCandidate(order, opportunityCandidates, syncEventCandidates)

    if (!candidate) {
      addSkip(result, order.so_number, 'no_match')
      continue
    }

    if (typeof candidate === 'string') {
      addSkip(result, order.so_number, candidate)
      continue
    }

    result.resolved++
    result.bySource[candidate.source] = (result.bySource[candidate.source] ?? 0) + 1

    linkRows.push({
      sf_opportunity_id: candidate.sfOpportunityId,
      so_number: order.so_number,
      relationship_source: candidate.source,
      confidence: candidate.confidence,
      is_primary: true,
      raw_match_data: candidate.rawMatchData,
      updated_at: now,
    })

    const action = order.sf_opportunity_id === candidate.sfOpportunityId
      ? 'already_linked'
      : 'linked'

    if (!order.sf_opportunity_id) {
      salesOrderUpdates.push({
        soNumber: order.so_number,
        sfOpportunityId: candidate.sfOpportunityId,
      })
    }

    if (result.samples.length < 10) {
      result.samples.push({
        soNumber: order.so_number,
        sfOpportunityId: candidate.sfOpportunityId,
        source: candidate.source,
        action,
      })
    }
  }

  if (linkRows.length > 0) {
    const { data, error } = await supabase
      .from('opportunity_sales_order_links')
      .upsert(linkRows, { onConflict: 'sf_opportunity_id,so_number' })
      .select('id')

    if (error) {
      throw new Error(`Could not upsert opportunity_sales_order_links: ${error.message}`)
    }

    result.linkRowsUpserted = data?.length ?? linkRows.length
  }

  for (const update of salesOrderUpdates) {
    const { error } = await supabase
      .from('fb_sales_orders')
      .update({ sf_opportunity_id: update.sfOpportunityId })
      .eq('so_number', update.soNumber)
      .is('sf_opportunity_id', null)

    if (error) {
      throw new Error(`Could not update fb_sales_orders ${update.soNumber}: ${error.message}`)
    }

    result.salesOrdersUpdated++
  }

  return result
}
