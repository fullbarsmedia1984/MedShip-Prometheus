// EasyPost type definitions

export interface EPShipment {
  id: string
  mode: 'test' | 'production'
  created_at: string
  updated_at: string
  tracking_code?: string
  status: string
  buyer_address: EPAddress
  from_address: EPAddress
  to_address: EPAddress
  parcel: EPParcel
  selected_rate?: EPRate
  rates: EPRate[]
  postage_label?: {
    id: string
    label_url: string
    label_pdf_url: string
    label_zpl_url: string
  }
  tracker?: EPTracker
}

export interface EPAddress {
  id?: string
  name?: string
  company?: string
  street1: string
  street2?: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
  email?: string
  residential?: boolean
}

export interface EPParcel {
  id?: string
  length: number
  width: number
  height: number
  weight: number
  predefined_package?: string
}

export interface EPRate {
  id: string
  carrier: string
  service: string
  rate: string
  currency: string
  delivery_days?: number
  delivery_date?: string
  est_delivery_days?: number
}

export interface EPTracker {
  id: string
  tracking_code: string
  status: EPTrackingStatus
  status_detail: string
  carrier: string
  tracking_details: EPTrackingDetail[]
  est_delivery_date?: string
  created_at: string
  updated_at: string
}

export type EPTrackingStatus =
  | 'unknown'
  | 'pre_transit'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'available_for_pickup'
  | 'return_to_sender'
  | 'failure'
  | 'cancelled'
  | 'error'

export interface EPTrackingDetail {
  datetime: string
  message: string
  status: EPTrackingStatus
  status_detail: string
  tracking_location?: {
    city?: string
    state?: string
    country?: string
    zip?: string
  }
}

export interface EPWebhookEvent {
  id: string
  object: string
  mode: 'test' | 'production'
  description: string
  result: EPTracker | EPShipment
  previous_attributes?: Record<string, unknown>
  created_at: string
  updated_at: string
}
