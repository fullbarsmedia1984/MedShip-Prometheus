import { getSalesforceConnection } from './client'
import type {
  SFOpportunity,
  SFAccount,
  SFOpportunityLineItem,
  SFProduct,
  SFQueryResult,
} from './types'

/**
 * Get a single Opportunity by ID with related Account
 */
export async function getOpportunityById(
  opportunityId: string
): Promise<SFOpportunity | null> {
  // TODO: Implement in Phase 1
  const conn = await getSalesforceConnection()

  const result = await conn.query<SFOpportunity>(`
    SELECT
      Id, Name, AccountId, Amount, StageName, CloseDate,
      IsClosed, IsWon, Description,
      Fishbowl_SO_Number__c, Tracking_Number__c
    FROM Opportunity
    WHERE Id = '${opportunityId}'
    LIMIT 1
  `)

  return result.records[0] || null
}

/**
 * Get Opportunity Line Items for an Opportunity
 */
export async function getOpportunityLineItems(
  opportunityId: string
): Promise<SFOpportunityLineItem[]> {
  // TODO: Implement in Phase 1
  const conn = await getSalesforceConnection()

  const result = await conn.query<SFOpportunityLineItem>(`
    SELECT
      Id, OpportunityId, Product2Id, Quantity, UnitPrice, TotalPrice,
      Product2.Id, Product2.Name, Product2.ProductCode
    FROM OpportunityLineItem
    WHERE OpportunityId = '${opportunityId}'
  `)

  return result.records
}

/**
 * Get Account by ID with shipping/billing addresses
 */
export async function getAccountById(accountId: string): Promise<SFAccount | null> {
  // TODO: Implement in Phase 1
  const conn = await getSalesforceConnection()

  const result = await conn.query<SFAccount>(`
    SELECT
      Id, Name, Phone,
      ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode, ShippingCountry,
      BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry
    FROM Account
    WHERE Id = '${accountId}'
    LIMIT 1
  `)

  return result.records[0] || null
}

/**
 * Get recently closed-won Opportunities
 * Used for manual sync or catching missed webhooks
 */
export async function getRecentClosedWonOpportunities(
  sinceDate: Date
): Promise<SFOpportunity[]> {
  // TODO: Implement in Phase 1
  const conn = await getSalesforceConnection()
  const isoDate = sinceDate.toISOString()

  const result = await conn.query<SFOpportunity>(`
    SELECT
      Id, Name, AccountId, Amount, StageName, CloseDate,
      IsClosed, IsWon, Description, Fishbowl_SO_Number__c
    FROM Opportunity
    WHERE IsWon = true
      AND CloseDate >= ${isoDate.split('T')[0]}
      AND Fishbowl_SO_Number__c = null
    ORDER BY CloseDate DESC
    LIMIT 100
  `)

  return result.records
}

/**
 * Get all active Products for inventory sync
 */
export async function getActiveProducts(): Promise<SFProduct[]> {
  // TODO: Implement in Phase 2
  const conn = await getSalesforceConnection()

  const result = await conn.query<SFProduct>(`
    SELECT
      Id, Name, ProductCode, Description, IsActive,
      Qty_On_Hand__c, Qty_Available__c, Last_Inventory_Sync__c
    FROM Product2
    WHERE IsActive = true
    ORDER BY ProductCode
  `)

  return result.records
}

/**
 * Search Products by ProductCode (part number)
 */
export async function getProductByCode(productCode: string): Promise<SFProduct | null> {
  // TODO: Implement in Phase 2
  const conn = await getSalesforceConnection()

  const result = await conn.query<SFProduct>(`
    SELECT
      Id, Name, ProductCode, Description, IsActive,
      Qty_On_Hand__c, Qty_Available__c
    FROM Product2
    WHERE ProductCode = '${productCode}'
    LIMIT 1
  `)

  return result.records[0] || null
}
