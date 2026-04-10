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

// Common fields for both Task and Event queries
const PROFILE_CALL_FIELDS = `
  Id, Subject, OwnerId, Owner.Name, AccountId, Account.Name,
  WhoId, Who.Name, ActivityDate, Status, CreatedDate,
  Profile_Call_Type__c, Profile_Call_Outcome__c, Products_Discussed__c,
  Program_Size__c, Current_Supplier__c, Budget_Available__c,
  Budget_Timeframe__c, Follow_Up_Date__c, Converted_to_Opp__c,
  Related_Opportunity__c, Related_Opportunity__r.Name,
  Call_Notes_Summary__c, Competitor_Intel__c,
  ringdna__Call_Direction__c, ringdna__Call_Duration_min__c,
  ringdna__Call_Connected__c, ringdna__Call_Rating__c,
  ringdna__Call_Recording_URL__c, ringdna__Voicemail__c,
  ringdna__Keywords__c, ringdna__Call_Start_Time__c,
  ringdna__Call_Disposition__c,
  Calendly__IsNoShow__c, Calendly__IsRescheduled__c
`

/**
 * Helper to map raw SF response to SFProfileCall shape.
 */
function mapToProfileCall(raw: Record<string, any>, activityType: 'Task' | 'Event'): SFProfileCall {
  return {
    Id: raw.Id,
    Subject: raw.Subject,
    OwnerId: raw.OwnerId,
    OwnerName: raw.Owner?.Name ?? '',
    AccountId: raw.AccountId ?? null,
    AccountName: raw.Account?.Name ?? null,
    WhoId: raw.WhoId ?? null,
    WhoName: raw.Who?.Name ?? null,
    ActivityDate: raw.ActivityDate,
    Status: raw.Status,
    CreatedDate: raw.CreatedDate,
    ActivityType: activityType,
    profileCallType: raw.Profile_Call_Type__c ?? null,
    profileCallOutcome: raw.Profile_Call_Outcome__c ?? null,
    productsDiscussed: raw.Products_Discussed__c ?? null,
    programSize: raw.Program_Size__c ?? null,
    currentSupplier: raw.Current_Supplier__c ?? null,
    budgetAvailable: raw.Budget_Available__c ?? null,
    budgetTimeframe: raw.Budget_Timeframe__c ?? null,
    followUpDate: raw.Follow_Up_Date__c ?? null,
    convertedToOpp: raw.Converted_to_Opp__c ?? false,
    relatedOpportunityId: raw.Related_Opportunity__c ?? null,
    relatedOpportunityName: raw.Related_Opportunity__r?.Name ?? null,
    callNotesSummary: raw.Call_Notes_Summary__c ?? null,
    competitorIntel: raw.Competitor_Intel__c ?? null,
    ringdnaDirection: raw.ringdna__Call_Direction__c ?? null,
    ringdnaDurationMin: raw.ringdna__Call_Duration_min__c ?? null,
    ringdnaConnected: raw.ringdna__Call_Connected__c ?? false,
    ringdnaRating: raw.ringdna__Call_Rating__c ?? null,
    ringdnaRecordingUrl: raw.ringdna__Call_Recording_URL__c ?? null,
    ringdnaVoicemail: raw.ringdna__Voicemail__c ?? false,
    ringdnaKeywords: raw.ringdna__Keywords__c ?? null,
    ringdnaStartTime: raw.ringdna__Call_Start_Time__c ?? null,
    ringdnaDisposition: raw.ringdna__Call_Disposition__c ?? null,
    calendlyNoShow: raw.Calendly__IsNoShow__c ?? false,
    calendlyRescheduled: raw.Calendly__IsRescheduled__c ?? false,
  }
}

/**
 * Get profile calls from both Task and Event, union and sort by date.
 * Filter by date range, sales rep, account, and outcome.
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
      // Build WHERE clause
      const conditions: string[] = ["RecordType.DeveloperName = 'Profile_Call'"]
      if (filters?.startDate) conditions.push(`ActivityDate >= ${filters.startDate}`)
      if (filters?.endDate) conditions.push(`ActivityDate <= ${filters.endDate}`)
      if (filters?.ownerId) conditions.push(`OwnerId = '${escapeSoql(filters.ownerId)}'`)
      if (filters?.accountId) conditions.push(`AccountId = '${escapeSoql(filters.accountId)}'`)
      if (filters?.outcome) conditions.push(`Profile_Call_Outcome__c = '${escapeSoql(filters.outcome)}'`)

      const whereClause = conditions.join(' AND ')

      // Query Task and Event in parallel
      const [taskResults, eventResults] = await Promise.all([
        conn.query<Record<string, any>>(`SELECT ${PROFILE_CALL_FIELDS} FROM Task WHERE ${whereClause} ORDER BY ActivityDate DESC LIMIT ${limit}`),
        conn.query<Record<string, any>>(`SELECT ${PROFILE_CALL_FIELDS} FROM Event WHERE ${whereClause} ORDER BY ActivityDate DESC LIMIT ${limit}`),
      ])

      // Map to unified shape with ActivityType marker
      const tasks = taskResults.records.map((r) => mapToProfileCall(r, 'Task'))
      const events = eventResults.records.map((r) => mapToProfileCall(r, 'Event'))

      // Merge, sort by date desc, apply final limit
      return [...tasks, ...events]
        .sort((a, b) => new Date(b.ActivityDate).getTime() - new Date(a.ActivityDate).getTime())
        .slice(0, limit)
    } catch (error) {
      throwIfInvalidField(error)
      throw error
    }
  })
}

/**
 * Get aggregated metrics per rep for the leaderboard.
 * Fetches all calls in range and computes stats client-side.
 */
export async function getProfileCallMetrics(
  client: SalesforceClient,
  startDate: string,
  endDate: string
): Promise<SFProfileCallMetrics[]> {
  // Fetch all calls in range, aggregate in memory
  const calls = await getProfileCalls(client, { startDate, endDate, limit: 2000 })

  // Group by OwnerId
  const byRep = new Map<string, SFProfileCall[]>()
  for (const call of calls) {
    const list = byRep.get(call.OwnerId) ?? []
    list.push(call)
    byRep.set(call.OwnerId, list)
  }

  // Compute metrics per rep
  const metrics: SFProfileCallMetrics[] = []
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  for (const [ownerId, repCalls] of byRep.entries()) {
    const totalCalls = repCalls.length
    const converted = repCalls.filter((c) => c.convertedToOpp).length
    const connected = repCalls.filter((c) => c.ringdnaConnected).length
    const ratings = repCalls.map((c) => c.ringdnaRating).filter((r): r is number => r !== null)
    const durations = repCalls.map((c) => c.ringdnaDurationMin).filter((d): d is number => d !== null)

    // Aggregate keywords
    const keywordCounts = new Map<string, number>()
    for (const call of repCalls) {
      if (!call.ringdnaKeywords) continue
      const words = call.ringdnaKeywords.split(/[,;]/).map((w) => w.trim()).filter(Boolean)
      for (const word of words) {
        keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1)
      }
    }
    const topKeywords = Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)

    metrics.push({
      repId: ownerId,
      repName: repCalls[0].OwnerName,
      totalCalls,
      converted,
      conversionRate: totalCalls > 0 ? Math.round((converted / totalCalls) * 1000) / 10 : 0,
      connectedCalls: connected,
      connectRate: totalCalls > 0 ? Math.round((connected / totalCalls) * 1000) / 10 : 0,
      avgDuration: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      avgRating: ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      callsThisWeek: repCalls.filter((c) => new Date(c.ActivityDate) >= weekAgo).length,
      callsThisMonth: repCalls.filter((c) => new Date(c.ActivityDate) >= monthAgo).length,
      topKeywords,
    })
  }

  return metrics.sort((a, b) => b.totalCalls - a.totalCalls)
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

/**
 * Aggregate top competitor/market keywords across all reps (for org-wide intel).
 * Uses RingDNA keywords from profile calls.
 */
export async function getTopCompetitorKeywords(
  client: SalesforceClient,
  startDate: string,
  endDate: string,
  limit: number = 10
): Promise<Array<{ keyword: string; mentions: number; calls: number }>> {
  const calls = await getProfileCalls(client, { startDate, endDate, limit: 2000 })

  const keywordMentions = new Map<string, number>()
  const keywordCalls = new Map<string, Set<string>>()

  for (const call of calls) {
    if (!call.ringdnaKeywords) continue
    const words = call.ringdnaKeywords.split(/[,;]/).map((w) => w.trim()).filter(Boolean)
    for (const word of words) {
      keywordMentions.set(word, (keywordMentions.get(word) ?? 0) + 1)
      const callSet = keywordCalls.get(word) ?? new Set()
      callSet.add(call.Id)
      keywordCalls.set(word, callSet)
    }
  }

  return Array.from(keywordMentions.entries())
    .map(([keyword, mentions]) => ({
      keyword,
      mentions,
      calls: keywordCalls.get(keyword)?.size ?? 0,
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit)
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
