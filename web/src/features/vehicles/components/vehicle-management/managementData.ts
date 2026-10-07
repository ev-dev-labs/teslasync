export type ManagementRecord = Record<string, unknown>

export interface VehicleOptionData {
  code: string | null
  displayName: string | null
  isActive: boolean | null
  colorCode: string | null
}

export type WarrantyCoverageState = 'active' | 'upcoming' | 'expired'

export interface WarrantyCoverageData {
  state: WarrantyCoverageState
  displayName: string | null
  code: string | null
  coverageAgeYears: number | null
  coverageAgeMonths: number | null
  expirationOdometer: number | null
  expirationDate: string | null
}

export interface WarrantyDetailsData {
  active: WarrantyCoverageData[]
  upcoming: WarrantyCoverageData[]
  expired: WarrantyCoverageData[]
}

export interface SubscriptionBillingData {
  price: number | null
  total: number | null
  currencyCode: string | null
  billingPeriod: string | null
}

export interface SubscriptionOfferData {
  product: string | null
  optionCode: string | null
  billingOptions: SubscriptionBillingData[]
}

export interface SubscriptionEligibilityData {
  country: string | null
  offers: SubscriptionOfferData[]
}

export interface ManagementScalarField {
  key: string
  label: string
  value: string | number | boolean
}

export function asManagementRecord(value: unknown): ManagementRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as ManagementRecord
}

function firstValue(
  record: ManagementRecord,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

function readString(
  record: ManagementRecord,
  keys: readonly string[],
): string | null {
  const value = firstValue(record, keys)
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function readNumber(
  record: ManagementRecord,
  keys: readonly string[],
): number | null {
  const value = firstValue(record, keys)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readBoolean(
  record: ManagementRecord,
  keys: readonly string[],
): boolean | null {
  const value = firstValue(record, keys)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

function recordArray(value: unknown): ManagementRecord[] {
  if (Array.isArray(value)) {
    return value
      .map(asManagementRecord)
      .filter((item): item is ManagementRecord => item !== null)
  }
  const record = asManagementRecord(value)
  return record ? [record] : []
}

function readRecordArray(
  record: ManagementRecord,
  keys: readonly string[],
): ManagementRecord[] {
  return recordArray(firstValue(record, keys))
}

export function humanizeManagementLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  return words
    .map((word) => {
      const upper = word.toUpperCase()
      if (['API', 'FSD', 'ID', 'VIN', 'USD'].includes(upper)) return upper
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    })
    .join(' ')
}

export function parseManagementScalarFields(
  value: unknown,
): ManagementScalarField[] {
  const record = asManagementRecord(value)
  if (!record) return []

  const seen = new Set<string>()
  const fields: ManagementScalarField[] = []
  for (const [key, fieldValue] of Object.entries(record)) {
    if (
      typeof fieldValue !== 'string' &&
      !(typeof fieldValue === 'number' && Number.isFinite(fieldValue)) &&
      typeof fieldValue !== 'boolean'
    ) {
      continue
    }

    // camelCaseKeys preserves the original Tesla key and adds a camelCase
    // alias. Collapse both shapes into one visual field.
    const canonicalKey = key.replace(/[_-]/g, '').toLowerCase()
    if (seen.has(canonicalKey)) continue
    seen.add(canonicalKey)
    fields.push({
      key,
      label: humanizeManagementLabel(key),
      value: fieldValue,
    })
  }
  return fields
}

export function parseEnterpriseRoles(value: unknown): string[] {
  const record = asManagementRecord(value)
  const rawRoles = record
    ? firstValue(record, ['roles', 'items', 'permissions'])
    : value
  if (!Array.isArray(rawRoles)) return []

  return rawRoles
    .map((role) => {
      if (typeof role === 'string' && role.trim()) return role.trim()
      const roleRecord = asManagementRecord(role)
      return roleRecord
        ? readString(roleRecord, [
            'displayName',
            'display_name',
            'role',
            'name',
            'code',
          ])
        : null
    })
    .filter((role): role is string => role !== null)
}

export function parseVehicleOptions(value: unknown): VehicleOptionData[] {
  const record = asManagementRecord(value)
  const rows = Array.isArray(value)
    ? recordArray(value)
    : record
      ? readRecordArray(record, [
          'codes',
          'optionCodes',
          'option_codes',
          'options',
        ])
      : []

  return rows
    .map((item) => ({
      code: readString(item, ['code', 'optionCode', 'option_code']),
      displayName: readString(item, [
        'displayName',
        'display_name',
        'name',
        'title',
      ]),
      isActive: readBoolean(item, ['isActive', 'is_active', 'active']),
      colorCode: readString(item, ['colorCode', 'color_code']),
    }))
    .filter((item) => item.code !== null || item.displayName !== null)
}

function parseWarrantyGroup(
  record: ManagementRecord,
  state: WarrantyCoverageState,
  keys: readonly string[],
): WarrantyCoverageData[] {
  return readRecordArray(record, keys).map((item) => ({
    state,
    displayName: readString(item, [
      'warrantyDisplayName',
      'warranty_display_name',
      'displayName',
      'display_name',
      'name',
    ]),
    code: readString(item, [
      'warrantyCode',
      'warranty_code',
      'code',
      'type',
    ]),
    coverageAgeYears: readNumber(item, [
      'coverageAgeInYears',
      'coverage_age_in_years',
      'coverageYears',
      'coverage_years',
    ]),
    coverageAgeMonths: readNumber(item, [
      'coverageAgeInMonths',
      'coverage_age_in_months',
      'coverageMonths',
      'coverage_months',
    ]),
    expirationOdometer: readNumber(item, [
      'expirationOdometer',
      'expiration_odometer',
      'odometerLimit',
      'odometer_limit',
    ]),
    expirationDate: readString(item, [
      'warrantyExpiredOn',
      'warranty_expired_on',
      'warrantyExpirationDate',
      'warranty_expiration_date',
      'expirationDate',
      'expiration_date',
      'expiryDate',
      'expiry_date',
      'endDate',
      'end_date',
    ]),
  }))
}

export function parseWarrantyDetails(value: unknown): WarrantyDetailsData {
  const record = asManagementRecord(value)
  if (!record) return { active: [], upcoming: [], expired: [] }

  const active = parseWarrantyGroup(record, 'active', [
    'activeWarranty',
    'active_warranty',
    'activeWarranties',
    'active_warranties',
  ])
  const upcoming = parseWarrantyGroup(record, 'upcoming', [
    'upcomingWarranty',
    'upcoming_warranty',
    'upcomingWarranties',
    'upcoming_warranties',
  ])
  const expired = parseWarrantyGroup(record, 'expired', [
    'expiredWarranty',
    'expired_warranty',
    'expiredWarranties',
    'expired_warranties',
  ])

  if (
    active.length === 0 &&
    upcoming.length === 0 &&
    expired.length === 0 &&
    readString(record, [
      'warrantyDisplayName',
      'warranty_display_name',
      'displayName',
      'display_name',
    ])
  ) {
    return {
      active: [
        {
          state: 'active',
          displayName: readString(record, [
            'warrantyDisplayName',
            'warranty_display_name',
            'displayName',
            'display_name',
          ]),
          code: readString(record, [
            'warrantyCode',
            'warranty_code',
            'code',
            'type',
          ]),
          coverageAgeYears: readNumber(record, [
            'coverageAgeInYears',
            'coverage_age_in_years',
            'coverageYears',
            'coverage_years',
          ]),
          coverageAgeMonths: readNumber(record, [
            'coverageAgeInMonths',
            'coverage_age_in_months',
            'coverageMonths',
            'coverage_months',
          ]),
          expirationOdometer: readNumber(record, [
            'expirationOdometer',
            'expiration_odometer',
            'odometerLimit',
            'odometer_limit',
          ]),
          expirationDate: readString(record, [
            'warrantyExpiredOn',
            'warranty_expired_on',
            'warrantyExpirationDate',
            'warranty_expiration_date',
            'expirationDate',
            'expiration_date',
            'expiryDate',
            'expiry_date',
          ]),
        },
      ],
      upcoming: [],
      expired: [],
    }
  }

  return { active, upcoming, expired }
}

function parseBillingOptions(value: unknown): SubscriptionBillingData[] {
  return recordArray(value).map((item) => ({
    price: readNumber(item, ['price', 'amount']),
    total: readNumber(item, ['total', 'totalPrice', 'total_price']),
    currencyCode: readString(item, [
      'currencyCode',
      'currency_code',
      'currency',
    ]),
    billingPeriod: readString(item, [
      'billingPeriod',
      'billing_period',
      'period',
    ]),
  }))
}

export function parseSubscriptionEligibility(
  value: unknown,
): SubscriptionEligibilityData {
  const record = asManagementRecord(value)
  if (!record) return { country: null, offers: [] }

  const offerRows = readRecordArray(record, [
    'eligible',
    'subscriptions',
    'offers',
    'products',
  ])
  return {
    country: readString(record, ['country', 'countryCode', 'country_code']),
    offers: offerRows.map((item) => ({
      product: readString(item, [
        'product',
        'productName',
        'product_name',
        'displayName',
        'display_name',
        'name',
      ]),
      optionCode: readString(item, [
        'optionCode',
        'option_code',
        'code',
      ]),
      billingOptions: parseBillingOptions(
        firstValue(item, [
          'billingOptions',
          'billing_options',
          'pricing',
          'prices',
        ]),
      ),
    })),
  }
}
