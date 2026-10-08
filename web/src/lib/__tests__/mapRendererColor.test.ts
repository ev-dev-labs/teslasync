import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMapRendererColor } from '../colors'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

function mountedContext() {
  const context = document.createElement('div')
  document.body.appendChild(context)
  return context
}

describe('resolveMapRendererColor boundary (jsdom, not renderer proof)', () => {
  it('resolves an explicit concrete color and removes its transient probes', () => {
    const context = mountedContext()
    expect(resolveMapRendererColor('#83464e', context)).toBe('rgb(131, 70, 78)')
    expect(context.childNodes).toHaveLength(0)
  })

  it.each(['', ' ', 'not-a-color', 'red; background: blue', '<img src=x>', 'inherit', 'initial', 'unset', 'revert', 'currentColor'])('rejects %s without leaving markup', input => {
    const context = mountedContext()
    expect(resolveMapRendererColor(input, context)).toBeNull()
    expect(context.childNodes).toHaveLength(0)
  })

  it('does not invent paint for a detached context or SSR', () => {
    const context = document.createElement('div')
    expect(resolveMapRendererColor('red', context)).toBeNull()
    vi.stubGlobal('document', undefined)
    expect(resolveMapRendererColor('red', context)).toBeNull()
  })

  it('returns null when the owning document has no browsing context', () => {
    const doc = document.implementation.createHTMLDocument()
    expect(resolveMapRendererColor('red', doc.body)).toBeNull()
  })

  it('returns null when computed-style access is unavailable', () => {
    const context = mountedContext()
    vi.stubGlobal('getComputedStyle', undefined)
    expect(resolveMapRendererColor('red', context)).toBeNull()
  })

  it.each(['var(--missing)', 'var(--cycle-a)'])('never treats unresolved jsdom output %s as browser resolution', input => {
    const context = mountedContext()
    context.style.setProperty('--cycle-a', 'var(--cycle-b)')
    context.style.setProperty('--cycle-b', 'var(--cycle-a)')
    // jsdom is not a renderer: either unsupported assignment or unresolved
    // serialization must yield null, not a claim that theme CSS was resolved.
    expect(resolveMapRendererColor(input, context)).toBeNull()
  })

  it('accepts jsdom concrete light-dark serialization without claiming renderer proof', () => {
    expect(resolveMapRendererColor('light-dark(red, blue)', mountedContext())).toBe('rgb(255, 0, 0)')
  })

  it('cleans up when computed style throws after attachment', () => {
    const context = mountedContext()
    const original = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
      if (element !== context) throw new Error('style unavailable')
      return original(element)
    })
    expect(resolveMapRendererColor('red', context)).toBeNull()
    expect(context.childNodes).toHaveLength(0)
  })

  it('rejects inherited/default probe output (mocked boundary, not browser CSS)', () => {
    const context = mountedContext()
    const original = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
      if (element === context) return original(element)
      const inherited = element.parentElement
      if (!inherited) throw new Error('probe not attached')
      return original(inherited)
    })
    expect(resolveMapRendererColor('red', context)).toBeNull()
    expect(context.childNodes).toHaveLength(0)
  })

  it('never returns unresolved computed CSS (mocked boundary)', () => {
    const context = mountedContext()
    const declaration = document.createElement('span').style
    declaration.color = 'var(--missing)'
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(declaration)
    expect(resolveMapRendererColor('var(--missing)', context)).toBeNull()
  })
})
