// Fishbowl API type definitions

export interface FBInventoryItem {
  partId: number
  partNumber: string
  partDescription: string
  qtyOnHand: number
  qtyAllocated: number
  qtyAvailable: number
  uom: string
  location?: string
  avgCost?: number
  lastCountDate?: string
}

export interface FBSalesOrder {
  soNum?: string
  status: string
  customerName: string
  customerPO?: string
  carrier?: string
  dateScheduledFulfillment?: string
  billTo: FBAddress
  shipTo: FBAddress
  items: FBSalesOrderItem[]
  note?: string
}

export interface FBSalesOrderItem {
  productNumber: string
  description?: string
  quantity: number
  unitPrice: number
  uom?: string
  taxable?: boolean
}

export interface FBAddress {
  name: string
  address?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  phone?: string
  email?: string
}

export interface FBShipment {
  shipmentId: number
  soNum: string
  status: string
  carrier: string
  trackingNumber?: string
  dateShipped?: string
  dateDelivered?: string
  items: FBShipmentItem[]
}

export interface FBShipmentItem {
  partNumber: string
  qtyShipped: number
  uom: string
}

export interface FBCustomer {
  customerId: number
  name: string
  accountNumber?: string
  status: string
  defaultShipTo?: FBAddress
  defaultBillTo?: FBAddress
}

export interface FBApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface FBConnectionConfig {
  apiUrl: string
  username: string
  password: string
  token?: string
  tokenExpiresAt?: number
}
