// Salesforce object type definitions

export interface SFOpportunity {
  Id: string
  Name: string
  AccountId: string
  Amount?: number
  StageName: string
  CloseDate: string
  IsClosed: boolean
  IsWon: boolean
  Description?: string
  // Custom fields - add as needed
  Fishbowl_SO_Number__c?: string
  Tracking_Number__c?: string
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
  Email__c?: string
}

export interface SFOpportunityLineItem {
  Id: string
  OpportunityId: string
  Product2Id: string
  Quantity: number
  UnitPrice: number
  TotalPrice: number
  Product2?: SFProduct
}

export interface SFProduct {
  Id: string
  Name: string
  ProductCode?: string
  Description?: string
  IsActive: boolean
  // Inventory fields synced from Fishbowl
  Qty_On_Hand__c?: number
  Qty_Available__c?: number
  Last_Inventory_Sync__c?: string
}

export interface SFContact {
  Id: string
  FirstName?: string
  LastName: string
  Email?: string
  Phone?: string
  AccountId?: string
}

export interface SFConnectionConfig {
  loginUrl: string
  clientId: string
  clientSecret: string
  username: string
  password: string
  securityToken: string
  accessToken?: string
  refreshToken?: string
  instanceUrl?: string
  tokenExpiresAt?: number
}

export interface SFQueryResult<T> {
  totalSize: number
  done: boolean
  records: T[]
  nextRecordsUrl?: string
}
