import { isStaticDemoBuild } from './demoMode'

export async function demoFetch(path: string, options: RequestInit): Promise<Response> {
  if (!isStaticDemoBuild()) throw new Error('Static demo fixtures are not enabled')
  if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const { demoResponse } = await import('@/demo/fixtureApi')
  if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  return demoResponse(path, options.method ?? 'GET')
}
