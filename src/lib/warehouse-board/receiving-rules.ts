export type ReceivingSource = 'receipt_events' | 'po_line_fallback' | 'unavailable'

export interface ReceiptFact {
  receiptItemId: number | string
  receiptId: number | string
  poNumber: string
  vendorName: string | null
  poLineId: number | string
  partNumber: string | null
  quantity: number
  receivedAt: string
  receiptStatus: string | null
  receiptItemStatus: string | null
}

export interface OpenDemandFact {
  soNumber: string
  kind: 'sales' | 'kit'
  remaining: number
  priorityDate: string | null
}

export interface CrossDockCandidate {
  partNumber: string
  quantityReceivedToday: number
  demand: OpenDemandFact[]
}

export interface ReceivingOrder {
  poNumber: string
  vendorName: string
  linesReceivedToday: number
  totalPoLines: number
  deliveriesToday: number
  quantityReceivedToday: number
  lastReceivedAt: string
  crossDockCandidates: CrossDockCandidate[]
  crossDockOrderCount: number
}

function isVoided(status: string | null): boolean {
  return status ? /void|cancel|reject/i.test(status) : false
}

/**
 * A receiving line is a positive, non-voided physical receipt. Zero/negative
 * correction facts remain in the durable cache but do not inflate floor counts.
 */
export function countsAsReceived(fact: ReceiptFact): boolean {
  return (
    Number.isFinite(fact.quantity) &&
    fact.quantity > 0 &&
    !isVoided(fact.receiptStatus) &&
    !isVoided(fact.receiptItemStatus)
  )
}

function compareDemand(a: OpenDemandFact, b: OpenDemandFact): number {
  const date = (a.priorityDate ?? '9999-12-31').localeCompare(
    b.priorityDate ?? '9999-12-31'
  )
  if (date !== 0) return date
  if (a.kind !== b.kind) return a.kind === 'kit' ? -1 : 1
  return a.soNumber.localeCompare(b.soNumber)
}

/**
 * Group immutable receipt facts into one wallboard card per PO. Cross-dock
 * matches are informational only: no quantity is allocated or promised here.
 */
export function buildReceivingOrders({
  facts,
  totalLinesByPo,
  demandByPart,
  includeCrossDock,
}: {
  facts: ReceiptFact[]
  totalLinesByPo: ReadonlyMap<string, number>
  demandByPart: ReadonlyMap<string, OpenDemandFact[]>
  includeCrossDock: boolean
}): ReceivingOrder[] {
  type Group = {
    vendorName: string
    poLineIds: Set<string>
    receiptIds: Set<string>
    quantity: number
    lastReceivedAt: string
    quantityByPart: Map<string, number>
  }

  const byPo = new Map<string, Group>()
  for (const fact of facts) {
    if (!countsAsReceived(fact)) continue
    const group = byPo.get(fact.poNumber) ?? {
      vendorName: fact.vendorName?.trim() || 'Unknown vendor',
      poLineIds: new Set<string>(),
      receiptIds: new Set<string>(),
      quantity: 0,
      lastReceivedAt: fact.receivedAt,
      quantityByPart: new Map<string, number>(),
    }
    if (group.vendorName === 'Unknown vendor' && fact.vendorName?.trim()) {
      group.vendorName = fact.vendorName.trim()
    }
    group.poLineIds.add(String(fact.poLineId))
    group.receiptIds.add(String(fact.receiptId))
    group.quantity += fact.quantity
    if (fact.receivedAt > group.lastReceivedAt) {
      group.lastReceivedAt = fact.receivedAt
    }
    if (fact.partNumber) {
      const part = fact.partNumber.trim()
      if (part) {
        group.quantityByPart.set(
          part,
          (group.quantityByPart.get(part) ?? 0) + fact.quantity
        )
      }
    }
    byPo.set(fact.poNumber, group)
  }

  return [...byPo.entries()]
    .map(([poNumber, group]): ReceivingOrder => {
      const crossDockCandidates = includeCrossDock
        ? [...group.quantityByPart.entries()]
            .flatMap(([partNumber, quantityReceivedToday]) => {
              const demand = [...(demandByPart.get(partNumber) ?? [])].sort(
                compareDemand
              )
              return demand.length > 0
                ? [{ partNumber, quantityReceivedToday, demand }]
                : []
            })
            .sort((a, b) => {
              const priority = compareDemand(a.demand[0], b.demand[0])
              return priority !== 0
                ? priority
                : a.partNumber.localeCompare(b.partNumber)
            })
        : []
      const matchedOrders = new Set(
        crossDockCandidates.flatMap((candidate) =>
          candidate.demand.map((demand) => demand.soNumber)
        )
      )
      return {
        poNumber,
        vendorName: group.vendorName,
        linesReceivedToday: group.poLineIds.size,
        totalPoLines: Math.max(
          group.poLineIds.size,
          totalLinesByPo.get(poNumber) ?? 0
        ),
        deliveriesToday: group.receiptIds.size,
        quantityReceivedToday: group.quantity,
        lastReceivedAt: group.lastReceivedAt,
        crossDockCandidates,
        crossDockOrderCount: matchedOrders.size,
      }
    })
    .sort((a, b) => {
      const time = b.lastReceivedAt.localeCompare(a.lastReceivedAt)
      return time !== 0 ? time : a.poNumber.localeCompare(b.poNumber)
    })
}
