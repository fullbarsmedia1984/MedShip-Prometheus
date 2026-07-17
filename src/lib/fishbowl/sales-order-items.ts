export type RawSalesOrderItem = Record<string, unknown>

function valueAt(source: RawSalesOrderItem | undefined, keys: string[]) {
  if (!source) return undefined
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/**
 * Fishbowl nests component lines under a Kit master's kitItems property.
 * Return the master and every descendant in source order, annotating children
 * with their immediate parent so the flattened cache retains hierarchy
 * lineage without inventing part or quantity data.
 */
export function expandSalesOrderItems(
  items: RawSalesOrderItem[],
  parent?: RawSalesOrderItem
): RawSalesOrderItem[] {
  return items.flatMap((item) => {
    const normalizedItem = parent
      ? {
          ...item,
          _kitParentLineId: valueAt(parent, ['id', 'lineId']),
          _kitParentLineNumber: valueAt(parent, ['lineNumber', 'line', 'sortOrder']),
        }
      : item
    const nested = valueAt(item, ['kitItems'])
    const nestedItems = Array.isArray(nested)
      ? nested.filter(
          (value): value is RawSalesOrderItem =>
            Boolean(value && typeof value === 'object' && !Array.isArray(value))
        )
      : []

    return [normalizedItem, ...expandSalesOrderItems(nestedItems, normalizedItem)]
  })
}
