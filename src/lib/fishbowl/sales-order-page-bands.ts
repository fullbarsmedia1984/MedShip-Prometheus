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

export type RotatingSalesOrderPageSelection = {
  pageNumbers: number[]
  nextStartPage: number
}

export function selectRotatingSalesOrderPages(
  totalPages: number,
  pageCount: number,
  startPage: number
): RotatingSalesOrderPageSelection {
  const safeTotalPages = Number.isFinite(totalPages) ? Math.floor(totalPages) : 0
  if (safeTotalPages <= 0) return { pageNumbers: [], nextStartPage: 1 }

  const safePageCount = Number.isFinite(pageCount)
    ? Math.max(1, Math.floor(pageCount))
    : 1
  const safeStartPage = Number.isFinite(startPage)
    ? Math.min(Math.max(1, Math.floor(startPage)), safeTotalPages)
    : 1

  const selected: number[] = []
  let page = safeStartPage

  for (let index = 0; index < Math.min(safePageCount, safeTotalPages); index++) {
    selected.push(page)
    page = page >= safeTotalPages ? 1 : page + 1
  }

  return {
    pageNumbers: selected,
    nextStartPage: page,
  }
}
