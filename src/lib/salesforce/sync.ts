import type { SalesforceClient } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'

const BATCH_SIZE = 500

async function updateSyncState(
  supabase: SupabaseClient,
  tableName: string,
  data: {
    recordCount: number
    durationMs: number
    error?: string
    isFullSync?: boolean
  }
) {
  const updates: Record<string, unknown> = {
    record_count: data.recordCount,
    last_sync_duration_ms: data.durationMs,
    last_error: data.error ?? null,
    last_incremental_sync_at: new Date().toISOString(),
    last_sync_high_watermark: new Date().toISOString(),
  }
  if (data.isFullSync) {
    updates.last_full_sync_at = new Date().toISOString()
  }

  await supabase
    .from('sf_sync_state')
    .update(updates)
    .eq('table_name', tableName)
}

async function upsertBatched(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'sf_id' })
    if (error) throw new Error(`Supabase upsert error on ${table}: ${error.message}`)
  }
}

export async function syncUsers(sf: SalesforceClient, supabase: SupabaseClient): Promise<number> {
  const start = Date.now()
  try {
    const conn = sf.getConnection()
    const result = await conn.query<Record<string, any>>(`
      SELECT Id, Name, Email, Username, IsActive, UserType, Profile.Name
      FROM User
      WHERE IsActive = true AND UserType = 'Standard'
    `)

    const rows = result.records.map((r) => ({
      sf_id: r.Id,
      name: r.Name,
      email: r.Email,
      username: r.Username,
      is_active: r.IsActive,
      user_type: r.UserType,
      profile_name: r.Profile?.Name,
      raw_data: r,
      last_synced_at: new Date().toISOString(),
    }))

    await upsertBatched(supabase, 'sf_users', rows)

    await updateSyncState(supabase, 'sf_users', {
      recordCount: rows.length,
      durationMs: Date.now() - start,
      isFullSync: true,
    })

    return rows.length
  } catch (error: any) {
    await updateSyncState(supabase, 'sf_users', {
      recordCount: 0,
      durationMs: Date.now() - start,
      error: error.message,
    })
    throw error
  }
}

export async function syncAccounts(sf: SalesforceClient, supabase: SupabaseClient): Promise<number> {
  const start = Date.now()
  try {
    const conn = sf.getConnection()
    const result = await conn.query<Record<string, any>>(`
      SELECT Id, Name, Type, Industry,
             BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry,
             ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode, ShippingCountry,
             Phone, Website, OwnerId,
             CreatedDate, LastModifiedDate
      FROM Account
      ORDER BY LastModifiedDate DESC
    `)

    const rows = result.records.map((r) => ({
      sf_id: r.Id,
      name: r.Name,
      type: r.Type,
      industry: r.Industry,
      billing_street: r.BillingStreet,
      billing_city: r.BillingCity,
      billing_state: r.BillingState,
      billing_postal_code: r.BillingPostalCode,
      billing_country: r.BillingCountry,
      shipping_street: r.ShippingStreet,
      shipping_city: r.ShippingCity,
      shipping_state: r.ShippingState,
      shipping_postal_code: r.ShippingPostalCode,
      shipping_country: r.ShippingCountry,
      phone: r.Phone,
      website: r.Website,
      owner_sf_id: r.OwnerId,
      created_date: r.CreatedDate,
      last_modified_date: r.LastModifiedDate,
      raw_data: r,
      last_synced_at: new Date().toISOString(),
    }))

    await upsertBatched(supabase, 'sf_accounts', rows)

    await updateSyncState(supabase, 'sf_accounts', {
      recordCount: rows.length,
      durationMs: Date.now() - start,
      isFullSync: true,
    })

    return rows.length
  } catch (error: any) {
    await updateSyncState(supabase, 'sf_accounts', {
      recordCount: 0,
      durationMs: Date.now() - start,
      error: error.message,
    })
    throw error
  }
}

export async function syncProducts(sf: SalesforceClient, supabase: SupabaseClient): Promise<number> {
  const start = Date.now()
  try {
    const conn = sf.getConnection()
    const result = await conn.query<Record<string, any>>(`
      SELECT Id, ProductCode, Name, Description, Family, IsActive,
             Qty_On_Hand__c, Qty_Available__c, Last_Inventory_Sync__c
      FROM Product2
    `)

    const rows = result.records.map((r) => ({
      sf_id: r.Id,
      product_code: r.ProductCode,
      name: r.Name,
      description: r.Description,
      family: r.Family,
      is_active: r.IsActive,
      qty_on_hand: r.Qty_On_Hand__c,
      qty_available: r.Qty_Available__c,
      last_inventory_sync: r.Last_Inventory_Sync__c,
      raw_data: r,
      last_synced_at: new Date().toISOString(),
    }))

    await upsertBatched(supabase, 'sf_products', rows)

    await updateSyncState(supabase, 'sf_products', {
      recordCount: rows.length,
      durationMs: Date.now() - start,
      isFullSync: true,
    })

    return rows.length
  } catch (error: any) {
    await updateSyncState(supabase, 'sf_products', {
      recordCount: 0,
      durationMs: Date.now() - start,
      error: error.message,
    })
    throw error
  }
}

export async function syncOpportunities(sf: SalesforceClient, supabase: SupabaseClient): Promise<number> {
  const start = Date.now()
  try {
    const conn = sf.getConnection()
    const result = await conn.query<Record<string, any>>(`
      SELECT Id, Name, AccountId, OwnerId, StageName, Amount, CloseDate,
             Probability, ForecastCategory, Type, LeadSource,
             IsClosed, IsWon,
             Fishbowl_SO_Number__c, Fulfillment_Status__c,
             Fulfillment_Error__c, Last_Sync_Attempt__c,
             CreatedDate, LastModifiedDate
      FROM Opportunity
    `)

    const rows = result.records.map((r) => ({
      sf_id: r.Id,
      name: r.Name,
      account_sf_id: r.AccountId,
      owner_sf_id: r.OwnerId,
      stage_name: r.StageName,
      amount: r.Amount,
      close_date: r.CloseDate,
      probability: r.Probability,
      forecast_category: r.ForecastCategory,
      type: r.Type,
      lead_source: r.LeadSource,
      is_closed: r.IsClosed,
      is_won: r.IsWon,
      fishbowl_so_number: r.Fishbowl_SO_Number__c,
      fulfillment_status: r.Fulfillment_Status__c,
      fulfillment_error: r.Fulfillment_Error__c,
      last_sync_attempt: r.Last_Sync_Attempt__c,
      created_date: r.CreatedDate,
      last_modified_date: r.LastModifiedDate,
      raw_data: r,
      last_synced_at: new Date().toISOString(),
    }))

    await upsertBatched(supabase, 'sf_opportunities', rows)

    await updateSyncState(supabase, 'sf_opportunities', {
      recordCount: rows.length,
      durationMs: Date.now() - start,
      isFullSync: true,
    })

    return rows.length
  } catch (error: any) {
    await updateSyncState(supabase, 'sf_opportunities', {
      recordCount: 0,
      durationMs: Date.now() - start,
      error: error.message,
    })
    throw error
  }
}

export async function syncOpportunityLineItems(sf: SalesforceClient, supabase: SupabaseClient): Promise<number> {
  const start = Date.now()
  try {
    const conn = sf.getConnection()
    const result = await conn.query<Record<string, any>>(`
      SELECT Id, OpportunityId, Product2Id, Product2.ProductCode, Product2.Name,
             Quantity, UnitPrice, TotalPrice
      FROM OpportunityLineItem
    `)

    const rows = result.records.map((r) => ({
      sf_id: r.Id,
      opportunity_sf_id: r.OpportunityId,
      product_sf_id: r.Product2Id,
      product_code: r.Product2?.ProductCode,
      product_name: r.Product2?.Name,
      quantity: r.Quantity,
      unit_price: r.UnitPrice,
      total_price: r.TotalPrice,
      raw_data: r,
      last_synced_at: new Date().toISOString(),
    }))

    await upsertBatched(supabase, 'sf_opportunity_line_items', rows)

    await updateSyncState(supabase, 'sf_opportunity_line_items', {
      recordCount: rows.length,
      durationMs: Date.now() - start,
      isFullSync: true,
    })

    return rows.length
  } catch (error: any) {
    await updateSyncState(supabase, 'sf_opportunity_line_items', {
      recordCount: 0,
      durationMs: Date.now() - start,
      error: error.message,
    })
    throw error
  }
}

// Profile call fields shared by both Task and Event queries
const PROFILE_CALL_FIELDS = `
  Id, Subject, OwnerId, AccountId, WhoId, Who.Name,
  ActivityDate, Status, CreatedDate, LastModifiedDate,
  Profile_Call_Type__c, Profile_Call_Outcome__c, Products_Discussed__c,
  Program_Size__c, Current_Supplier__c, Budget_Available__c,
  Budget_Timeframe__c, Follow_Up_Date__c, Converted_to_Opp__c,
  Related_Opportunity__c,
  Call_Notes_Summary__c, Competitor_Intel__c,
  ringdna__Call_Direction__c, ringdna__Call_Duration_min__c,
  ringdna__Call_Connected__c, ringdna__Call_Rating__c,
  ringdna__Call_Recording_URL__c, ringdna__Voicemail__c,
  ringdna__Keywords__c, ringdna__Call_Start_Time__c,
  ringdna__Call_Disposition__c,
  Calendly__IsNoShow__c, Calendly__IsRescheduled__c
`

function mapProfileCallRow(r: Record<string, any>, activityType: string) {
  return {
    sf_id: r.Id,
    activity_type: activityType,
    subject: r.Subject,
    owner_sf_id: r.OwnerId,
    account_sf_id: r.AccountId,
    who_sf_id: r.WhoId,
    who_name: r.Who?.Name,
    activity_date: r.ActivityDate,
    status: r.Status,
    profile_call_type: r.Profile_Call_Type__c,
    profile_call_outcome: r.Profile_Call_Outcome__c,
    products_discussed: r.Products_Discussed__c,
    program_size: r.Program_Size__c,
    current_supplier: r.Current_Supplier__c,
    budget_available: r.Budget_Available__c,
    budget_timeframe: r.Budget_Timeframe__c,
    follow_up_date: r.Follow_Up_Date__c,
    converted_to_opp: r.Converted_to_Opp__c ?? false,
    related_opportunity_sf_id: r.Related_Opportunity__c,
    call_notes_summary: r.Call_Notes_Summary__c,
    competitor_intel: r.Competitor_Intel__c,
    ringdna_direction: r.ringdna__Call_Direction__c,
    ringdna_duration_min: r.ringdna__Call_Duration_min__c,
    ringdna_connected: r.ringdna__Call_Connected__c ?? false,
    ringdna_rating: r.ringdna__Call_Rating__c,
    ringdna_recording_url: r.ringdna__Call_Recording_URL__c,
    ringdna_voicemail: r.ringdna__Voicemail__c ?? false,
    ringdna_keywords: r.ringdna__Keywords__c,
    ringdna_start_time: r.ringdna__Call_Start_Time__c,
    ringdna_disposition: r.ringdna__Call_Disposition__c,
    calendly_no_show: r.Calendly__IsNoShow__c ?? false,
    calendly_rescheduled: r.Calendly__IsRescheduled__c ?? false,
    created_date: r.CreatedDate,
    last_modified_date: r.LastModifiedDate,
    raw_data: r,
    last_synced_at: new Date().toISOString(),
  }
}

export async function syncProfileCalls(sf: SalesforceClient, supabase: SupabaseClient): Promise<number> {
  const start = Date.now()
  try {
    const conn = sf.getConnection()
    const whereClause = "RecordType.DeveloperName = 'Profile_Call'"

    // Query Task and Event in parallel
    const [taskResults, eventResults] = await Promise.all([
      conn.query<Record<string, any>>(
        `SELECT ${PROFILE_CALL_FIELDS} FROM Task WHERE ${whereClause} ORDER BY ActivityDate DESC`
      ),
      conn.query<Record<string, any>>(
        `SELECT ${PROFILE_CALL_FIELDS} FROM Event WHERE ${whereClause} ORDER BY ActivityDate DESC`
      ),
    ])

    const taskRows = taskResults.records.map((r) => mapProfileCallRow(r, 'Task'))
    const eventRows = eventResults.records.map((r) => mapProfileCallRow(r, 'Event'))
    const allRows = [...taskRows, ...eventRows]

    await upsertBatched(supabase, 'sf_profile_calls', allRows)

    await updateSyncState(supabase, 'sf_profile_calls', {
      recordCount: allRows.length,
      durationMs: Date.now() - start,
      isFullSync: true,
    })

    return allRows.length
  } catch (error: any) {
    await updateSyncState(supabase, 'sf_profile_calls', {
      recordCount: 0,
      durationMs: Date.now() - start,
      error: error.message,
    })
    throw error
  }
}

/**
 * Incremental sync: only fetch records modified since the high watermark.
 * Returns total records upserted across all tables.
 */
export async function syncIncremental(sf: SalesforceClient, supabase: SupabaseClient): Promise<number> {
  const { data: syncStates } = await supabase
    .from('sf_sync_state')
    .select('table_name, last_sync_high_watermark')

  if (!syncStates) return 0

  const watermarks = new Map(syncStates.map((s) => [s.table_name, s.last_sync_high_watermark]))
  let total = 0
  const conn = sf.getConnection()

  // Accounts incremental
  const accountsWm = watermarks.get('sf_accounts')
  if (accountsWm) {
    const start = Date.now()
    const result = await conn.query<Record<string, any>>(`
      SELECT Id, Name, Type, Industry,
             BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry,
             ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode, ShippingCountry,
             Phone, Website, OwnerId, CreatedDate, LastModifiedDate
      FROM Account
      WHERE LastModifiedDate >= ${accountsWm}
    `)
    if (result.records.length > 0) {
      const rows = result.records.map((r) => ({
        sf_id: r.Id, name: r.Name, type: r.Type, industry: r.Industry,
        billing_street: r.BillingStreet, billing_city: r.BillingCity,
        billing_state: r.BillingState, billing_postal_code: r.BillingPostalCode,
        billing_country: r.BillingCountry,
        shipping_street: r.ShippingStreet, shipping_city: r.ShippingCity,
        shipping_state: r.ShippingState, shipping_postal_code: r.ShippingPostalCode,
        shipping_country: r.ShippingCountry,
        phone: r.Phone, website: r.Website, owner_sf_id: r.OwnerId,
        created_date: r.CreatedDate, last_modified_date: r.LastModifiedDate,
        raw_data: r, last_synced_at: new Date().toISOString(),
      }))
      await upsertBatched(supabase, 'sf_accounts', rows)
      await updateSyncState(supabase, 'sf_accounts', { recordCount: rows.length, durationMs: Date.now() - start })
      total += rows.length
    }
  }

  // Opportunities incremental
  const oppsWm = watermarks.get('sf_opportunities')
  if (oppsWm) {
    const start = Date.now()
    const result = await conn.query<Record<string, any>>(`
      SELECT Id, Name, AccountId, OwnerId, StageName, Amount, CloseDate,
             Probability, ForecastCategory, Type, LeadSource,
             IsClosed, IsWon, Fishbowl_SO_Number__c, Fulfillment_Status__c,
             Fulfillment_Error__c, Last_Sync_Attempt__c, CreatedDate, LastModifiedDate
      FROM Opportunity
      WHERE LastModifiedDate >= ${oppsWm}
    `)
    if (result.records.length > 0) {
      const rows = result.records.map((r) => ({
        sf_id: r.Id, name: r.Name, account_sf_id: r.AccountId, owner_sf_id: r.OwnerId,
        stage_name: r.StageName, amount: r.Amount, close_date: r.CloseDate,
        probability: r.Probability, forecast_category: r.ForecastCategory,
        type: r.Type, lead_source: r.LeadSource, is_closed: r.IsClosed, is_won: r.IsWon,
        fishbowl_so_number: r.Fishbowl_SO_Number__c, fulfillment_status: r.Fulfillment_Status__c,
        fulfillment_error: r.Fulfillment_Error__c, last_sync_attempt: r.Last_Sync_Attempt__c,
        created_date: r.CreatedDate, last_modified_date: r.LastModifiedDate,
        raw_data: r, last_synced_at: new Date().toISOString(),
      }))
      await upsertBatched(supabase, 'sf_opportunities', rows)
      await updateSyncState(supabase, 'sf_opportunities', { recordCount: rows.length, durationMs: Date.now() - start })
      total += rows.length
    }
  }

  // Profile calls incremental
  const callsWm = watermarks.get('sf_profile_calls')
  if (callsWm) {
    const start = Date.now()
    const where = `RecordType.DeveloperName = 'Profile_Call' AND LastModifiedDate >= ${callsWm}`
    const [taskResults, eventResults] = await Promise.all([
      conn.query<Record<string, any>>(`SELECT ${PROFILE_CALL_FIELDS} FROM Task WHERE ${where}`),
      conn.query<Record<string, any>>(`SELECT ${PROFILE_CALL_FIELDS} FROM Event WHERE ${where}`),
    ])
    const rows = [
      ...taskResults.records.map((r) => mapProfileCallRow(r, 'Task')),
      ...eventResults.records.map((r) => mapProfileCallRow(r, 'Event')),
    ]
    if (rows.length > 0) {
      await upsertBatched(supabase, 'sf_profile_calls', rows)
      await updateSyncState(supabase, 'sf_profile_calls', { recordCount: rows.length, durationMs: Date.now() - start })
      total += rows.length
    }
  }

  return total
}
