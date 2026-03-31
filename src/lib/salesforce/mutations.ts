import { SalesforceClient } from './client'
import type { FulfillmentUpdate, SFProductUpdate, SFProduct } from './types'

/**
 * Update a single Opportunity with fulfillment data from Fishbowl.
 * Sets Fishbowl_SO_Number__c, Fulfillment_Status__c, Fulfillment_Error__c, Last_Sync_Attempt__c.
 */
export async function updateOpportunityFulfillment(
  client: SalesforceClient,
  opportunityId: string,
  data: FulfillmentUpdate
): Promise<{ success: boolean; error?: string }> {
  return client.withRetry(async (conn) => {
    try {
      const result = await conn.sobject('Opportunity').update({
        Id: opportunityId,
        Fishbowl_SO_Number__c: data.fishbowlSONumber ?? undefined,
        Fulfillment_Status__c: data.fulfillmentStatus,
        Fulfillment_Error__c: data.fulfillmentError ?? null,
        Last_Sync_Attempt__c: new Date().toISOString(),
      })

      if (!result.success) {
        const msg = result.errors?.map((e) => e.message).join('; ') ?? 'Unknown SF error'
        return { success: false, error: msg }
      }

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })
}

const BATCH_SIZE = 200

/**
 * Bulk update Product2 records with inventory levels from Fishbowl.
 * Matches by ProductCode, processes in batches of 200, and returns detailed results.
 */
export async function bulkUpdateProductInventory(
  client: SalesforceClient,
  products: SFProductUpdate[]
): Promise<{
  updated: number
  failed: number
  skipped: number
  errors: Array<{ productCode: string; error: string }>
}> {
  const result = { updated: 0, failed: 0, skipped: 0, errors: [] as Array<{ productCode: string; error: string }> }

  if (products.length === 0) return result

  return client.withRetry(async (conn) => {
    // Step 1: Look up Product2 IDs for all given ProductCodes
    const allCodes = products.map((p) => p.productCode)
    const codeToId = new Map<string, string>()

    // Query in batches to avoid overly long SOQL IN clauses
    for (let i = 0; i < allCodes.length; i += BATCH_SIZE) {
      const batch = allCodes.slice(i, i + BATCH_SIZE)
      const escaped = batch.map((c) => `'${c.replace(/'/g, "\\'")}'`).join(',')

      const found = await conn.query<SFProduct>(`
        SELECT Id, ProductCode
        FROM Product2
        WHERE ProductCode IN (${escaped})
      `)

      for (const rec of found.records) {
        if (rec.ProductCode) {
          codeToId.set(rec.ProductCode, rec.Id)
        }
      }
    }

    // Step 2: Build update records, skipping codes not found in SF
    const updateRecords: Array<{
      Id: string
      Qty_On_Hand__c: number
      Qty_Available__c: number
      Last_Inventory_Sync__c: string
    }> = []

    const codeByIndex: string[] = [] // track which productCode maps to which update index

    for (const product of products) {
      const sfId = codeToId.get(product.productCode)
      if (!sfId) {
        result.skipped++
        result.errors.push({
          productCode: product.productCode,
          error: `ProductCode not found in Salesforce — skipped`,
        })
        continue
      }

      updateRecords.push({
        Id: sfId,
        Qty_On_Hand__c: product.qtyOnHand,
        Qty_Available__c: product.qtyAvailable,
        Last_Inventory_Sync__c: new Date().toISOString(),
      })
      codeByIndex.push(product.productCode)
    }

    // Step 3: Update in batches of 200
    for (let i = 0; i < updateRecords.length; i += BATCH_SIZE) {
      const batch = updateRecords.slice(i, i + BATCH_SIZE)
      const batchCodes = codeByIndex.slice(i, i + BATCH_SIZE)

      const updateResults = await conn.sobject('Product2').update(batch)

      // Normalize: jsforce returns a single object for 1-element arrays
      const resultsArray = Array.isArray(updateResults)
        ? updateResults
        : [updateResults]

      for (let j = 0; j < resultsArray.length; j++) {
        const r = resultsArray[j]
        if (r.success) {
          result.updated++
        } else {
          result.failed++
          const msg = r.errors?.map((e) => e.message).join('; ') ?? 'Unknown error'
          result.errors.push({ productCode: batchCodes[j], error: msg })
        }
      }
    }

    return result
  })
}
