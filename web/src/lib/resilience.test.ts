import { describe, it, expect } from 'vitest'
import { ApiError } from './resilience'

describe('ApiError', () => {
  it('creates error with status', () => {
    const err = new ApiError('test error', 404)
    expect(err.status).toBe(404)
    expect(err.message).toBe('test error')
    expect(err.name).toBe('ApiError')
  })

  it('marks 5xx as retryable', () => {
    expect(new ApiError('', 500).retryable).toBe(true)
    expect(new ApiError('', 502).retryable).toBe(true)
    expect(new ApiError('', 503).retryable).toBe(true)
  })

  it('marks 408 and 429 as retryable', () => {
    expect(new ApiError('', 408).retryable).toBe(true)
    expect(new ApiError('', 429).retryable).toBe(true)
  })

  it('marks 4xx (except 408,429) as non-retryable', () => {
    expect(new ApiError('', 400).retryable).toBe(false)
    expect(new ApiError('', 401).retryable).toBe(false)
    expect(new ApiError('', 403).retryable).toBe(false)
    expect(new ApiError('', 404).retryable).toBe(false)
  })

  it('extends Error', () => {
    const err = new ApiError('msg', 500)
    expect(err).toBeInstanceOf(Error)
  })
})
