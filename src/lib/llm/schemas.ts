// =============================================================================
// Zeus Packaging Estimator — strict zod schemas for LLM responses
// Malformed responses are rejected; the caller falls back to conservative
// defaults rather than trusting a partial parse.
// =============================================================================

import { z } from 'zod'

export const attributesSchema = z.object({
  liquid: z.boolean(),
  fragile: z.boolean(),
  stackable: z.boolean(),
  nestable: z.boolean(),
  nesting_factor: z.number().min(0).max(1),
  orientation_lock: z.boolean(),
  hazmat: z.boolean(),
})

export const classificationResponseSchema = z.object({
  items: z.array(
    z.object({
      partNumber: z.string(),
      attributes: attributesSchema,
      confidence: z.number().min(0).max(1),
      rationale: z.string(),
    })
  ),
})

export const dimSuggestionResponseSchema = z.object({
  found: z.boolean(),
  lengthIn: z.number().positive().nullable(),
  widthIn: z.number().positive().nullable(),
  heightIn: z.number().positive().nullable(),
  weightLb: z.number().min(0).nullable(),
  shipsInOwnCarton: z.boolean(),
  attributes: attributesSchema,
  confidence: z.number().min(0).max(1),
  sourceUrl: z.string().nullable(),
  rationale: z.string(),
})

export const reviewResponseSchema = z.object({
  flags: z.array(
    z.object({
      severity: z.enum(['info', 'warning']),
      message: z.string(),
    })
  ),
})

/** JSON Schema equivalents sent to the model as structured-output formats. */
export const ATTRIBUTES_JSON_SCHEMA = {
  type: 'object',
  properties: {
    liquid: { type: 'boolean' },
    fragile: { type: 'boolean' },
    stackable: { type: 'boolean' },
    nestable: { type: 'boolean' },
    nesting_factor: { type: 'number' },
    orientation_lock: { type: 'boolean' },
    hazmat: { type: 'boolean' },
  },
  required: [
    'liquid',
    'fragile',
    'stackable',
    'nestable',
    'nesting_factor',
    'orientation_lock',
    'hazmat',
  ],
  additionalProperties: false,
} as const

export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          partNumber: { type: 'string' },
          attributes: ATTRIBUTES_JSON_SCHEMA,
          confidence: { type: 'number' },
          rationale: { type: 'string' },
        },
        required: ['partNumber', 'attributes', 'confidence', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

export const DIM_SUGGESTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    lengthIn: { type: ['number', 'null'] },
    widthIn: { type: ['number', 'null'] },
    heightIn: { type: ['number', 'null'] },
    weightLb: { type: ['number', 'null'] },
    shipsInOwnCarton: { type: 'boolean' },
    attributes: ATTRIBUTES_JSON_SCHEMA,
    confidence: { type: 'number' },
    sourceUrl: { type: ['string', 'null'] },
    rationale: { type: 'string' },
  },
  required: [
    'found',
    'lengthIn',
    'widthIn',
    'heightIn',
    'weightLb',
    'shipsInOwnCarton',
    'attributes',
    'confidence',
    'sourceUrl',
    'rationale',
  ],
  additionalProperties: false,
} as const

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['info', 'warning'] },
          message: { type: 'string' },
        },
        required: ['severity', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['flags'],
  additionalProperties: false,
} as const
