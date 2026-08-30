import { describe, expect, it, vi } from 'vitest'
import { printStylesheetURL, printWhenReady } from './printDocument'

describe('print document helpers', () => {
  it('uses an absolute same-origin stylesheet URL for about:blank windows', () => {
    expect(printStylesheetURL()).toBe(`${window.location.origin}/print.css`)
  })

  it('prints immediately for popup implementations without load events', () => {
    const print = vi.fn()
    printWhenReady({ print } as unknown as Window)
    expect(print).toHaveBeenCalledOnce()
  })

  it('prints once after the popup load event', () => {
    const print = vi.fn()
    let onLoad: (() => void) | undefined
    const fakeWindow = {
      print,
      addEventListener: (_type: string, handler: () => void) => {
        onLoad = handler
      },
    }
    printWhenReady(fakeWindow as unknown as Window)
    onLoad?.()
    onLoad?.()
    expect(print).toHaveBeenCalledOnce()
  })
})
