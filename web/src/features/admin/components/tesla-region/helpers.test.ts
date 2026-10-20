import { describe, it, expect } from 'vitest'
import { parseEndpoint, regionKeyFromHost, hasEndpoint } from './helpers'

describe('regionKeyFromHost', () => {
  it('recognizes the three documented Fleet API host identities', () => {
    expect(regionKeyFromHost('fleet-api.prd.na.vn.cloud.tesla.com')).toBe('na')
    expect(regionKeyFromHost('fleet-api.prd.eu.vn.cloud.tesla.com')).toBe('eu')
    expect(regionKeyFromHost('fleet-api.prd.cn.vn.cloud.tesla.com')).toBe('cn')
    expect(regionKeyFromHost('FLEET-API.PRD.EU.VN.CLOUD.TESLA.COM')).toBe('eu')
  })

  it.each([
    'service.eu.example.invalid',
    'fleet-api.prd.na.vn.cloud.tesla.com.example.invalid',
    'other.fleet-api.prd.eu.vn.cloud.tesla.com',
    'fleet-api.prd.cn.vn.cloud.tesla.cn',
    'fleet-api.prd.zz.vn.cloud.tesla.com',
    'https://fleet-api.prd.eu.vn.cloud.tesla.com',
    'invalid .eu. string',
  ])('does not infer a zone from unsupported identity %s', (host) => {
    expect(regionKeyFromHost(host)).toBeNull()
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

  it('does not infer a datacenter from malformed URL text', () => {
    expect(parseEndpoint('prd.eu.vn.cloud.tesla.com')).toEqual({
      host: null,
      scheme: null,
      regionKey: null,
    })
  })

  it('preserves unknown parsed hosts and raw protocols without assigning a Tesla zone', () => {
    expect(parseEndpoint('http://service.eu.example.invalid:8080/path')).toEqual({
      host: 'service.eu.example.invalid:8080',
      scheme: 'http',
      regionKey: null,
    })
    expect(parseEndpoint('http://fleet-api.prd.eu.vn.cloud.tesla.com:8080/path')).toEqual({
      host: 'fleet-api.prd.eu.vn.cloud.tesla.com:8080',
      scheme: 'http',
      regionKey: 'eu',
    })
  })

  it('infers identity from the parsed hostname, never credentials or the path', () => {
    expect(parseEndpoint('https://fleet-api.prd.eu.vn.cloud.tesla.com@example.invalid/.na.').regionKey).toBeNull()
    expect(parseEndpoint('https://example.invalid/fleet-api.prd.eu.vn.cloud.tesla.com').regionKey).toBeNull()
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
