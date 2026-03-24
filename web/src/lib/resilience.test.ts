import { describe, it, expect } from 'vitest'
import { ApiError } from './resilience'

describe('ApiError', () => {
  it('creates error with status', () => {
    const err = new ApiError('test error', 404)
    expect(err.status).toBe(404)
    expect(err.message).toBe('test error')
    expect(err.name).toBe('ApiError')
  })

  it('stores various status codes', () => {
    expect(new ApiError('', 500).status).toBe(500)
    expect(new ApiError('', 502).status).toBe(502)
    expect(new ApiError('', 400).status).toBe(400)
    expect(new ApiError('', 408).status).toBe(408)
  })

  it('extends Error', () => {
    const err = new ApiError('msg', 500)
    expect(err).toBeInstanceOf(Error)
  })
})
