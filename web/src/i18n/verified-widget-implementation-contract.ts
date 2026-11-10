import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import transition from './__fixtures__/widget-implementation-transition.json';
import packCopyChanges from './__fixtures__/widget-design-pack-copy.json';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// This additive transition preserves the older checkpoints, not visual approval.
expect(hash(JSON.stringify(transition)), 'pinned widget implementation transition')
  .toBe('ff96f3516b4f0b4ebdf4dc0f0ec3fab711a35e0394bb703b493b5ee18ecc97be');

export function restoreWidgetImplementationSource(file: string, source: string): string {
  const patch = transition.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': widget implementation source').toBe(patch.after);
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': widget implementation hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(hash(previous), file + ': preserved pre-widget source').toBe(patch.before);
  return previous;
}

export function catalogBeforeWidgetImplementation<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog);
  for (const change of packCopyChanges) {
    const parts = change.path.split('.');
    let parent: Record<string, unknown> = previous;
    for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
    const leaf = parts[parts.length - 1];
    expect(parent[leaf], change.path).toEqual(change.current);
    if ('previous' in change) parent[leaf] = change.previous;
    else delete parent[leaf];
  }
  for (const addition of transition.catalogAdditions) {
    let parent: Record<string, unknown> = previous;
    for (const part of addition.path.slice(0, -1)) {
      const child = parent[part];
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        throw new Error('Missing widget implementation copy: ' + addition.path.join('.'));
      }
      parent = child as Record<string, unknown>;
    }
    const leaf = addition.path[addition.path.length - 1];
    expect(parent[leaf], addition.path.join('.')).toBe(addition.value);
    delete parent[leaf];
  }
  return previous;
}
