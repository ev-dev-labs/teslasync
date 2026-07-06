/**
 * `<DataTableResizer>` — the column-resize splitter used by `<DataTable>`.
 *
 * The handle implements the WAI-ARIA "Window Splitter" pattern
 * (`role="separator"` + `aria-valuenow/min/max` + `tabIndex=0`) and supports
 * three input paths:
 *
 *   - Pointer drag  → continuous `onResize`, one `onResizeEnd` on release.
 *   - Keyboard      → Arrow/Home/End each emit `onResize` **and** `onResizeEnd`.
 *   - Click         → swallowed so it never triggers the header-cell sort.
 *
 * These tests exercise every path plus the two robustness contracts that make
 * the component production-grade:
 *
 *   1. `onResizeEnd` reports the width the user actually dragged to, not a
 *      possibly-stale controlled `width` prop.
 *   2. Pointer capture is best-effort — the gesture must survive an
 *      environment where `set`/`releasePointerCapture` is missing (jsdom) or
 *      throws (`NotFoundError` in real browsers).
 *
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven via `fireEvent` — matching every other component test here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, createEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'

// Deterministic i18n: return the supplied default string and interpolate
// `{{token}}` placeholders, mirroring the runtime `t(key, default, opts)`
// signature the component calls.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOpts?: string | Record<string, unknown>,
      maybeOpts?: Record<string, unknown>,
    ) => {
      let template: string
      let opts: Record<string, unknown> | undefined
      if (typeof defaultOrOpts === 'string') {
        template = defaultOrOpts || key
        opts = maybeOpts
      } else {
        template = key
        opts = defaultOrOpts
      }
      if (!opts) return template
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        opts?.[name] != null ? String(opts[name]) : `{{${name}}}`,
      )
    },
  }),
}))

import { DataTableResizer } from './DataTableResizer'

afterEach(() => cleanup())

function getHandle(): HTMLElement {
  return screen.getByRole('separator')
}

/** Controlled wrapper mirroring `<DataTable>`'s usage: `onResize` feeds width back. */
function Controlled({
  initial = 120,
  onResizeEnd,
}: {
  initial?: number
  onResizeEnd?: (final: number) => void
}) {
  const [w, setW] = useState(initial)
  return (
    <DataTableResizer
      columnKey="price"
      width={w}
      onResize={setW}
      onResizeEnd={onResizeEnd}
    />
  )
}

/** Temporarily install a pointer-capture method on the prototype, then restore. */
function withCaptureMethod(
  method: 'setPointerCapture' | 'releasePointerCapture',
  impl: (this: Element, pointerId: number) => void,
  run: () => void,
) {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const had = Object.prototype.hasOwnProperty.call(proto, method)
  const prev = proto[method]
  proto[method] = impl
  try {
    run()
  } finally {
    if (had) proto[method] = prev
    else delete proto[method]
  }
}

describe('DataTableResizer — accessibility & rendering', () => {
  it('renders a vertical separator that is focusable and exposes its value range', () => {
    render(<DataTableResizer columnKey="price" width={120} onResize={() => {}} />)
    const handle = getHandle()
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('tabindex', '0')
    expect(handle).toHaveAttribute('aria-valuenow', '120')
    // Defaults from the component: min 60, max 800.
    expect(handle).toHaveAttribute('aria-valuemin', '60')
    expect(handle).toHaveAttribute('aria-valuemax', '800')
  })

  it('builds a translated accessible name from the column key when no label is given', () => {
    render(<DataTableResizer columnKey="odometer" width={120} onResize={() => {}} />)
    expect(screen.getByRole('separator', { name: 'Resize column odometer' })).toBeInTheDocument()
  })

  it('prefers an explicit label override over the generated name', () => {
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        label="Adjust the price column width"
        onResize={() => {}}
      />,
    )
    const handle = getHandle()
    expect(handle).toHaveAttribute('aria-label', 'Adjust the price column width')
    expect(handle).not.toHaveAttribute('aria-label', 'Resize column price')
  })

  it('reflects custom min/max bounds in the aria-value attributes', () => {
    render(
      <DataTableResizer
        columnKey="price"
        width={150}
        minWidth={80}
        maxWidth={400}
        onResize={() => {}}
      />,
    )
    const handle = getHandle()
    expect(handle).toHaveAttribute('aria-valuemin', '80')
    expect(handle).toHaveAttribute('aria-valuemax', '400')
  })
})

describe('DataTableResizer — pointer drag', () => {
  it('emits the clamped width during the drag and the final width on release', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )
    const handle = getHandle()
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 })
    expect(onResize).toHaveBeenCalledWith(180)
    expect(onResizeEnd).not.toHaveBeenCalled()

    fireEvent.pointerUp(handle, { clientX: 160, pointerId: 1 })
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).toHaveBeenCalledWith(180)
  })

  it('clamps to maxWidth when the handle is dragged far to the right', () => {
    const onResize = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        maxWidth={200}
        onResize={onResize}
      />,
    )
    const handle = getHandle()
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 1 })
    expect(onResize).toHaveBeenCalledWith(200)
  })

  it('clamps to minWidth when the handle is dragged far to the left', () => {
    const onResize = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        minWidth={90}
        onResize={onResize}
      />,
    )
    const handle = getHandle()
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 })
    expect(onResize).toHaveBeenCalledWith(90)
  })

  it('reports the last dragged width to onResizeEnd even when the width prop never updates', () => {
    // Uncontrolled parent: `width` stays 120 for the whole gesture. The old
    // implementation echoed that stale prop; the hardened version tracks the
    // last emitted value and forwards it.
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )
    const handle = getHandle()
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 220, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 220, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith(240)
    expect(onResizeEnd).toHaveBeenCalledWith(240)
  })

  it('ignores pointer moves that arrive before a pointerdown', () => {
    const onResize = vi.fn()
    render(<DataTableResizer columnKey="price" width={120} onResize={onResize} />)
    fireEvent.pointerMove(getHandle(), { clientX: 300, pointerId: 1 })
    expect(onResize).not.toHaveBeenCalled()
  })

  it('ignores a pointerup when no drag is active', () => {
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        onResize={() => {}}
        onResizeEnd={onResizeEnd}
      />,
    )
    fireEvent.pointerUp(getHandle(), { clientX: 120, pointerId: 1 })
    expect(onResizeEnd).not.toHaveBeenCalled()
  })

  it('applies the active drag styling only while a drag is in progress', () => {
    render(<DataTableResizer columnKey="price" width={120} onResize={() => {}} />)
    const handle = getHandle()
    // classList.contains does exact-token matching, so it ignores the
    // always-present `focus-visible:bg-cyan-400/60` variant token.
    expect(handle.classList.contains('bg-cyan-400/60')).toBe(false)
    expect(handle.classList.contains('opacity-0')).toBe(true)

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    expect(handle.classList.contains('bg-cyan-400/60')).toBe(true)
    expect(handle.classList.contains('opacity-0')).toBe(false)

    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 })
    expect(handle.classList.contains('bg-cyan-400/60')).toBe(false)
  })

  it('updates aria-valuenow through a controlled parent and reports the final width', () => {
    const onResizeEnd = vi.fn()
    render(<Controlled initial={120} onResizeEnd={onResizeEnd} />)
    const handle = getHandle()
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 })
    expect(getHandle()).toHaveAttribute('aria-valuenow', '220')

    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 })
    expect(onResizeEnd).toHaveBeenCalledWith(220)
  })
})

describe('DataTableResizer — pointer capture resilience', () => {
  it('does not throw when the environment lacks pointer capture and still drags', () => {
    // jsdom does not implement set/releasePointerCapture — the guarded calls
    // must no-op instead of crashing the gesture.
    const onResize = vi.fn()
    render(<DataTableResizer columnKey="price" width={120} onResize={onResize} />)
    const handle = getHandle()
    expect(() => fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })).not.toThrow()
    fireEvent.pointerMove(handle, { clientX: 130, pointerId: 1 })
    expect(onResize).toHaveBeenCalledWith(150)
  })

  it('swallows setPointerCapture throwing and completes the drag anyway', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )
    const handle = getHandle()
    withCaptureMethod(
      'setPointerCapture',
      () => {
        throw new DOMException('no active pointer', 'NotFoundError')
      },
      () => {
        expect(() => fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })).not.toThrow()
        fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 })
        fireEvent.pointerUp(handle, { clientX: 150, pointerId: 1 })
      },
    )
    expect(onResize).toHaveBeenCalledWith(170)
    expect(onResizeEnd).toHaveBeenCalledWith(170)
  })

  it('swallows releasePointerCapture throwing on release and still fires onResizeEnd', () => {
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        onResize={() => {}}
        onResizeEnd={onResizeEnd}
      />,
    )
    const handle = getHandle()
    withCaptureMethod(
      'releasePointerCapture',
      () => {
        throw new DOMException('not captured', 'InvalidStateError')
      },
      () => {
        fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
        expect(() => fireEvent.pointerUp(handle, { clientX: 140, pointerId: 1 })).not.toThrow()
      },
    )
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })
})

describe('DataTableResizer — keyboard', () => {
  it('grows the width by 8px on ArrowRight and persists immediately', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )
    fireEvent.keyDown(getHandle(), { key: 'ArrowRight' })
    expect(onResize).toHaveBeenCalledWith(128)
    expect(onResizeEnd).toHaveBeenCalledWith(128)
  })

  it('shrinks the width by 8px on ArrowLeft', () => {
    const onResize = vi.fn()
    render(<DataTableResizer columnKey="price" width={120} onResize={onResize} />)
    fireEvent.keyDown(getHandle(), { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenCalledWith(112)
  })

  it('rounds fractional widths to whole pixels', () => {
    const onResize = vi.fn()
    render(<DataTableResizer columnKey="price" width={120.4} onResize={onResize} />)
    fireEvent.keyDown(getHandle(), { key: 'ArrowRight' })
    // 120.4 + 8 = 128.4 → rounded to 128.
    expect(onResize).toHaveBeenCalledWith(128)
  })

  it('resets toward 80px on Home', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={300}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )
    fireEvent.keyDown(getHandle(), { key: 'Home' })
    expect(onResize).toHaveBeenCalledWith(80)
    expect(onResizeEnd).toHaveBeenCalledWith(80)
  })

  it('jumps to maxWidth on End', () => {
    const onResize = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        maxWidth={250}
        onResize={onResize}
      />,
    )
    fireEvent.keyDown(getHandle(), { key: 'End' })
    expect(onResize).toHaveBeenCalledWith(250)
  })

  it('clamps a keyboard shrink to minWidth', () => {
    const onResize = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={64}
        minWidth={60}
        onResize={onResize}
      />,
    )
    // 64 - 8 = 56, clamped up to the 60px floor.
    fireEvent.keyDown(getHandle(), { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenCalledWith(60)
  })

  it('prevents the default action for handled keys', () => {
    render(<DataTableResizer columnKey="price" width={120} onResize={() => {}} />)
    const handle = getHandle()
    const event = createEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent(handle, event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores unrelated keys without resizing or preventing default', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <DataTableResizer
        columnKey="price"
        width={120}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )
    const handle = getHandle()
    const event = createEvent.keyDown(handle, { key: 'a' })
    fireEvent(handle, event)
    expect(onResize).not.toHaveBeenCalled()
    expect(onResizeEnd).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('DataTableResizer — optional onResizeEnd', () => {
  it('does not throw on pointer release when onResizeEnd is omitted', () => {
    render(<DataTableResizer columnKey="price" width={120} onResize={() => {}} />)
    const handle = getHandle()
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    expect(() => fireEvent.pointerUp(handle, { clientX: 140, pointerId: 1 })).not.toThrow()
  })

  it('still emits onResize on keyboard resize when onResizeEnd is omitted', () => {
    const onResize = vi.fn()
    render(<DataTableResizer columnKey="price" width={120} onResize={onResize} />)
    expect(() => fireEvent.keyDown(getHandle(), { key: 'ArrowRight' })).not.toThrow()
    expect(onResize).toHaveBeenCalledWith(128)
  })
})

describe('DataTableResizer — click isolation', () => {
  it('stops click propagation so the header-cell sort is not triggered', () => {
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <DataTableResizer columnKey="price" width={120} onResize={() => {}} />
      </div>,
    )
    fireEvent.click(getHandle())
    expect(parentClick).not.toHaveBeenCalled()
  })
})
