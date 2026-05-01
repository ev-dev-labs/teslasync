import { describe, it, expect, beforeEach } from 'vitest'
import {
  setBaseTitle,
  setBasePrefix,
  setFlashPrefix,
  getBaseTitle,
  getBasePrefix,
  getFlashPrefix,
  __resetTitleStoreForTests,
} from '../titleStore'

describe('titleStore', () => {
  beforeEach(() => {
    __resetTitleStoreForTests()
  })

  it('starts with the default base title and no prefixes', () => {
    expect(getBaseTitle()).toBe('TeslaSync')
    expect(getBasePrefix()).toBe('')
    expect(getFlashPrefix()).toBe('')
    expect(document.title).toBe('TeslaSync')
  })

  it('writes the base title to document.title', () => {
    setBaseTitle('Dashboard — TeslaSync')
    expect(document.title).toBe('Dashboard — TeslaSync')
    expect(getBaseTitle()).toBe('Dashboard — TeslaSync')
  })

  it('prepends the base prefix to the title', () => {
    setBaseTitle('Dashboard — TeslaSync')
    setBasePrefix('(3) ')
    expect(document.title).toBe('(3) Dashboard — TeslaSync')
  })

  it('flash prefix overrides base prefix when both are set', () => {
    setBaseTitle('Dashboard — TeslaSync')
    setBasePrefix('(3) ')
    setFlashPrefix('(!) ALERT — ')
    expect(document.title).toBe('(!) ALERT — Dashboard — TeslaSync')
  })

  it('clearing the flash prefix restores the base prefix', () => {
    setBaseTitle('Dashboard — TeslaSync')
    setBasePrefix('(3) ')
    setFlashPrefix('(!) ALERT — ')
    setFlashPrefix('')
    expect(document.title).toBe('(3) Dashboard — TeslaSync')
  })

  it('clearing the base prefix removes the prefix entirely', () => {
    setBaseTitle('Dashboard — TeslaSync')
    setBasePrefix('(3) ')
    setBasePrefix('')
    expect(document.title).toBe('Dashboard — TeslaSync')
  })

  it('changing the base title preserves the active prefix', () => {
    setBasePrefix('(7) ')
    setBaseTitle('Drives — TeslaSync')
    expect(document.title).toBe('(7) Drives — TeslaSync')
    setBaseTitle('Charging — TeslaSync')
    expect(document.title).toBe('(7) Charging — TeslaSync')
  })

  it('handles empty flash prefix as not active (falls back to base prefix)', () => {
    setBaseTitle('App')
    setBasePrefix('(1) ')
    setFlashPrefix('')
    expect(document.title).toBe('(1) App')
  })

  it('reset helper restores defaults and clears document.title', () => {
    setBaseTitle('Foo')
    setBasePrefix('(9) ')
    setFlashPrefix('(!) ')
    __resetTitleStoreForTests()
    expect(getBaseTitle()).toBe('TeslaSync')
    expect(getBasePrefix()).toBe('')
    expect(getFlashPrefix()).toBe('')
    expect(document.title).toBe('TeslaSync')
  })
})
