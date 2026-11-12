import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import repair from './__fixtures__/native-source-repair-preservation.json';
import { producerProjection, projectionDigest } from './producer-projection';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = '30d116374897d497132be264332ca654638914e6efecaaf2d957aadb103252f8';
export const actualRepairSource = (file: string): string =>
  readFileSync(resolve(process.cwd(), '..', file), 'utf8');

/**
 * One explicit successor of e1fb, not a new historical baseline. The caller
 * supplies ACTUAL bytes. Old endpoints, partial edits and stale approvals fail.
 * No Git, map, cached source or fixture text is substituted for shipping input.
 */
export function restoreNativeSourceRepair(
  file: string,
  source: string,
  readDependency: (file: string) => string = actualRepairSource,
): string {
  expect(hash(JSON.stringify(repair)), 'pinned exact native source repair').toBe(fingerprint);
  const patch = repair.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': actual complete accepted successor').toBe(patch.after);
  const currentProjection = producerProjection(file, source);
  expect(currentProjection.calls, file + ': actual producer occurrences').toHaveLength(patch.currentCallCount);
  expect(projectionDigest(currentProjection), file + ': actual calls/defaults/options/origins/gates')
    .toBe(patch.currentProjectionSha256);
  // Includes the new private producer, the additive barrel and its actual
  // Tooltip implementation. These are never checked against restored bytes.
  for (const dependency of repair.dependencies) {
    expect(hash(readDependency(dependency.file)), dependency.file + ': actual native repair dependency')
      .toBe(dependency.sha256);
  }
  let previous = source;
  for (const hunk of [...patch.hunks].reverse()) {
    expect(previous.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact native repair hunk')
      .toBe(hunk.new);
    previous = previous.slice(0, hunk.start) + hunk.old + previous.slice(hunk.start + hunk.new.length);
  }
  expect(hash(previous), file + ': complete e1fb predecessor bytes').toBe(patch.before);
  if (patch.proof.sha256) {
    expect(patch.before, file + ': independently verified predecessor receipt').toBe(patch.proof.sha256);
  } else {
    expect(file).toBe('web/src/features/vehicles/components/FleetSourceStatus.tsx');
    expect(previous, 'new module has no historical producer').toBe('');
  }
  const projection = producerProjection(file, previous);
  expect(projection.calls, file + ': original producer occurrences').toHaveLength(patch.originalCallCount);
  expect(projectionDigest(projection), file + ': original calls/defaults/options/origins/gates')
    .toBe(patch.originalProjectionSha256);
  return previous;
}

/** Historical dependency guards still read, pin and invert the actual file. */
export function nativeRepairPredecessor(
  file: string,
  readDependency: (file: string) => string = actualRepairSource,
): string {
  return restoreNativeSourceRepair(file, readDependency(file), readDependency);
}
