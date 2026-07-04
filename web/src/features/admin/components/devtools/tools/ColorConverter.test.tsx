/**
 * ColorConverterTool contract tests.
 *
 * ColorConverterTool is the single export of this module — a client-side hex →
 * RGB/HSL converter. There is no network, so every branch is driven purely by
 * the `hex` input value. These tests exercise the full surface plus the
 * hardening edges:
 *
 *   - default render: RGB / HSL / HEX cells + three copy affordances + swatch.
 *   - live recompute when a new valid hex is typed.
 *   - case-insensitivity (uppercase hex parses identically).
 *   - whitespace tolerance (a pasted "  #3b82f6  " still resolves).
 *   - REGRESSION: a hex with a trailing non-hex nibble ("#12345g") must be
 *     rejected, not silently mis-parsed by parseInt's lenient scan.
 *   - empty / too-short input surfaces the guidance status, never a blank panel.
 *   - clipboard: clicking a cell's Copy button writes that exact value.
 *   - a11y: labelled input + role="img" swatch carrying the current hex.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        const interpolate = (str: string) => {
          if (!opts) return str
          return Object.entries(opts).reduce<string>((acc, [k, v]) => {
            if (k === 'defaultValue') return acc
            return acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
          }, str)
        }
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ColorConverterTool } from './ColorConverter'

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

function setHex(value: string) {
  fireEvent.change(screen.getByLabelText('Hex Color'), { target: { value } })
}

describe('ColorConverterTool', () => {
  it('renders RGB, HSL and HEX conversions for the default seed color', () => {
    render(<ColorConverterTool />)

    // #3b82f6 == rgb(59,130,246) == hsl(217,91%,60%) (Tailwind blue-500).
    expect(screen.getByText('rgb(59, 130, 246)')).toBeInTheDocument()
    expect(screen.getByText('hsl(217, 91%, 60%)')).toBeInTheDocument()
    expect(screen.getByText('#3b82f6')).toBeInTheDocument()

    // One copy affordance per conversion cell.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3)
    // No guidance status while the value is valid.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('exposes an accessible, labelled input and a role="img" swatch tracking the hex', () => {
    render(<ColorConverterTool />)

    expect(screen.getByLabelText('Hex Color')).toHaveValue('#3b82f6')

    const swatch = screen.getByRole('img')
    expect(swatch).toHaveAttribute('aria-label', 'Color preview: #3b82f6')
    expect(swatch.getAttribute('style')).toMatch(/background-color/i)
  })

  it('recomputes conversions live when a new valid hex is entered', () => {
    render(<ColorConverterTool />)

    setHex('#ff0000')

    expect(screen.getByText('rgb(255, 0, 0)')).toBeInTheDocument()
    expect(screen.getByText('hsl(0, 100%, 50%)')).toBeInTheDocument()
    // Stale conversion is gone.
    expect(screen.queryByText('rgb(59, 130, 246)')).not.toBeInTheDocument()
    // Swatch follows the new value.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Color preview: #ff0000')
  })

  it('parses uppercase hex identically (case-insensitive)', () => {
    render(<ColorConverterTool />)

    setHex('#3B82F6')

    expect(screen.getByText('rgb(59, 130, 246)')).toBeInTheDocument()
    expect(screen.getByText('hsl(217, 91%, 60%)')).toBeInTheDocument()
  })

  it('tolerates surrounding whitespace on a pasted value', () => {
    render(<ColorConverterTool />)

    setHex('  #3b82f6  ')

    expect(screen.getByText('rgb(59, 130, 246)')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('rejects a hex whose trailing nibble is non-hex instead of mis-parsing it (regression)', () => {
    render(<ColorConverterTool />)

    // parseInt('5g', 16) === 5, so the pre-fix code silently rendered
    // rgb(18, 52, 5). Strict validation must reject the whole value.
    setHex('#12345g')

    expect(screen.getByRole('status')).toHaveTextContent(/valid 6-digit hex/i)
    expect(screen.queryByText('rgb(18, 52, 5)')).not.toBeInTheDocument()
    expect(screen.queryByText(/^rgb\(/)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'Copy' })).toHaveLength(0)
  })

  it('shows guidance (never a blank panel) for empty and too-short input', () => {
    render(<ColorConverterTool />)

    setHex('#abc')
    expect(screen.getByRole('status')).toHaveTextContent(/valid 6-digit hex/i)
    expect(screen.queryAllByRole('button', { name: 'Copy' })).toHaveLength(0)

    setHex('')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('copies the exact RGB value to the clipboard from the RGB cell', async () => {
    render(<ColorConverterTool />)

    const rgbCell = screen.getByText('RGB').closest('div') as HTMLElement
    fireEvent.click(within(rgbCell).getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('rgb(59, 130, 246)')
    })
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('copies the exact HSL value from the HSL cell', async () => {
    render(<ColorConverterTool />)

    const hslCell = screen.getByText('HSL').closest('div') as HTMLElement
    fireEvent.click(within(hslCell).getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hsl(217, 91%, 60%)')
    })
  })
})
