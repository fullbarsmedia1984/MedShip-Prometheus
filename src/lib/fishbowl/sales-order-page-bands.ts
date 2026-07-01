export function selectIncrementalSalesOrderPages(
  totalPages: number,
  pagesPerEdge: number
): number[] {
  const safeTotalPages = Number.isFinite(totalPages) ? Math.floor(totalPages) : 0
  if (safeTotalPages <= 0) return []

  const safePagesPerEdge = Number.isFinite(pagesPerEdge)
    ? Math.max(1, Math.floor(pagesPerEdge))
    : 1

  const selected = new Set<number>()
  const firstBandEnd = Math.min(safePagesPerEdge, safeTotalPages)
  const lastBandStart = Math.max(1, safeTotalPages - safePagesPerEdge + 1)

  for (let page = 1; page <= firstBandEnd; page++) {
    selected.add(page)
  }

  for (let page = lastBandStart; page <= safeTotalPages; page++) {
    selected.add(page)
  }

  return [...selected].sort((a, b) => a - b)
}
