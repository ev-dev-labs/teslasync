import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import patches from './__fixtures__/horizontal-navigation-preservation.json'
import orientation from './__fixtures__/nav-orientation-preservation.json'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')

// Verify the exact navigation delta before passing the reconstructed source to
// the older preservation checks. Never infer the delta from the current tree.
export function restoreHorizontalNavigationSource(file: string, source: string): string {
  source = restoreNavOrientationSource(file, source)
  return restoreExactPatch(file, source, patches, '8901f9db3b9784bded7a23cb7c38757e2524856c6d036116ca39c8fd74fc7be8')
}

export function restoreNavOrientationSource(file: string, source: string): string {
  return restoreExactPatch(file, source, orientation, 'daf65568925bca0a969b30284c28cbfe880ec1e171e176f8746b8a7522732845')
}

function restoreExactPatch(file: string, source: string, entries: typeof patches, fingerprint: string): string {
  const patch = entries.find(entry => entry.file === file)
  if (!patch) return source
  expect(hash(JSON.stringify(entries))).toBe(fingerprint)
  expect(hash(source), file + ': navigation successor').toBe(patch.after)
  const lines = source.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': navigation hunk')
      .toEqual(hunk.new)
    lines.splice(hunk.start, hunk.new.length, ...hunk.old)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': navigation predecessor').toBe(patch.before)
  return previous
}

export function catalogBeforeHorizontalNavigation<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog)
  const nav = previous.nav as Record<string, unknown>
  expect(nav.flyout, 'exact additive navigation copy').toEqual({
    browse: 'Browse sections',
    done: 'Done',
    editPins: 'Edit pins',
    groups: '{{section}} groups',
    other: 'Other pages',
    pages: 'Pages',
  })
  delete nav.flyout
  return previous
}
