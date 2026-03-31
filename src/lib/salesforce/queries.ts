import { SalesforceClient } from './client'
import type { SFOpportunity, SFProduct } from './types'
import type { SFProfileCall, SFProfileCallMetrics } from '@/types'

const INVALID_FIELD_ERROR = 'INVALID_FIELD'

/**
 * Get opportunities that closed won but haven't been synced to Fishbowl yet.
 * Polls for records modified in the last 5 minutes with no Fishbowl SO number.
 */
export async function getUnsyncedClosedOpportunities(
  client: SalesforceClient
): Promise<SFOpportunity[]> {
  return client.withRetry(async (conn) => {
    try {
      const result = await conn.query<SFOpportunity>(`
        SELECT Id, Name, AccountId, Account.Name,
          Account.ShippingStreet, Account.ShippingCity,
          Account.ShippingState, Account.ShippingPostalCode,
          Account.ShippingCountry,
          CloseDate, Amount, Fishbowl_SO_Number__c,
          Fulfillment_Status__c,
          (SELECT Id, Product2.ProductCode, Product2.Name,
                  Quantity, UnitPrice, TotalPrice
           FROM OpportunityLineItems)
        FROM Opportunity
        WHERE StageName = 'Closed Won'
          AND Fishbowl_SO_Number__c = null
          AND LastModifiedDate >= LAST_N_MINUTES:5
        ORDER BY CloseDate ASC
      `)

      return result.records
    } catch (error) {
      throwIfInvalidField(error)
      throw error
    }
  })
}

/**
 * Get a single opportunity with full details (used for retry scenarios).
 */
export async function getOpportunityById(
  client: SalesforceClient,
  opportunityId: string
): Promise<SFOpportunity | null> {
  return client.withRetry(async (conn) => {
    try {
      // Use parameterized retrieve for single-record fetch by ID
      const result = await conn.query<SFOpportunity>(`
        SELECT Id, Name, AccountId, Account.Name,
          Account.ShippingStreet, Account.ShippingCity,
          Account.ShippingState, Account.ShippingPostalCode,
          Account.ShippingCountry,
          CloseDate, Amount, StageName,
          Fishbowl_SO_Number__c, Fulfillment_Status__c,
          Fulfillment_Error__c, Last_Sync_Attempt__c,
          (SELECT Id, Product2.ProductCode, Product2.Name,
                  Quantity, UnitPrice, TotalPrice
           FROM OpportunityLineItems)
        FROM Opportunity
        WHERE Id = '${escapeSoql(opportunityId)}'
        LIMIT 1
      `)

      return result.records[0] ?? null
    } catch (error) {
      throwIfInvalidField(error)
      throw error
    }
  })
}

/**
 * Get SF Product2 records matching the given product codes.
 * Used by P2 inventory sync to know which products to update.
 */
export async function getProductsByCode(
  client: SalesforceClient,
  productCodes: string[]
): Promise<Array<{ Id: string; ProductCode: string; Name: string }>> {
  if (productCodes.length === 0) return []

  return client.withRetry(async (conn) => {
    // Build an IN clause with escaped values
    const escaped = productCodes.map((c) => `'${escapeSoql(c)}'`).join(',')

    const result = await conn.query<SFProduct>(`
      SELECT Id, ProductCode, Name
      FROM Product2
      WHERE ProductCode IN (${escaped})
    `)

    return result.records.map((r) => ({
      Id: r.Id,
      ProductCode: r.ProductCode!,
      Name: r.Name,
    }))
  })
}

// --- Profile Call Queries ---

/**
 * Get profile call tasks with all custom fields.
 * Filter by date range, sales rep, and outcome.
 */
export async function getProfileCalls(
  client: SalesforceClient,
  filters?: {
    startDate?: string
    endDate?: string
    ownerId?: string
    accountId?: string
    outcome?: string
    limit?: number
  }
): Promise<SFProfileCall[]> {
  const limit = filters?.limit ?? 200

  return client.withRetry(async (conn) => {
    try {
      let soql = `
        SELECT Id, Subject, OwnerId, Owner.Name, AccountId, Account.Name,
               WhoId, Who.Name, ActivityDate, Status,
               Call_Type__c, Call_Outcome__c, Products_Discussed__c,
               Program_Size__c, Current_Supplier__c, Budget_Available__c,
               Budget_Timeframe__c, Follow_Up_Date__c, Converted_to_Opp__c,
               Related_Opportunity__c, Related_Opportunity__r.Name,
               Call_Duration_Minutes__c, Call_Notes_Summary__c,
               Competitor_Intel__c, CreatedDate
        FROM Task
        WHERE RecordType.DeveloperName = 'Profile_Call'
      `

      if (filters?.startDate) {
        soql += ` AND ActivityDate >= ${filters.startDate}`
      }
      if (filters?.endDate) {
        soql += ` AND ActivityDate <= ${filters.endDate}`
      }
      if (filters?.ownerId) {
        soql += ` AND OwnerId = '${escapeSoql(filters.ownerId)}'`
      }
      if (filters?.accountId) {
        soql += ` AND AccountId = '${escapeSoql(filters.accountId)}'`
      }
      if (filters?.outcome) {
        soql += ` AND Call_Outcome__c = '${escapeSoql(filters.outcome)}'`
      }

      soql += ` ORDER BY ActivityDate DESC LIMIT ${limit}`

      const result = await conn.query<Record<string, any>>(soql)

      return result.records.map((r) => ({
        Id: r.Id,
        Subject: r.Subject,
        OwnerId: r.OwnerId,
        OwnerName: r.Owner?.Name ?? '',
        AccountId: r.AccountId,
        AccountName: r.Account?.Name ?? '',
        ContactId: r.WhoId ?? null,
        ContactName: r.Who?.Name ?? null,
        ActivityDate: r.ActivityDate,
        Status: r.Status,
        callType: r.Call_Type__c ?? null,
        callOutcome: r.Call_Outcome__c ?? null,
        productsDiscussed: r.Products_Discussed__c ?? null,
        programSize: r.Program_Size__c ?? null,
        currentSupplier: r.Current_Supplier__c ?? null,
        budgetAvailable: r.Budget_Available__c ?? null,
        budgetTimeframe: r.Budget_Timeframe__c ?? null,
        followUpDate: r.Follow_Up_Date__c ?? null,
        convertedToOpp: r.Converted_to_Opp__c ?? false,
        relatedOpportunityId: r.Related_Opportunity__c ?? null,
        relatedOpportunityName: r.Related_Opportunity__r?.Name ?? null,
        callDurationMinutes: r.Call_Duration_Minutes__c ?? null,
        callNotesSummary: r.Call_Notes_Summary__c ?? null,
        competitorIntel: r.Competitor_Intel__c ?? null,
        createdDate: r.CreatedDate,
      }))
    } catch (error) {
      throwIfInvalidField(error)
      throw error
    }
  })
}

/**
 * Get profile call counts and metrics grouped by rep.
 * Used for leaderboard and KPI cards.
 */
export async function getProfileCallMetrics(
  client: SalesforceClient,
  startDate: string,
  endDate: string
): Promise<SFProfileCallMetrics[]> {
  return client.withRetry(async (conn) => {
    try {
      // Fetch all profile calls in the date range and aggregate in code
      // (SOQL aggregate limitations on checkbox fields in some SF editions)
      const result = await conn.query<Record<string, any>>(`
        SELECT OwnerId, Owner.Name, Converted_to_Opp__c, Call_Duration_Minutes__c
        FROM Task
        WHERE RecordType.DeveloperName = 'Profile_Call'
          AND ActivityDate >= ${startDate}
          AND ActivityDate <= ${endDate}
      `)

      const byRep = new Map<string, { name: string; total: number; converted: number; totalDuration: number }>()

      for (const r of result.records) {
        const id = r.OwnerId
        const existing = byRep.get(id) ?? { name: r.Owner?.Name ?? '', total: 0, converted: 0, totalDuration: 0 }
        existing.total++
        if (r.Converted_to_Opp__c) existing.converted++
        existing.totalDuration += r.Call_Duration_Minutes__c ?? 0
        byRep.set(id, existing)
      }

      return Array.from(byRep.entries()).map(([repId, data]) => ({
        repId,
        repName: data.name,
        totalCalls: data.total,
        converted: data.converted,
        conversionRate: data.total > 0 ? Math.round((data.converted / data.total) * 1000) / 10 : 0,
        avgDuration: data.total > 0 ? Math.round(data.totalDuration / data.total) : 0,
        callsThisWeek: 0, // computed separately if needed
        callsThisMonth: data.total,
      }))
    } catch (error) {
      throwIfInvalidField(error)
      throw error
    }
  })
}

/**
 * Get profile call conversion rate (calls that led to opportunities).
 */
export async function getProfileCallConversionRate(
  client: SalesforceClient,
  startDate: string,
  endDate: string
): Promise<{ totalCalls: number; converted: number; rate: number }> {
  const metrics = await getProfileCallMetrics(client, startDate, endDate)
  const totalCalls = metrics.reduce((s, m) => s + m.totalCalls, 0)
  const converted = metrics.reduce((s, m) => s + m.converted, 0)
  return {
    totalCalls,
    converted,
    rate: totalCalls > 0 ? Math.round((converted / totalCalls) * 1000) / 10 : 0,
  }
}

// --- Helpers ---

/**
 * Escape single quotes in SOQL values to prevent injection.
 */
function escapeSoql(value: string): string {
  return value.replace(/'/g, "\\'")
}

/**
 * If the error indicates a missing custom field, throw a descriptive error
 * telling the user which fields to create in Salesforce Setup.
 */
function throwIfInvalidField(error: unknown): void {
  if (
    error instanceof Error &&
    error.message.includes(INVALID_FIELD_ERROR)
  ) {
    throw new Error(
      `Salesforce custom field(s) not found. Please ensure the following custom fields ` +
        `exist on the Opportunity object in Salesforce Setup:\n` +
        `  - Fishbowl_SO_Number__c (Text)\n` +
        `  - Fulfillment_Status__c (Picklist or Text)\n` +
        `  - Fulfillment_Error__c (Long Text Area)\n` +
        `  - Last_Sync_Attempt__c (Date/Time)\n` +
        `And on the Product2 object:\n` +
        `  - Qty_On_Hand__c (Number)\n` +
        `  - Qty_Available__c (Number)\n` +
        `  - Last_Inventory_Sync__c (Date/Time)\n\n` +
        `Original error: ${error.message}`
    )
  }
}
