import type { SupabaseClient } from '@supabase/supabase-js'
import type { Connection } from 'jsforce'
import { SalesforceClient } from './client'

type CanonicalState = 'quote' | 'order' | 'void' | 'unknown'

type CanonicalHeader = {
  id: string
  so_number: string
  status: string
  customer_name: string | null
  date_created: string | null
  date_scheduled: string | null
  date_issued: string | null
  total_amount: number | string | null
  subtotal_amount: number | string | null
  sf_opportunity_id: string | null
  sf_quote_id: string | null
  sf_order_id: string | null
  canonical_state: CanonicalState
}

type CanonicalItem = {
  id: string
  sales_order_number: string
  part_number: string | null
  part_description: string | null
  quantity: number | string | null
  unit_price: number | string | null
}

type OpportunityContext = {
  Id: string
  AccountId: string | null
  Pricebook2Id: string | null
}

type PricebookEntry = {
  Id: string
  Product2: {
    ProductCode: string | null
  }
}

export type MirrorResult = {
  scanned: number
  eligible: number
  lineItems: number
  quotes: number
  orders: number
  skipped: number
  skippedByReason: Record<string, number>
  skippedSamples: Array<{ soNumber: string; reason: string }>
  errors: Array<{ soNumber: string; error: string }>
}

type SalesforceLinePayload = Record<string, string | number | undefined>

type SalesforceSaveResult = {
  id?: string
  success?: boolean
  errors?: Array<{ message?: string }>
}

type SalesforceObjectClient = {
  create(record: Record<string, unknown> | Record<string, unknown>[]): Promise<SalesforceSaveResult | SalesforceSaveResult[]>
  update(record: Record<string, unknown> | Record<string, unknown>[]): Promise<SalesforceSaveResult | SalesforceSaveResult[]>
  destroy(ids: string[]): Promise<SalesforceSaveResult | SalesforceSaveResult[]>
}

function sobject(conn: Connection, name: string): SalesforceObjectClient {
  return conn.sobject(name) as unknown as SalesforceObjectClient
}

const DEFAULT_QUOTE_STATUS = 'Draft'
const DEFAULT_ORDER_STATUS = 'Draft'

function escapeSoql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function toNumber(value: number | string | null | undefined): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return new Date().toISOString().split('T')[0]
  return value.split('T')[0]
}

async function getStandardPricebookId(conn: Connection): Promise<string> {
  const result = await conn.query<{ Id: string }>(
    'SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1'
  )
  const id = result.records[0]?.Id
  if (!id) throw new Error('No standard Salesforce pricebook found')
  return id
}

async function getOpportunityContext(
  conn: Connection,
  opportunityId: string,
  fallbackPricebookId: string
): Promise<OpportunityContext> {
  const result = await conn.query<OpportunityContext>(`
    SELECT Id, AccountId, Pricebook2Id
    FROM Opportunity
    WHERE Id = '${escapeSoql(opportunityId)}'
    LIMIT 1
  `)

  const opportunity = result.records[0]
  if (!opportunity) throw new Error(`Opportunity ${opportunityId} not found`)

  return {
    ...opportunity,
    Pricebook2Id: opportunity.Pricebook2Id ?? fallbackPricebookId,
  }
}

async function getPricebookEntries(
  conn: Connection,
  pricebookId: string,
  productCodes: string[]
): Promise<Map<string, string>> {
  const uniqueCodes = [...new Set(productCodes.filter(Boolean))]
  const entriesByCode = new Map<string, string>()
  if (uniqueCodes.length === 0) return entriesByCode

  for (let i = 0; i < uniqueCodes.length; i += 100) {
    const batch = uniqueCodes.slice(i, i + 100)
    const inClause = batch.map((code) => `'${escapeSoql(code)}'`).join(',')
    const result = await conn.query<PricebookEntry>(`
      SELECT Id, Product2.ProductCode
      FROM PricebookEntry
      WHERE Pricebook2Id = '${escapeSoql(pricebookId)}'
        AND IsActive = true
        AND Product2.ProductCode IN (${inClause})
    `)

    for (const entry of result.records) {
      if (entry.Product2?.ProductCode) {
        entriesByCode.set(entry.Product2.ProductCode, entry.Id)
      }
    }
  }

  return entriesByCode
}

async function findExistingBySoNumber(
  conn: Connection,
  objectName: 'Quote' | 'Order',
  soNumber: string
): Promise<string | null> {
  const result = await conn.query<{ Id: string }>(`
    SELECT Id
    FROM ${objectName}
    WHERE Fishbowl_SO_Number__c = '${escapeSoql(soNumber)}'
    LIMIT 1
  `)

  return result.records[0]?.Id ?? null
}

async function replaceChildLines({
  conn,
  objectName,
  parentField,
  parentId,
  pricebookId,
  items,
}: {
  conn: Connection
  objectName: 'QuoteLineItem' | 'OrderItem'
  parentField: 'QuoteId' | 'OrderId'
  parentId: string
  pricebookId: string
  items: CanonicalItem[]
}) {
  const existing = await conn.query<{ Id: string }>(`
    SELECT Id
    FROM ${objectName}
    WHERE ${parentField} = '${escapeSoql(parentId)}'
  `)

  if (existing.records.length > 0) {
    await sobject(conn, objectName).destroy(existing.records.map((record) => record.Id))
  }

  const pricebookEntries = await getPricebookEntries(
    conn,
    pricebookId,
    items.map((item) => item.part_number ?? '')
  )

  const rows = items
    .map((item): SalesforceLinePayload | null => {
      const pricebookEntryId = item.part_number
        ? pricebookEntries.get(item.part_number)
        : undefined
      if (!pricebookEntryId) return null

      return {
        [parentField]: parentId,
        PricebookEntryId: pricebookEntryId,
        Quantity: toNumber(item.quantity),
        UnitPrice: toNumber(item.unit_price),
        Description: item.part_description ?? undefined,
      }
    })
    .filter((row): row is SalesforceLinePayload => Boolean(row))

  if (rows.length > 0) {
    await sobject(conn, objectName).create(rows)
  }
}

async function mirrorQuote({
  conn,
  supabase,
  header,
  items,
  standardPricebookId,
}: {
  conn: Connection
  supabase: SupabaseClient
  header: CanonicalHeader
  items: CanonicalItem[]
  standardPricebookId: string
}) {
  if (!header.sf_opportunity_id) {
    throw new Error('Cannot mirror quote without sf_opportunity_id')
  }

  const opportunity = await getOpportunityContext(conn, header.sf_opportunity_id, standardPricebookId)
  const existingId = header.sf_quote_id ?? await findExistingBySoNumber(conn, 'Quote', header.so_number)
  const payload = {
    ...(existingId ? { Id: existingId } : {}),
    Name: `${header.so_number} - ${header.customer_name ?? 'Quote'}`,
    OpportunityId: header.sf_opportunity_id,
    Pricebook2Id: opportunity.Pricebook2Id,
    Status: DEFAULT_QUOTE_STATUS,
    Fishbowl_SO_Number__c: header.so_number,
    Fishbowl_SO_Status__c: header.status,
    Prometheus_Canonical_Id__c: header.id,
  }

  const result = existingId
    ? await sobject(conn, 'Quote').update(payload)
    : await sobject(conn, 'Quote').create(payload)
  const quoteId = Array.isArray(result) ? result[0]?.id : result.id

  if (!quoteId) throw new Error('Salesforce did not return Quote ID')

  await replaceChildLines({
    conn,
    objectName: 'QuoteLineItem',
    parentField: 'QuoteId',
    parentId: quoteId,
    pricebookId: opportunity.Pricebook2Id ?? standardPricebookId,
    items,
  })

  await supabase
    .from('fb_sales_orders')
    .update({ sf_quote_id: quoteId })
    .eq('so_number', header.so_number)

  return quoteId
}

async function mirrorOrder({
  conn,
  supabase,
  header,
  items,
  standardPricebookId,
}: {
  conn: Connection
  supabase: SupabaseClient
  header: CanonicalHeader
  items: CanonicalItem[]
  standardPricebookId: string
}) {
  if (!header.sf_opportunity_id) {
    throw new Error('Cannot mirror order without sf_opportunity_id')
  }

  const opportunity = await getOpportunityContext(conn, header.sf_opportunity_id, standardPricebookId)
  if (!opportunity.AccountId) throw new Error(`Opportunity ${opportunity.Id} has no AccountId`)

  const existingId = header.sf_order_id ?? await findExistingBySoNumber(conn, 'Order', header.so_number)
  const payload = {
    ...(existingId ? { Id: existingId } : {}),
    AccountId: opportunity.AccountId,
    EffectiveDate: dateOnly(header.date_issued ?? header.date_created),
    Status: DEFAULT_ORDER_STATUS,
    Pricebook2Id: opportunity.Pricebook2Id,
    Fishbowl_SO_Number__c: header.so_number,
    Prometheus_Canonical_Id__c: header.id,
    Opportunity__c: header.sf_opportunity_id,
    Quote__c: header.sf_quote_id ?? undefined,
  }

  const result = existingId
    ? await sobject(conn, 'Order').update(payload)
    : await sobject(conn, 'Order').create(payload)
  const orderId = Array.isArray(result) ? result[0]?.id : result.id

  if (!orderId) throw new Error('Salesforce did not return Order ID')

  await replaceChildLines({
    conn,
    objectName: 'OrderItem',
    parentField: 'OrderId',
    parentId: orderId,
    pricebookId: opportunity.Pricebook2Id ?? standardPricebookId,
    items,
  })

  await supabase
    .from('fb_sales_orders')
    .update({ sf_order_id: orderId })
    .eq('so_number', header.so_number)

  return orderId
}

export async function mirrorCanonicalSalesOrdersToSalesforce(
  client: SalesforceClient,
  supabase: SupabaseClient
): Promise<MirrorResult> {
  const result: MirrorResult = {
    scanned: 0,
    eligible: 0,
    lineItems: 0,
    quotes: 0,
    orders: 0,
    skipped: 0,
    skippedByReason: {},
    skippedSamples: [],
    errors: [],
  }

  const { data: headers, error: headersError } = await supabase
    .from('fb_sales_orders')
    .select('id, so_number, status, customer_name, date_created, date_scheduled, date_issued, total_amount, subtotal_amount, sf_opportunity_id, sf_quote_id, sf_order_id, canonical_state, detail_status, data_quality_flags')
    .neq('canonical_state', 'void')
    .eq('detail_status', 'success')
    .not('data_quality_flags', 'cs', '{"likely_test"}')
    .not('data_quality_flags', 'cs', '{"unknown_state"}')
    .order('last_synced_at', { ascending: false })
    .limit(500)

  if (headersError) throw new Error(`Could not read fb_sales_orders: ${headersError.message}`)
  if (!headers || headers.length === 0) return result
  result.scanned = headers.length

  const soNumbers = headers.map((header) => header.so_number)
  const { data: items, error: itemsError } = await supabase
    .from('fb_sales_order_items')
    .select('id, sales_order_number, part_number, part_description, quantity, unit_price')
    .in('sales_order_number', soNumbers)

  if (itemsError) throw new Error(`Could not read fb_sales_order_items: ${itemsError.message}`)
  result.lineItems = items?.length ?? 0

  const itemsByOrder = new Map<string, CanonicalItem[]>()
  for (const item of (items ?? []) as CanonicalItem[]) {
    const orderItems = itemsByOrder.get(item.sales_order_number) ?? []
    orderItems.push(item)
    itemsByOrder.set(item.sales_order_number, orderItems)
  }

  return client.withRetry(async (conn) => {
    const standardPricebookId = await getStandardPricebookId(conn)

    for (const header of headers as CanonicalHeader[]) {
      try {
        if (!header.sf_opportunity_id) {
          result.skipped++
          result.skippedByReason.missingOpportunity =
            (result.skippedByReason.missingOpportunity ?? 0) + 1
          if (result.skippedSamples.length < 10) {
            result.skippedSamples.push({
              soNumber: header.so_number,
              reason: 'Missing sf_opportunity_id; needs Opportunity/SO link before Salesforce mirror.',
            })
          }
          continue
        }
        result.eligible++

        const documentItems = itemsByOrder.get(header.so_number) ?? []
        if (header.canonical_state === 'quote') {
          await mirrorQuote({ conn, supabase, header, items: documentItems, standardPricebookId })
          result.quotes++
        } else if (header.canonical_state === 'order') {
          await mirrorOrder({ conn, supabase, header, items: documentItems, standardPricebookId })
          result.orders++
        } else {
          result.skipped++
          result.skippedByReason.unsupportedState =
            (result.skippedByReason.unsupportedState ?? 0) + 1
          if (result.skippedSamples.length < 10) {
            result.skippedSamples.push({
              soNumber: header.so_number,
              reason: `Unsupported canonical_state: ${header.canonical_state}`,
            })
          }
        }
      } catch (error) {
        result.errors.push({
          soNumber: header.so_number,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return result
  })
}
