import { describe, expect, it } from 'vitest'
import {
  isSensitiveManagementKey,
  parseNonEmptyJSONObject,
  summarizeManagementData,
} from './managementJson'
import {
  humanizeManagementLabel,
  parseEnterpriseRoles,
  parseManagementScalarFields,
  parseSubscriptionEligibility,
  parseVehicleOptions,
  parseWarrantyDetails,
} from './managementData'

describe('parseNonEmptyJSONObject', () => {
  it.each([
    ['malformed', '{', 'invalid'],
    ['trailing JSON', '{"x":1} {}', 'invalid'],
    ['null', 'null', 'object_required'],
    ['array', '[]', 'object_required'],
    ['scalar', '"x"', 'object_required'],
    ['empty object', '{}', 'empty'],
  ] as const)('rejects %s', (_name, source, reason) => {
    expect(parseNonEmptyJSONObject(source)).toEqual({ ok: false, reason })
  })

  it('returns the exact parsed object shape', () => {
    expect(parseNonEmptyJSONObject('{"opaque":{"nested":[1,true]}}')).toEqual({
      ok: true,
      value: { opaque: { nested: [1, true] } },
    })
  })
})

describe('management JSON safety helpers', () => {
  it.each([
    'token',
    'accessToken',
    'client_secret',
    'PASSWORD',
    'payer_credential',
    'authorization',
  ])('redacts sensitive key %s', (key) => {
    expect(isSensitiveManagementKey(key)).toBe(true)
  })

  it('normalizes known specs fields without stringifying objects', () => {
    expect(
      summarizeManagementData(
        { model: 'Model 3', trim_badging: 'Performance', nested: { x: 1 } },
        'specs',
      ),
    ).toEqual([
      { label: 'model', value: 'Model 3' },
      { label: 'trim', value: 'Performance' },
    ])
  })
})

describe('vehicle management response normalization', () => {
  it('normalizes Tesla option codes without inventing missing values', () => {
    expect(
      parseVehicleOptions({
        codes: [
          {
            code: '$PMNG',
            colorCode: 'PMNG',
            displayName: 'Midnight Silver Metallic',
            isActive: true,
          },
        ],
      }),
    ).toEqual([
      {
        code: '$PMNG',
        colorCode: 'PMNG',
        displayName: 'Midnight Silver Metallic',
        isActive: true,
      },
    ])
  })

  it('normalizes grouped warranty coverage from Tesla camelCase fields', () => {
    expect(
      parseWarrantyDetails({
        activeWarranty: [
          {
            warrantyDisplayName: 'Drive Unit Limited Warranty',
            coverageAgeInYears: 8,
            expirationOdometer: 120000,
            warrantyExpiredOn: null,
          },
        ],
        expiredWarranty: [],
        upcomingWarranty: [],
      }),
    ).toEqual({
      active: [
        {
          state: 'active',
          displayName: 'Drive Unit Limited Warranty',
          code: null,
          coverageAgeYears: 8,
          coverageAgeMonths: null,
          expirationOdometer: 120000,
          expirationDate: null,
        },
      ],
      upcoming: [],
      expired: [],
    })
  })

  it('normalizes subscription offers and reported billing terms', () => {
    expect(
      parseSubscriptionEligibility({
        country: 'US',
        eligible: [
          {
            optionCode: '$ESASUB',
            product: 'EXTENDED_WARRANTY',
            billingOptions: [
              {
                price: 60,
                total: 60,
                currencyCode: 'USD',
                billingPeriod: 'MONTHLY',
              },
            ],
          },
        ],
      }),
    ).toEqual({
      country: 'US',
      offers: [
        {
          optionCode: '$ESASUB',
          product: 'EXTENDED_WARRANTY',
          billingOptions: [
            {
              price: 60,
              total: 60,
              currencyCode: 'USD',
              billingPeriod: 'MONTHLY',
            },
          ],
        },
      ],
    })
  })

  it('humanizes Tesla identifiers for display without changing source data', () => {
    expect(humanizeManagementLabel('EXTENDED_WARRANTY')).toBe(
      'Extended Warranty',
    )
    expect(humanizeManagementLabel('warrantyDisplayName')).toBe(
      'Warranty Display Name',
    )
  })

  it('normalizes scalar specifications and role objects', () => {
    expect(
      parseManagementScalarFields({
        model: 'Model Y',
        trim_badging: 'Performance',
        trimBadging: 'Performance',
        nested: { ignored: true },
      }),
    ).toEqual([
      { key: 'model', label: 'Model', value: 'Model Y' },
      {
        key: 'trim_badging',
        label: 'Trim Badging',
        value: 'Performance',
      },
    ])
    expect(
      parseEnterpriseRoles({
        roles: ['fleet_manager', { displayName: 'Billing Admin' }],
      }),
    ).toEqual(['fleet_manager', 'Billing Admin'])
  })
})
