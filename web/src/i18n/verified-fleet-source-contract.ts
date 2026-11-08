import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect } from 'vitest'
import patches from './__fixtures__/verified-fleet-source-patches.json'
import { restoreWidgetImplementationSource } from './verified-widget-implementation-contract'
import externalAuthPatches from './__fixtures__/verified-external-auth-source-patches.json'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function readFleetCurrentSource(file: string): string {
  const path = resolve(process.cwd(), '..', file)
  const externalAuthPatch = externalAuthPatches.find(entry => entry.file === file)
  if (externalAuthPatch?.after === null) {
    expect(existsSync(path), file + ': retired external-auth producer').toBe(false)
    if (externalAuthPatch.deletedSource === null) throw new Error('Missing retired external-auth producer: ' + file)
    expect(hash(externalAuthPatch.deletedSource), file + ': retired external-auth source').toBe(externalAuthPatch.before)
    return externalAuthPatch.deletedSource
  }
  const patch = patches.find(entry => entry.file === file)
  if (patch?.after === null) {
    expect(existsSync(path), file + ': removed producer').toBe(false)
    if (patch.deletedSource === null) throw new Error('Missing removed producer: ' + file)
    return patch.deletedSource
  }
  return readFileSync(path, 'utf8')
}

export function restoreVerifiedFleetSource(file: string, text: string): string {
  const externalAuthPatch = externalAuthPatches.find(entry => entry.file === file)
  if (externalAuthPatch && externalAuthPatch.after !== null) {
    expect(hash(text), file + ': current external-auth source').toBe(externalAuthPatch.after)
    const lines = text.split('\n')
    for (const hunk of [...externalAuthPatch.hunks].reverse()) {
      expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': external-auth patch').toEqual(hunk.new)
      lines.splice(hunk.start, hunk.new.length, ...hunk.old)
    }
    text = lines.join('\n')
    expect(hash(text), file + ': previous external-auth source').toBe(externalAuthPatch.before)
  } else if (externalAuthPatch) {
    expect(hash(text), file + ': retired external-auth source').toBe(externalAuthPatch.before)
  }
  text = restoreWidgetImplementationSource(file, text)
  const patch = patches.find(entry => entry.file === file)
  if (!patch) return text
  if (patch.after === null) {
    expect(hash(text), file + ': removed producer source').toBe(patch.before)
    return text
  }

  expect(hash(text), file + ': current Fleet source').toBe(patch.after)
  const lines = text.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': Fleet patch').toEqual(hunk.new)
    lines.splice(hunk.start, hunk.new.length, ...hunk.old)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': previous Fleet source').toBe(patch.before)
  return previous
}
