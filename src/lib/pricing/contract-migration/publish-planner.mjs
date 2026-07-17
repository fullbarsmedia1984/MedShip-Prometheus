/**
 * Pure planning helpers for the final publish / rollback phase of the
 * contract-pricing migration. No I/O — deterministic functions over cost-line
 * records so the supersede/rollback plans are unit-testable with node:test.
 *
 * Identity model ("same supplier contract and item/UOM identity"):
 * a cost line's identity is its strongest available item identifier
 * (internal_item_id first, then distributor SKU, MPN, model, GTIN, UDI, NDC)
 * combined with its price UOM, tier, and minimum quantity. Lines that share an
 * identity within one supplier contract represent the same negotiated cost and
 * supersede each other on publish. Lines with no identifier at all never
 * supersede anything (and are reported so reviewers can see them).
 */

/**
 * @typedef {Object} CostLineIdentityFields
 * @property {string} id
 * @property {string | null} [created_at]
 * @property {string | null} [internal_item_id]
 * @property {string | null} [distributor_sku]
 * @property {string | null} [manufacturer_part_number]
 * @property {string | null} [model_number]
 * @property {string | null} [gtin]
 * @property {string | null} [udi]
 * @property {string | null} [ndc]
 * @property {string | null} [normalized_price_uom]
 * @property {string | null} [raw_price_uom]
 * @property {string | null} [normalized_uom]
 * @property {string | null} [raw_uom]
 * @property {string | null} [tier]
 * @property {number | string | null} [minimum_quantity]
 */

/**
 * @typedef {Object} SupersedeAssignment
 * @property {string} pendingLineId
 * @property {string} supersedesCostLineId Newest matching active line (recorded on the new line).
 * @property {string[]} supersededLineIds Every matching active line to deactivate.
 */

/**
 * @typedef {Object} SupersedePlan
 * @property {SupersedeAssignment[]} assignments
 * @property {string[]} supersededLineIds Unique ids of active lines to deactivate.
 * @property {string[]} pendingWithoutIdentity Pending line ids with no usable item identifier.
 * @property {string[]} duplicatePendingKeys Identity keys shared by more than one pending line.
 */

const IDENTIFIER_PRIORITY = [
  'internal_item_id',
  'distributor_sku',
  'manufacturer_part_number',
  'model_number',
  'gtin',
  'udi',
  'ndc',
]

const UOM_PRIORITY = ['normalized_price_uom', 'raw_price_uom', 'normalized_uom', 'raw_uom']

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeToken(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Deterministic identity key for supersede matching, or null when the line has
 * no item identifier at all.
 *
 * @param {CostLineIdentityFields} line
 * @returns {string | null}
 */
export function costLineIdentityKey(line) {
  let identifier = null
  for (const field of IDENTIFIER_PRIORITY) {
    const token = normalizeToken(line[field])
    if (token) {
      identifier = `${field}:${token}`
      break
    }
  }
  if (!identifier) return null

  let uom = ''
  for (const field of UOM_PRIORITY) {
    const token = normalizeToken(line[field])
    if (token) {
      uom = token
      break
    }
  }

  const tier = normalizeToken(line.tier)
  const minimumQuantity = normalizeToken(line.minimum_quantity)
  return `${identifier}|uom:${uom}|tier:${tier}|minqty:${minimumQuantity}`
}

/**
 * @param {CostLineIdentityFields} line
 * @returns {number}
 */
function createdAtEpoch(line) {
  const parsed = Date.parse(String(line.created_at ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Plan which currently-active cost lines each pending line supersedes.
 * Matching is exact on identity key within the same supplier contract
 * (callers must pass only active lines from that contract).
 *
 * @param {CostLineIdentityFields[]} pendingLines
 * @param {CostLineIdentityFields[]} activeLines
 * @returns {SupersedePlan}
 */
export function planCostLineSupersedes(pendingLines, activeLines) {
  /** @type {Map<string, CostLineIdentityFields[]>} */
  const activeByKey = new Map()
  for (const line of activeLines) {
    const key = costLineIdentityKey(line)
    if (!key) continue
    const bucket = activeByKey.get(key)
    if (bucket) bucket.push(line)
    else activeByKey.set(key, [line])
  }

  /** @type {SupersedeAssignment[]} */
  const assignments = []
  /** @type {Set<string>} */
  const supersededLineIds = new Set()
  /** @type {string[]} */
  const pendingWithoutIdentity = []
  /** @type {Map<string, number>} */
  const pendingKeyCounts = new Map()

  for (const pending of pendingLines) {
    const key = costLineIdentityKey(pending)
    if (!key) {
      pendingWithoutIdentity.push(pending.id)
      continue
    }
    pendingKeyCounts.set(key, (pendingKeyCounts.get(key) ?? 0) + 1)

    const matches = activeByKey.get(key)
    if (!matches || matches.length === 0) continue

    const sorted = [...matches].sort((left, right) => createdAtEpoch(right) - createdAtEpoch(left))
    for (const match of sorted) supersededLineIds.add(match.id)
    assignments.push({
      pendingLineId: pending.id,
      supersedesCostLineId: sorted[0].id,
      supersededLineIds: sorted.map((match) => match.id),
    })
  }

  const duplicatePendingKeys = [...pendingKeyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)

  return {
    assignments,
    supersededLineIds: [...supersededLineIds],
    pendingWithoutIdentity,
    duplicatePendingKeys,
  }
}

/**
 * Ids of previously-superseded lines that a rollback should restore: the
 * distinct non-null supersedes targets recorded on the batch's lines.
 *
 * @param {Array<{ supersedes_cost_line_id?: string | null }>} batchLines
 * @returns {string[]}
 */
export function planRollbackRestores(batchLines) {
  /** @type {Set<string>} */
  const restoreIds = new Set()
  for (const line of batchLines) {
    const target = String(line.supersedes_cost_line_id ?? '').trim()
    if (target) restoreIds.add(target)
  }
  return [...restoreIds]
}
