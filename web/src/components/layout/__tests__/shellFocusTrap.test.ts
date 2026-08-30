/**
 * shellFocusTrap — pure DOM primitive tests (no React).
 *
 * Mirrors the guarantees `<Modal>` provides for ordinary dialogs, for the
 * shell overlays that cannot be a `<Modal>` (notably the command palette).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  SHELL_FOCUSABLE_SELECTOR,
  __getOverlayClaimCountForTests,
  activateShellOverlayGuard,
  getShellFocusableElements,
  hideBackgroundFrom,
  trapFocusWithin,
} from '../shellFocusTrap'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
  document.body.innerHTML = ''
})

function track(teardown: () => void) {
  cleanups.push(teardown)
  return teardown
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

function pressTab(shiftKey = false) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }),
  )
}

describe('getShellFocusableElements', () => {
  it('returns focusable descendants in DOM order', () => {
    mount(`
      <div id="panel">
        <button id="a">a</button>
        <input id="b" />
        <a id="c" href="#x">c</a>
      </div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    expect(getShellFocusableElements(panel).map((el) => el.id)).toEqual(['a', 'b', 'c'])
  })

  it('excludes disabled controls', () => {
    mount(`
      <div id="panel">
        <button id="a">a</button>
        <button id="b" disabled>b</button>
      </div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    expect(getShellFocusableElements(panel).map((el) => el.id)).toEqual(['a'])
  })

  it('excludes elements that opted out with tabindex="-1" (listbox options)', () => {
    mount(`
      <div id="panel">
        <input id="search" />
        <div id="listbox" tabindex="-1">
          <button id="opt0" role="option" tabindex="-1">0</button>
          <button id="opt1" role="option" tabindex="-1">1</button>
        </div>
        <button id="footer">footer</button>
      </div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    expect(getShellFocusableElements(panel).map((el) => el.id)).toEqual(['search', 'footer'])
  })

  it('excludes aria-hidden subtrees', () => {
    mount(`
      <div id="panel">
        <button id="a">a</button>
        <button id="b" aria-hidden="true">b</button>
      </div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    expect(getShellFocusableElements(panel).map((el) => el.id)).toEqual(['a'])
  })

  it('is null-safe', () => {
    expect(getShellFocusableElements(null)).toEqual([])
  })

  it('agrees with the Modal selector contract', () => {
    expect(SHELL_FOCUSABLE_SELECTOR).toContain('button:not(:disabled)')
    expect(SHELL_FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })
})

describe('trapFocusWithin', () => {
  function setup() {
    mount(`
      <button id="outside-before">before</button>
      <div id="panel">
        <button id="first">first</button>
        <input id="middle" />
        <button id="last">last</button>
      </div>
      <button id="outside-after">after</button>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    track(trapFocusWithin(panel))
    return panel
  }

  it('wraps Tab from the last focusable back to the first', () => {
    setup()
    ;(document.getElementById('last') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement?.id).toBe('first')
  })

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    setup()
    ;(document.getElementById('first') as HTMLElement).focus()
    pressTab(true)
    expect(document.activeElement?.id).toBe('last')
  })

  it('leaves interior Tab moves to the browser', () => {
    setup()
    ;(document.getElementById('first') as HTMLElement).focus()
    pressTab()
    // Not the last element → no preventDefault, focus untouched by the trap.
    expect(document.activeElement?.id).toBe('first')
  })

  it('pulls stray focus back inside on Tab', () => {
    setup()
    ;(document.getElementById('outside-before') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement?.id).toBe('first')
  })

  it('pulls stray focus back inside on Shift+Tab', () => {
    setup()
    ;(document.getElementById('outside-after') as HTMLElement).focus()
    pressTab(true)
    expect(document.activeElement?.id).toBe('last')
  })

  it('pins focus on the container when nothing inside is focusable', () => {
    mount(`
      <button id="outside">outside</button>
      <div id="panel" tabindex="-1"><span>text only</span></div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    track(trapFocusWithin(panel))
    ;(document.getElementById('outside') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement).toBe(panel)
  })

  it('stops trapping after teardown', () => {
    const panel = setup()
    expect(panel).toBeTruthy()
    while (cleanups.length > 0) cleanups.pop()?.()
    ;(document.getElementById('last') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement?.id).toBe('last')
  })

  it('is null-safe and returns a callable teardown', () => {
    expect(() => trapFocusWithin(null)()).not.toThrow()
  })

  it('never moves focus on activation (caller owns initial focus)', () => {
    mount(`
      <button id="outside">outside</button>
      <div id="panel"><button id="first">first</button></div>
    `)
    ;(document.getElementById('outside') as HTMLElement).focus()
    track(trapFocusWithin(document.getElementById('panel') as HTMLElement))
    expect(document.activeElement?.id).toBe('outside')
  })
})

describe('hideBackgroundFrom', () => {
  function setup() {
    mount(`
      <div id="app">
        <header id="chrome">chrome</header>
        <main id="content">content</main>
        <div id="overlay-parent">
          <div id="backdrop" data-role="command-palette"></div>
          <div id="positioner">
            <div id="panel">panel</div>
          </div>
        </div>
      </div>
      <div id="toast-root">toast</div>
    `)
    return document.getElementById('panel') as HTMLElement
  }

  it('inerts and aria-hides every ancestor sibling outside the overlay', () => {
    const panel = setup()
    track(hideBackgroundFrom(panel))
    for (const id of ['chrome', 'content', 'toast-root']) {
      const el = document.getElementById(id) as HTMLElement
      expect(el.hasAttribute('inert'), id).toBe(true)
      expect(el.getAttribute('aria-hidden'), id).toBe('true')
    }
  })

  it('never inerts the overlay chain itself', () => {
    const panel = setup()
    track(hideBackgroundFrom(panel))
    for (const id of ['app', 'overlay-parent', 'positioner', 'panel']) {
      expect(document.getElementById(id)?.hasAttribute('inert'), id).toBe(false)
    }
  })

  it('exempts the overlay‑owned backdrop so click-outside keeps working', () => {
    const panel = setup()
    track(
      hideBackgroundFrom(panel, {
        isOwnRoot: (el) => el.getAttribute('data-role') === 'command-palette',
      }),
    )
    const backdrop = document.getElementById('backdrop') as HTMLElement
    expect(backdrop.hasAttribute('inert')).toBe(false)
    expect(backdrop.getAttribute('aria-hidden')).toBeNull()
  })

  it('inerts the backdrop when no exemption is supplied (default behaviour)', () => {
    const panel = setup()
    track(hideBackgroundFrom(panel))
    expect(document.getElementById('backdrop')?.hasAttribute('inert')).toBe(true)
  })

  it('restores attributes exactly, including pre-existing ones', () => {
    const panel = setup()
    const chrome = document.getElementById('chrome') as HTMLElement
    const content = document.getElementById('content') as HTMLElement
    chrome.setAttribute('inert', '')
    content.setAttribute('aria-hidden', 'false')

    const restore = hideBackgroundFrom(panel)
    expect(chrome.hasAttribute('inert')).toBe(true)
    expect(content.getAttribute('aria-hidden')).toBe('true')

    restore()
    // Pre-existing inert survives; our aria-hidden is rolled back to its prior value.
    expect(chrome.hasAttribute('inert')).toBe(true)
    expect(chrome.getAttribute('aria-hidden')).toBeNull()
    expect(content.hasAttribute('inert')).toBe(false)
    expect(content.getAttribute('aria-hidden')).toBe('false')
  })

  it('is idempotent on repeated restore', () => {
    const panel = setup()
    const restore = hideBackgroundFrom(panel)
    restore()
    expect(() => restore()).not.toThrow()
    expect(document.getElementById('content')?.hasAttribute('inert')).toBe(false)
  })

  it('is null-safe', () => {
    expect(() => hideBackgroundFrom(null)()).not.toThrow()
  })
})

describe('activateShellOverlayGuard', () => {
  it('composes focus containment and background hiding behind one teardown', () => {
    mount(`
      <main id="content"><button id="outside">outside</button></main>
      <div id="overlay">
        <div id="panel">
          <button id="first">first</button>
          <button id="last">last</button>
        </div>
      </div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    const release = activateShellOverlayGuard({ focusContainer: panel })

    expect(document.getElementById('content')?.hasAttribute('inert')).toBe(true)
    ;(document.getElementById('last') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement?.id).toBe('first')

    release()
    expect(document.getElementById('content')?.hasAttribute('inert')).toBe(false)
    ;(document.getElementById('last') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement?.id).toBe('last')
  })

  it('never restores focus itself (caller owns focus return)', () => {
    mount(`
      <button id="trigger">trigger</button>
      <div id="panel"><button id="first">first</button></div>
    `)
    ;(document.getElementById('trigger') as HTMLElement).focus()
    const panel = document.getElementById('panel') as HTMLElement
    const release = activateShellOverlayGuard({ focusContainer: panel })
    ;(document.getElementById('first') as HTMLElement).focus()
    release()
    expect(document.activeElement?.id).toBe('first')
  })
})

// ─── Nested overlays: reference-counted background ownership ────────────────

describe('hideBackgroundFrom — nested overlays', () => {
  function scene() {
    mount(`
      <div id="app">
        <header id="chrome">chrome</header>
        <main id="content">content</main>
        <div id="outer-panel">outer</div>
        <div id="inner-panel">inner</div>
      </div>
    `)
    return {
      outer: document.getElementById('outer-panel') as HTMLElement,
      inner: document.getElementById('inner-panel') as HTMLElement,
      chrome: document.getElementById('chrome') as HTMLElement,
      content: document.getElementById('content') as HTMLElement,
    }
  }

  it('counts one claim per overlay for a shared background element', () => {
    const { outer, inner, content } = scene()
    const releaseOuter = hideBackgroundFrom(outer)
    expect(__getOverlayClaimCountForTests(content)).toBe(1)
    const releaseInner = hideBackgroundFrom(inner)
    expect(__getOverlayClaimCountForTests(content)).toBe(2)

    releaseOuter()
    releaseInner()
    expect(__getOverlayClaimCountForTests(content)).toBe(0)
  })

  it('keeps the background hidden when the OUTER overlay closes first', () => {
    const { outer, inner, content, chrome } = scene()
    const releaseOuter = hideBackgroundFrom(outer)
    const releaseInner = hideBackgroundFrom(inner)

    releaseOuter()
    // Inner is still modal — the background must stay hidden.
    expect(content.hasAttribute('inert')).toBe(true)
    expect(content.getAttribute('aria-hidden')).toBe('true')
    expect(chrome.hasAttribute('inert')).toBe(true)

    releaseInner()
    expect(content.hasAttribute('inert')).toBe(false)
    expect(content.getAttribute('aria-hidden')).toBeNull()
    expect(chrome.hasAttribute('inert')).toBe(false)
  })

  it('keeps the background hidden when the INNER overlay closes first', () => {
    const { outer, inner, content } = scene()
    const releaseOuter = hideBackgroundFrom(outer)
    const releaseInner = hideBackgroundFrom(inner)

    releaseInner()
    expect(content.hasAttribute('inert')).toBe(true)
    expect(content.getAttribute('aria-hidden')).toBe('true')

    releaseOuter()
    expect(content.hasAttribute('inert')).toBe(false)
    expect(content.getAttribute('aria-hidden')).toBeNull()
  })

  it('restores PRE-EXISTING attributes only after the final release', () => {
    const { outer, inner, content, chrome } = scene()
    chrome.setAttribute('inert', '')
    content.setAttribute('aria-hidden', 'false')

    const releaseOuter = hideBackgroundFrom(outer)
    const releaseInner = hideBackgroundFrom(inner)

    releaseInner()
    // Still owned by the outer overlay — nothing restored yet.
    expect(content.getAttribute('aria-hidden')).toBe('true')

    releaseOuter()
    // Original state, captured by the FIRST claimer, comes back verbatim.
    expect(chrome.hasAttribute('inert')).toBe(true)
    expect(chrome.getAttribute('aria-hidden')).toBeNull()
    expect(content.hasAttribute('inert')).toBe(false)
    expect(content.getAttribute('aria-hidden')).toBe('false')
  })

  it('a nested claimer never mistakes an outer overlay inert for pre-existing', () => {
    const { outer, inner, content } = scene()
    const releaseOuter = hideBackgroundFrom(outer)
    const releaseInner = hideBackgroundFrom(inner)
    releaseOuter()
    releaseInner()
    expect(content.hasAttribute('inert')).toBe(false)
  })

  it('a double release cannot decrement another overlay claim', () => {
    const { outer, inner, content } = scene()
    const releaseOuter = hideBackgroundFrom(outer)
    hideBackgroundFrom(inner)

    releaseOuter()
    releaseOuter()
    releaseOuter()
    expect(__getOverlayClaimCountForTests(content)).toBe(1)
    expect(content.hasAttribute('inert')).toBe(true)
  })

  it('keeps distinct overlay roots independent', () => {
    mount(`
      <div id="left-root">
        <div id="left-bg">left background</div>
        <div id="left-panel">left panel</div>
      </div>
      <div id="right-root">
        <div id="right-bg">right background</div>
        <div id="right-panel">right panel</div>
      </div>
    `)
    const leftBg = document.getElementById('left-bg') as HTMLElement
    const rightBg = document.getElementById('right-bg') as HTMLElement
    const leftRoot = document.getElementById('left-root') as HTMLElement
    const rightRoot = document.getElementById('right-root') as HTMLElement

    const releaseLeft = hideBackgroundFrom(
      document.getElementById('left-panel') as HTMLElement,
    )
    const releaseRight = hideBackgroundFrom(
      document.getElementById('right-panel') as HTMLElement,
    )

    // Each overlay hides its own sibling AND the other overlay's root.
    expect(leftBg.hasAttribute('inert')).toBe(true)
    expect(rightBg.hasAttribute('inert')).toBe(true)
    expect(__getOverlayClaimCountForTests(leftBg)).toBe(1)
    expect(__getOverlayClaimCountForTests(rightRoot)).toBe(1)

    releaseLeft()
    // The left overlay's own sibling is free again; the right overlay's is not.
    expect(leftBg.hasAttribute('inert')).toBe(false)
    expect(rightBg.hasAttribute('inert')).toBe(true)
    expect(leftRoot.hasAttribute('inert')).toBe(true)

    releaseRight()
    expect(rightBg.hasAttribute('inert')).toBe(false)
    expect(leftRoot.hasAttribute('inert')).toBe(false)
  })

  it('refuses to claim from a detached anchor', () => {
    mount(`<div id="app"><main id="content">content</main></div>`)
    const detached = document.createElement('div')
    expect(detached.isConnected).toBe(false)

    const release = hideBackgroundFrom(detached)
    expect(document.getElementById('content')?.hasAttribute('inert')).toBe(false)
    expect(() => release()).not.toThrow()
  })
})

// ─── Detached containers must never intercept ──────────────────────────────

describe('trapFocusWithin — detached containers', () => {
  it('does not arm for a container that is already detached', () => {
    mount(`<button id="outside">outside</button>`)
    const detached = document.createElement('div')
    detached.innerHTML = '<button id="inner">inner</button>'

    const release = trapFocusWithin(detached)
    ;(document.getElementById('outside') as HTMLElement).focus()
    pressTab()
    // Focus untouched — no listener was installed.
    expect(document.activeElement?.id).toBe('outside')
    expect(() => release()).not.toThrow()
  })

  it('self-disables when the container detaches before cleanup runs', () => {
    mount(`
      <button id="outside">outside</button>
      <div id="host"><div id="panel"><button id="first">first</button></div></div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    const release = trapFocusWithin(panel)

    // Trap is live while attached.
    ;(document.getElementById('outside') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement?.id).toBe('first')

    // Simulate an unmount that drops the subtree without calling cleanup.
    ;(document.getElementById('host') as HTMLElement).remove()
    ;(document.getElementById('outside') as HTMLElement).focus()
    pressTab()

    // No focus theft into the dead subtree.
    expect(document.activeElement?.id).toBe('outside')
    // Late cleanup is still safe.
    expect(() => release()).not.toThrow()
  })

  it('removes its listener on the first post-detach key event', () => {
    mount(`
      <button id="outside">outside</button>
      <div id="host"><div id="panel"><button id="first">first</button></div></div>
    `)
    const panel = document.getElementById('panel') as HTMLElement
    const remove = vi.spyOn(document, 'removeEventListener')
    track(trapFocusWithin(panel))
    ;(document.getElementById('host') as HTMLElement).remove()

    pressTab()
    expect(
      remove.mock.calls.some(([type]) => type === 'keydown'),
    ).toBe(true)
    remove.mockRestore()
  })

  it('teardown is idempotent', () => {
    mount(`<div id="panel"><button id="first">first</button></div>`)
    const release = trapFocusWithin(document.getElementById('panel') as HTMLElement)
    release()
    expect(() => release()).not.toThrow()
  })
})

describe('activateShellOverlayGuard — detached container', () => {
  it('is a predictable no-op and never hides the background', () => {
    mount(`<main id="content"><button id="outside">outside</button></main>`)
    const detached = document.createElement('div')
    detached.innerHTML = '<button id="inner">inner</button>'

    const release = activateShellOverlayGuard({ focusContainer: detached })
    expect(document.getElementById('content')?.hasAttribute('inert')).toBe(false)
    ;(document.getElementById('outside') as HTMLElement).focus()
    pressTab()
    expect(document.activeElement?.id).toBe('outside')
    expect(() => {
      release()
      release()
    }).not.toThrow()
  })
})
