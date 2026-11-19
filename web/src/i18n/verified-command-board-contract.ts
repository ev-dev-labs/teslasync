import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import appDesign from './__fixtures__/app-design-preservation.json'
import patch from './__fixtures__/command-board-preservation.json'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function restoreCommandBoardSource(file: string, source: string): string {
  if (file !== patch.file) return source
  expect(hash(JSON.stringify(patch)), 'pinned command-board successor').toBe('dff5640617c68af9d2ac783d09408ce11892cceb09f2934784581f8151008ed2')
  expect(hash(source), file + ': actual command-board source').toBe(patch.after)
  const lines = source.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': command-board hunk').toEqual(hunk.new)
    lines.splice(hunk.start, hunk.new.length, ...hunk.old)
  }
  const previous = lines.join('\n')
  expect(patch.before, file + ': independently pinned application-design successor')
    .toBe(appDesign.sources.find(entry => entry.file === file)?.after)
  expect(hash(previous), file + ': complete command-board predecessor').toBe(patch.before)
  return previous
}

export function catalogBeforeCommandBoard<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog)
  const commands = previous.commands as Record<string, unknown>
  expect(commands.board, 'exact additive command-board copy').toEqual({
    title: 'Control board',
    description: 'Apply sends a draft. Requests do not confirm a change in vehicle state.',
    access: 'Access',
    climate: 'Climate',
    charging: 'Charging',
    openings: 'Windows & roof',
    navigation: 'Navigation & find my car',
    driving: 'Driving & guests',
    care: 'Cabin care',
    media: 'Media',
    chargeOptions: 'Charge preferences',
    schedules: 'Daily schedules',
    vehicle: 'Vehicle settings',
    security: 'Security settings',
    choose: 'Choose a value',
    apply: 'Apply',
    chargeLimitDraft: 'Charge limit draft',
    lockDoors: 'Lock doors',
    unlockDoors: 'Unlock doors',
    pin: 'Pin {{command}}',
    lastRequest: 'Last request: {{status}}',
    pinnedOnly: 'Pinned only',
    editPins: 'Edit pins',
    empty: 'Clear the filters to see all controls and edit pins.',
    clearFilters: 'Clear filters',
  })
  delete commands.board
  return previous
}
