import { get, type IncomingMessage } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { closeMockSseServer, ensureMockSseServer } from '../../e2e/mockSseServer'

afterEach(closeMockSseServer)

describe('native API fixture SSE lifecycle', () => {
  it('closes active streaming connections instead of leaving the probe alive', async () => {
    const server = await ensureMockSseServer()
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      get(`${server.origin}/api/v1/events`, resolve).once('error', reject)
    })
    const [chunk] = await once(response, 'data')
    expect(String(chunk)).toContain('retry:')
    expect(server.connectionCount()).toBe(1)
    const closed = once(response, 'close')
    await closeMockSseServer()
    await closed
    expect(response.destroyed).toBe(true)
  })

  it('allows fresh fixtures after explicit shutdown', async () => {
    const previous = await ensureMockSseServer()
    await closeMockSseServer()
    const current = await ensureMockSseServer()
    expect(current).not.toBe(previous)
    expect(current.connectionCount()).toBe(0)
  })
})
