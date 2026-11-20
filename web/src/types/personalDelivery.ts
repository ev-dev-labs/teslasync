export interface PersonalDeliveryDevice {
  id: number
  verified: boolean
  charging_enabled: boolean
  commute_enabled: boolean
  created_at: string
  updated_at: string
}

export interface PersonalDeliveryDevices {
  available: boolean
  commute_available: boolean
  public_key: string
  devices: PersonalDeliveryDevice[]
}

export interface PersonalDeliverySubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PersonalDeliveryTexts {
  verification_title: string
  verification_body: string
  charging_title: string
  charging_body: string
}
