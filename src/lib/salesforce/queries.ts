import { SalesforceClient } from './client'
import type { SFOpportunity, SFProduct } from './types'

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
