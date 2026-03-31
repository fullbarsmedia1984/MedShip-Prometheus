import { getSalesforceConnection } from './client'

interface UpdateResult {
  id: string
  success: boolean
  errors?: Array<{ message: string }>
}

/**
 * Update Opportunity with Fishbowl SO number
 */
export async function updateOpportunitySONumber(
  opportunityId: string,
  soNumber: string
): Promise<UpdateResult> {
  // TODO: Implement in Phase 1
  const conn = await getSalesforceConnection()

  const result = await conn.sobject('Opportunity').update({
    Id: opportunityId,
    Fishbowl_SO_Number__c: soNumber,
  })

  return {
    id: opportunityId,
    success: result.success,
    errors: result.errors?.map((e) => ({ message: e.message })),
  }
}

/**
 * Update Opportunity with tracking number
 */
export async function updateOpportunityTracking(
  opportunityId: string,
  trackingNumber: string
): Promise<UpdateResult> {
  // TODO: Implement in Phase 4
  const conn = await getSalesforceConnection()

  const result = await conn.sobject('Opportunity').update({
    Id: opportunityId,
    Tracking_Number__c: trackingNumber,
  })

  return {
    id: opportunityId,
    success: result.success,
    errors: result.errors?.map((e) => ({ message: e.message })),
  }
}

/**
 * Bulk update Product inventory levels
 */
export async function bulkUpdateProductInventory(
  updates: Array<{
    productId: string
    qtyOnHand: number
    qtyAvailable: number
  }>
): Promise<UpdateResult[]> {
  // TODO: Implement in Phase 2
  const conn = await getSalesforceConnection()

  const records = updates.map((u) => ({
    Id: u.productId,
    Qty_On_Hand__c: u.qtyOnHand,
    Qty_Available__c: u.qtyAvailable,
    Last_Inventory_Sync__c: new Date().toISOString(),
  }))

  const results = await conn.sobject('Product2').update(records)

  // Normalize results (could be single object or array)
  const resultsArray = Array.isArray(results) ? results : [results]

  return resultsArray.map((r, i) => ({
    id: updates[i].productId,
    success: r.success,
    errors: r.errors?.map((e) => ({ message: e.message })),
  }))
}

/**
 * Create a new Contact
 */
export async function createContact(contact: {
  firstName?: string
  lastName: string
  email?: string
  phone?: string
  accountId?: string
}): Promise<UpdateResult> {
  // TODO: Implement as needed
  const conn = await getSalesforceConnection()

  const result = await conn.sobject('Contact').create({
    FirstName: contact.firstName,
    LastName: contact.lastName,
    Email: contact.email,
    Phone: contact.phone,
    AccountId: contact.accountId,
  })

  return {
    id: result.id || '',
    success: result.success,
    errors: result.errors?.map((e) => ({ message: e.message })),
  }
}
