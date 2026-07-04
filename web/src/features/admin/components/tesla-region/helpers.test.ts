import { describe, it, expect } from 'vitest'
import { parseEndpoint, regionKeyFromHost, hasEndpoint } from './helpers'

describe('regionKeyFromHost', () => {
  it('sniffs the na/eu/cn zone from a Fleet API host', () => {
    expect(regionKeyFromHost('fleet-api.prd.na.vn.cloud.tesla.com')).toBe('na')
    expect(regionKeyFromHost('fleet-api.prd.eu.vn.cloud.tesla.com')).toBe('eu')
    expect(regionKeyFromHost('fleet-api.prd.cn.vn.cloud.tesla.cn')).toBe('cn')
  })

  it('returns null for unknown or missing hosts', () => {
    expect(regionKeyFromHost('example.com')).toBeNull()
    expect(regionKeyFromHost('')).toBeNull()
    expect(regionKeyFromHost(null)).toBeNull()
    expect(regionKeyFromHost(undefined)).toBeNull()
  })
})

describe('parseEndpoint', () => {
  it('splits a valid URL into host, scheme and zone', () => {
    expect(parseEndpoint('https://fleet-api.prd.na.vn.cloud.tesla.com')).toEqual({
      host: 'fleet-api.prd.na.vn.cloud.tesla.com',
      scheme: 'https',
      regionKey: 'na',
    })
  })

  it('is null-safe for empty input', () => {
    expect(parseEndpoint(null)).toEqual({ host: null, scheme: null, regionKey: null })
    expect(parseEndpoint('')).toEqual({ host: null, scheme: null, regionKey: null })
  })

  it('never throws on a malformed URL but still sniffs the zone', () => {
    expect(parseEndpoint('prd.eu.vn.cloud.tesla.com')).toEqual({
      host: null,
      scheme: null,
      regionKey: 'eu',
    })
  })
})

describe('hasEndpoint', () => {
  it('is true when a region or base URL is present', () => {
    expect(hasEndpoint({ region: 'North America' })).toBe(true)
    expect(hasEndpoint({ fleet_api_base_url: 'https://x' })).toBe(true)
  })

  it('is false for empty or missing data', () => {
    expect(hasEndpoint({})).toBe(false)
    expect(hasEndpoint(null)).toBe(false)
    expect(hasEndpoint(undefined)).toBe(false)
  })
})
