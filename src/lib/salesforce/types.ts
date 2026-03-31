// Salesforce-specific type definitions

import type { Connection } from 'jsforce'

// --- Connection Config ---

export interface SFConnectionConfig {
  loginUrl: string
  clientId?: string
  clientSecret?: string
  username: string
  password: string
  securityToken: string
}

// --- Client Interface ---

export interface ISalesforceClient {
  connect(): Promise<void>
  getConnection(): Connection
  isConnected(): boolean
  testConnection(): Promise<{ success: boolean; error?: string; orgId?: string }>
  disconnect(): Promise<void>
}

// --- Salesforce Object Types ---

export interface SFOpportunity {
  Id: string
  Name: string
  AccountId: string
  Account?: {
    Name: string
    ShippingStreet?: string
    ShippingCity?: string
    ShippingState?: string
    ShippingPostalCode?: string
    ShippingCountry?: string
  }
  CloseDate: string
  Amount?: number
  StageName: string
  Fishbowl_SO_Number__c?: string | null
  Fulfillment_Status__c?: string | null
  Fulfillment_Error__c?: string | null
  Last_Sync_Attempt__c?: string | null
  OpportunityLineItems?: {
    records: SFOpportunityLineItem[]
  }
}

export interface SFOpportunityLineItem {
  Id: string
  Product2: {
    ProductCode: string
    Name: string
  }
  Quantity: number
  UnitPrice: number
  TotalPrice: number
}

export interface SFProduct {
  Id: string
  Name: string
  ProductCode?: string
  Description?: string
  IsActive: boolean
  Qty_On_Hand__c?: number
  Qty_Available__c?: number
  Last_Inventory_Sync__c?: string
}

export interface SFAccount {
  Id: string
  Name: string
  ShippingStreet?: string
  ShippingCity?: string
  ShippingState?: string
  ShippingPostalCode?: string
  ShippingCountry?: string
  BillingStreet?: string
  BillingCity?: string
  BillingState?: string
  BillingPostalCode?: string
  BillingCountry?: string
  Phone?: string
}

// --- Mutation Payloads ---

export interface FulfillmentUpdate {
  fishbowlSONumber?: string
  fulfillmentStatus: string
  fulfillmentError?: string | null
}

export interface SFProductUpdate {
  productCode: string
  qtyOnHand: number
  qtyAvailable: number
}

// --- Query Helpers ---

export interface SFQueryResult<T> {
  totalSize: number
  done: boolean
  records: T[]
  nextRecordsUrl?: string
}
