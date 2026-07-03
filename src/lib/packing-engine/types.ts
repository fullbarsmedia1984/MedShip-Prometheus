// =============================================================================
// Zeus Packaging Estimator — engine types
// Pure data contracts for the deterministic bin-packing engine. Zero I/O here.
// =============================================================================

export interface ItemAttributes {
  liquid: boolean
  fragile: boolean
  stackable: boolean
  nestable: boolean
  /** Fraction of unit volume consumed by each nested unit beyond the first (0–1). */
  nesting_factor: number
  /** When true the item must ship upright — only rotations about the vertical axis. */
  orientation_lock: boolean
  hazmat: boolean
}

export type DimsSource = 'verified' | 'fishbowl' | 'default'

/** One SO line item expanded into packable form. */
export interface PackableItem {
  partNumber: string
  description: string
  quantity: number
  lengthIn: number
  widthIn: number
  heightIn: number
  weightLb: number
  shipsInOwnCarton: boolean
  attributes: ItemAttributes
  dimsSource: DimsSource
}

export interface BoxSpec {
  id: string
  name: string
  innerLengthIn: number
  innerWidthIn: number
  innerHeightIn: number
  outerLengthIn: number
  outerWidthIn: number
  outerHeightIn: number
  boxWeightLb: number
  maxContentWeightLb: number
}

export interface ParcelMaxRules {
  single_package_weight_lb: number
  max_length_in: number
  max_length_plus_girth_in: number
}

export interface LtlTriggerRules {
  total_billable_weight_lb: number
  carton_count: number
  dim_weight_flag_threshold_lb: number
}

export interface PalletRules {
  length_in: number
  width_in: number
  deck_height_in: number
  deck_weight_lb: number
  max_height_in: number
  max_weight_lb: number
  max_piece_weight_lb: number
  stack_fill_factor: number
}

export interface PackingRules {
  fill_factor: number
  max_box_weight_lb: number
  dim_divisor: number
  segregate_liquids: boolean
  parcel_max: ParcelMaxRules
  ltl_triggers: LtlTriggerRules
  pallet: PalletRules
  llm_confidence_threshold: number
  estimate_confidence_threshold: number
}

export interface PackedContent {
  partNumber: string
  description: string
  quantity: number
}

export interface PackedBox {
  /** Standard box name, or the part number for own-carton items. */
  boxName: string
  isOwnCarton: boolean
  outerLengthIn: number
  outerWidthIn: number
  outerHeightIn: number
  contents: PackedContent[]
  contentWeightLb: number
  /** Contents + box tare. */
  actualWeightLb: number
  /** ceil(L×W×H / dim divisor) on outer dims. */
  dimWeightLb: number
  /** max(ceil(actual), dim). */
  billableWeightLb: number
  /** True when the box holds only liquid items (segregation applied). */
  liquidsOnly: boolean
}

export type RoutingMode = 'parcel' | 'ltl' | 'compare' | 'manual_review'

export interface RoutingDecision {
  mode: RoutingMode
  /** Portal-facing label, e.g. "FedEx Ground" or "TForce / FedEx Freight (LTL)". */
  label: string
  reasons: string[]
  /** True when quote generation must stop for a manual freight desk review. */
  blocked: boolean
}

export interface PackedPallet {
  boxNames: string[]
  boxCount: number
  lengthIn: number
  widthIn: number
  /** Total height including the pallet deck. */
  heightIn: number
  /** Total weight including the deck. */
  weightLb: number
}

export interface PalletPlan {
  pallets: PackedPallet[]
  palletCount: number
  totalWeightLb: number
  /** Shipment density over pallet cube, lb/ft³. */
  densityPcf: number
  freightClass: number
}

export interface PackTotals {
  boxCount: number
  actualWeightLb: number
  dimWeightLb: number
  billableWeightLb: number
}

export interface PackWarning {
  code:
    | 'ITEM_TOO_LARGE'
    | 'ITEM_OVERWEIGHT'
    | 'HAZMAT_PRESENT'
    | 'PIECE_OVER_FREIGHT_MAX'
    | 'NO_ACTIVE_BOXES'
  message: string
  partNumber?: string
}

export interface PackResult {
  engineVersion: string
  boxes: PackedBox[]
  totals: PackTotals
  routing: RoutingDecision
  palletPlan: PalletPlan | null
  warnings: PackWarning[]
}

/** Conservative attribute defaults used when nothing is known about an item. */
export const CONSERVATIVE_ATTRIBUTES: ItemAttributes = {
  liquid: false,
  fragile: true,
  stackable: false,
  nestable: false,
  nesting_factor: 0,
  orientation_lock: true,
  hazmat: false,
}

export function normalizeAttributes(
  partial: Partial<ItemAttributes> | null | undefined
): ItemAttributes {
  return { ...CONSERVATIVE_ATTRIBUTES, ...(partial ?? {}) }
}

export const DEFAULT_PACKING_RULES: PackingRules = {
  fill_factor: 0.85,
  max_box_weight_lb: 50,
  dim_divisor: 139,
  segregate_liquids: true,
  parcel_max: {
    single_package_weight_lb: 150,
    max_length_in: 108,
    max_length_plus_girth_in: 165,
  },
  ltl_triggers: {
    total_billable_weight_lb: 500,
    carton_count: 6,
    dim_weight_flag_threshold_lb: 50,
  },
  pallet: {
    length_in: 48,
    width_in: 40,
    deck_height_in: 5.5,
    deck_weight_lb: 45,
    max_height_in: 72,
    max_weight_lb: 1500,
    max_piece_weight_lb: 4000,
    stack_fill_factor: 0.9,
  },
  llm_confidence_threshold: 0.7,
  estimate_confidence_threshold: 0.7,
}
