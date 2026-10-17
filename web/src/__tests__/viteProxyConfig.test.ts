import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const config = readFileSync(join(webRoot, 'vite.config.ts'), 'utf8')
const apiPrefix = /proxy:\s*\{\s*['"]([^'"]+)['"]:\s*\{/.exec(config)?.[1]

describe('Vite API proxy route boundary', () => {
  it('restricts the API proxy to the API path, not similarly named SPA routes', () => {
    expect(apiPrefix).toBe('/api/')
  })

  it.each(['/api/v1/vehicles', '/api/v1/notifications/logs?read=false'])(
    'continues proxying backend request %s',
    path => expect(path.startsWith(apiPrefix ?? '__missing__')).toBe(true),
  )

  it.each(['/api-logs', '/api-logs?page=3', '/api-playground'])(
    'serves SPA route %s without requiring the backend',
    path => expect(path.startsWith(apiPrefix ?? '__missing__')).toBe(false),
  )
})
