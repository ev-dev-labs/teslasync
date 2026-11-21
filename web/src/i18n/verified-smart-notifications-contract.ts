import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import checkpoint from './__fixtures__/verified-smart-notifications.json'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
expect(hash(JSON.stringify(checkpoint)), 'pinned Smart Notifications delta')
  .toBe('015e1142f250c8d444121de4e3a099b1434cbd27dff29694fa886ef8521e7570')

export function restoreSmartNotificationsSource(file: string, source: string): string {
  const patch = checkpoint.sources.find(entry => entry.file === file)
  if (!patch) return source
  expect(hash(source), file + ': notification successor').toBe(patch.after)
  const lines = source.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.current.length), file + ': notification hunk').toEqual(hunk.current)
    lines.splice(hunk.start, hunk.current.length, ...hunk.previous)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': notification predecessor').toBe(patch.before)
  return previous
}

export function catalogBeforeSmartNotifications<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog)
  for (const addition of checkpoint.copy) {
    let node: Record<string, unknown> = previous
    for (const part of addition.path.slice(0, -1)) node = node[part] as Record<string, unknown>
    const leaf = addition.path[addition.path.length - 1]
    const value = JSON.stringify(node[leaf])
    expect(value === undefined ? undefined : hash(value), addition.path.join('.')).toBe(addition.sha256)
    delete node[leaf]
  }
  return previous
}
