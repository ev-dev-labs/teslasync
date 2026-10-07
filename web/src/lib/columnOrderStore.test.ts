import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyColumnLayout,
  columnLayoutStorageKey,
  defaultColumnLayout,
  effectiveColumnOrder,
  getColumnLayout,
  legacyVisibleStorageKey,
  moveColumn,
  readLegacyVisibleLayout,
  resetColumnLayout,
  setColumnLayout,
  toggleHiddenColumn,
  type ColumnLayout,
} from './columnOrderStore'

interface Col {
  key: string
  defaultVisible?: boolean
}

const COLS: Col[] = [
  { key: 'id' },
  { key: 'name' },
  { key: 'status' },
  { key: 'detail', defaultVisible: false },
]

beforeEach(() => {
  window.localStorage.clear()
})

describe('columnOrderStore — storage round-trip', () => {
  it('returns null when no layout is stored', () => {
    expect(getColumnLayout('t-empty')).toBeNull()
  })

  it('persists and reads back a layout under the canonical key', () => {
    const layout: ColumnLayout = { order: ['name', 'id'], hidden: ['status'] }
    setColumnLayout('t-rt', layout)
    expect(window.localStorage.getItem(columnLayoutStorageKey('t-rt'))).toBeTruthy()
    expect(getColumnLayout('t-rt')).toEqual(layout)
  })

  it('reset removes both the canonical and the legacy keys', () => {
    setColumnLayout('t-rst', { order: ['a'], hidden: ['b'] })
    window.localStorage.setItem(legacyVisibleStorageKey('t-rst'), JSON.stringify(['a']))
    resetColumnLayout('t-rst')
    expect(window.localStorage.getItem(columnLayoutStorageKey('t-rst'))).toBeNull()
    expect(window.localStorage.getItem(legacyVisibleStorageKey('t-rst'))).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    window.localStorage.setItem(columnLayoutStorageKey('t-bad'), '{not json')
    expect(getColumnLayout('t-bad')).toBeNull()
  })

  it('coerces missing fields to empty arrays', () => {
    window.localStorage.setItem(columnLayoutStorageKey('t-partial'), JSON.stringify({ order: ['a'] }))
    expect(getColumnLayout('t-partial')).toEqual({ order: ['a'], hidden: [] })
  })

  it('drops non-string entries from order/hidden', () => {
    window.localStorage.setItem(
      columnLayoutStorageKey('t-mixed'),
      JSON.stringify({ order: ['a', 5, null], hidden: [true, 'b'] }),
    )
    expect(getColumnLayout('t-mixed')).toEqual({ order: [], hidden: [] })
  })
})

describe('columnOrderStore — applyColumnLayout', () => {
  it('returns default-visible columns in source order when layout is null', () => {
    const out = applyColumnLayout(COLS, null).map((c) => c.key)
    expect(out).toEqual(['id', 'name', 'status'])
  })

  it('drops hidden keys', () => {
    const layout: ColumnLayout = { order: [], hidden: ['name'] }
    const out = applyColumnLayout(COLS, layout).map((c) => c.key)
    expect(out).toEqual(['id', 'status', 'detail'])
  })

  it('reorders by stored order, then appends remaining keys in source order', () => {
    const layout: ColumnLayout = { order: ['status', 'id'], hidden: [] }
    const out = applyColumnLayout(COLS, layout).map((c) => c.key)
    expect(out).toEqual(['status', 'id', 'name', 'detail'])
  })

  it('ignores stored keys that are no longer present', () => {
    const layout: ColumnLayout = { order: ['gone', 'name'], hidden: ['ghost'] }
    const out = applyColumnLayout(COLS, layout).map((c) => c.key)
    expect(out).toEqual(['name', 'id', 'status', 'detail'])
  })

  it('falls back to defaults when the stored layout would render zero columns', () => {
    const layout: ColumnLayout = { order: [], hidden: ['id', 'name', 'status', 'detail'] }
    const out = applyColumnLayout(COLS, layout).map((c) => c.key)
    expect(out).toEqual(['id', 'name', 'status'])
  })
})

describe('columnOrderStore — effectiveColumnOrder', () => {
  it('returns source order when no layout', () => {
    expect(effectiveColumnOrder(COLS, null)).toEqual(['id', 'name', 'status', 'detail'])
  })

  it('honors stored order then appends new keys', () => {
    const layout: ColumnLayout = { order: ['status', 'id'], hidden: ['name'] }
    expect(effectiveColumnOrder(COLS, layout)).toEqual(['status', 'id', 'name', 'detail'])
  })
})

describe('columnOrderStore — moveColumn', () => {
  const order = ['a', 'b', 'c', 'd']

  it('moves a key forward', () => {
    expect(moveColumn(order, 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a key backward', () => {
    expect(moveColumn(order, 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('clamps toIndex past the end', () => {
    expect(moveColumn(order, 'a', 99)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('returns a copy when the key is unknown', () => {
    const out = moveColumn(order, 'zzz', 0)
    expect(out).toEqual(order)
    expect(out).not.toBe(order)
  })
})

describe('columnOrderStore — toggleHiddenColumn', () => {
  it('hides a previously visible key', () => {
    const next = toggleHiddenColumn({ order: ['a', 'b'], hidden: [] }, 'b')
    expect(next.hidden).toEqual(['b'])
    expect(next.order).toEqual(['a', 'b'])
  })

  it('unhides a previously hidden key', () => {
    const next = toggleHiddenColumn({ order: ['a', 'b'], hidden: ['b'] }, 'b')
    expect(next.hidden).toEqual([])
    expect(next.order).toEqual(['a', 'b'])
  })

  it('does not mutate the input', () => {
    const input: ColumnLayout = { order: ['a'], hidden: [] }
    toggleHiddenColumn(input, 'a')
    expect(input).toEqual({ order: ['a'], hidden: [] })
  })
})

describe('columnOrderStore — defaultColumnLayout', () => {
  it('orders by source and seeds hidden from defaultVisible:false', () => {
    expect(defaultColumnLayout(COLS)).toEqual({
      order: ['id', 'name', 'status', 'detail'],
      hidden: ['detail'],
    })
  })
})

describe('columnOrderStore — readLegacyVisibleLayout', () => {
  it('returns null when no legacy entry', () => {
    expect(readLegacyVisibleLayout('t-noleg', ['a', 'b'])).toBeNull()
  })

  it('migrates an array of visible keys into {order, hidden}', () => {
    window.localStorage.setItem(legacyVisibleStorageKey('t-mig'), JSON.stringify(['name', 'id']))
    const out = readLegacyVisibleLayout('t-mig', ['id', 'name', 'status'])
    expect(out).toEqual({ order: ['name', 'id'], hidden: ['status'] })
  })

  it('drops keys that are no longer in the column universe', () => {
    window.localStorage.setItem(
      legacyVisibleStorageKey('t-drop'),
      JSON.stringify(['name', 'gone']),
    )
    const out = readLegacyVisibleLayout('t-drop', ['id', 'name'])
    expect(out).toEqual({ order: ['name'], hidden: ['id'] })
  })

  it('returns null when no overlap with current columns', () => {
    window.localStorage.setItem(legacyVisibleStorageKey('t-none'), JSON.stringify(['gone']))
    expect(readLegacyVisibleLayout('t-none', ['id', 'name'])).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    window.localStorage.setItem(legacyVisibleStorageKey('t-bad'), 'not-json')
    expect(readLegacyVisibleLayout('t-bad', ['a'])).toBeNull()
  })
})
