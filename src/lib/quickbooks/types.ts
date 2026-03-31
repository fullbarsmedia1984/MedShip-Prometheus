// QuickBooks type definitions

export interface QBInvoice {
  Id: string
  DocNumber: string
  TxnDate: string
  DueDate?: string
  TotalAmt: number
  Balance: number
  CustomerRef: {
    value: string
    name: string
  }
  Line: QBInvoiceLine[]
  BillEmail?: {
    Address: string
  }
  ShipAddr?: QBAddress
  BillAddr?: QBAddress
  EmailStatus?: string
  PrintStatus?: string
}

export interface QBInvoiceLine {
  Id: string
  LineNum: number
  Description?: string
  Amount: number
  DetailType: string
  SalesItemLineDetail?: {
    ItemRef: {
      value: string
      name: string
    }
    Qty: number
    UnitPrice: number
  }
}

export interface QBPayment {
  Id: string
  TxnDate: string
  TotalAmt: number
  CustomerRef: {
    value: string
    name: string
  }
  Line: Array<{
    Amount: number
    LinkedTxn: Array<{
      TxnId: string
      TxnType: string
    }>
  }>
  PaymentMethodRef?: {
    value: string
    name: string
  }
}

export interface QBCustomer {
  Id: string
  DisplayName: string
  CompanyName?: string
  PrimaryEmailAddr?: {
    Address: string
  }
  PrimaryPhone?: {
    FreeFormNumber: string
  }
  BillAddr?: QBAddress
  ShipAddr?: QBAddress
  Balance: number
}

export interface QBAddress {
  Line1?: string
  Line2?: string
  City?: string
  CountrySubDivisionCode?: string
  PostalCode?: string
  Country?: string
}

export interface QBConnectionConfig {
  environment: 'sandbox' | 'production'
  clientId: string
  clientSecret: string
  realmId: string
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: number
}

export interface QBApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}
