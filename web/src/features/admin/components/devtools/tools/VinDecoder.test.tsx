/**
 * VinDecoderTool contract tests.
 *
 * Covers the tool's single export end-to-end with behavioural, multi-facet
 * assertions (never a smoke render):
 *
 *   - structure/a11y: the ToolCard heading, a *label-associated* VIN field
 *     (getByLabelText, not a loose placeholder), and no results panel before
 *     anything is typed;
 *   - the happy path: a real 17-char Tesla VIN decodes into all six labelled
 *     fields with their exact values, inside a named <dl> results region — and
 *     the labels are human-readable ("Manufacturer" …), NOT the raw i18n keys
 *     that the un-fallbacked `t('devtools.utils.vin_*')` used to leak;
 *   - the unknown branch: unmapped WMI/model/drive/year/plant segments all fall
 *     back to the translated "Unknown", exercising every `?? unknown`;
 *   - the whitespace-normalisation fix: a VIN pasted with leading, trailing AND
 *     interior spaces still decodes at the correct character positions (a bare
 *     `.trim()` would not fix interior spaces — the source strips all `\s`);
 *   - the whitespace-only guard: an all-spaces value decodes nothing and shows
 *     no "keep typing" hint (it is not partial input, it is empty);
 *   - case-insensitivity: a lowercase VIN decodes identically (toUpperCase);
 *   - the empty-serial guard: an 11-char VIN (no serial characters) renders an
 *     em dash instead of a blank cell (never a blank panel);
 *   - the hint branch both ways: a too-short-but-non-empty entry surfaces the
 *     translated, aria-described hint, which disappears once the VIN decodes.
 *
 * `react-i18next` is mocked so `t(key, fallback)` returns the fallback and
 * `t(key)` returns the key verbatim — deterministic, translation-file-free and
 * matching the sibling HashCalculator/TeslaApiRefTool convention. The component
 * is pure client compute: nothing touches the network.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { VinDecoderTool } from './VinDecoder'

// A real 17-char Tesla VIN and the exact decode the shared constants produce.
const FULL_VIN = '5YJ3E1EA1NF000001'
const HINT = 'Enter at least 11 characters to decode a VIN'
const VIN_LABEL = 'Vin'

function getVinInput(): HTMLInputElement {
  return screen.getByLabelText(VIN_LABEL) as HTMLInputElement
}
function typeVin(value: string) {
  fireEvent.change(getVinInput(), { target: { value } })
}
/** The results <dl>; null until a VIN is decoded. */
function resultsList(): HTMLElement | null {
  return document.querySelector('dl')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VinDecoderTool', () => {
  it('renders the card, a label-associated VIN input, and no results before input', () => {
    render(<VinDecoderTool />)

    expect(
      screen.getByRole('heading', { name: 'Vin Decoder' }),
    ).toBeInTheDocument()

    const input = getVinInput()
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAttribute('placeholder', FULL_VIN)
    expect(input).toHaveValue('')

    // Nothing to decode yet → no results region and no guidance hint.
    expect(resultsList()).toBeNull()
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('decodes a full VIN into all six human-readable, correctly-valued fields', () => {
    render(<VinDecoderTool />)
    typeVin(FULL_VIN)

    // The results live in a named <dl> region (a11y).
    const dl = resultsList()
    expect(dl).not.toBeNull()
    expect(dl).toHaveAttribute('aria-label', 'Decoded VIN')

    // Labels are readable defaults, not the raw `devtools.utils.vin_*` keys.
    const label = screen.getByText('Manufacturer')
    expect(label.tagName).toBe('DT')
    expect(screen.queryByText('devtools.utils.vin_mfr')).toBeNull()

    // Every mapped position resolves to its exact constant value.
    const pairs: Array<[string, string]> = [
      ['Manufacturer', 'Tesla (USA)'],
      ['Model', 'Model 3'],
      ['Drive', 'Dual Motor AWD'],
      ['Year', '2022'],
      ['Plant', 'Fremont, CA'],
      ['Serial', '000001'],
    ]
    for (const [term, value] of pairs) {
      const dt = within(dl as HTMLElement).getByText(term)
      const dd = dt.nextElementSibling as HTMLElement
      expect(dd.tagName).toBe('DD')
      expect(dd).toHaveTextContent(value)
    }
  })

  it('falls back to the translated "Unknown" for every unmapped segment', () => {
    render(<VinDecoderTool />)
    typeVin('00000000000000000') // 17 zeros — nothing maps except the raw serial

    // mfr, model, drive, year and plant all fall through `?? unknown`.
    expect(screen.getAllByText('Unknown')).toHaveLength(5)
    // The serial is still the literal characters, not "Unknown".
    const serialDt = screen.getByText('Serial')
    expect(serialDt.nextElementSibling).toHaveTextContent('000000')
  })

  it('normalises leading, trailing and interior whitespace before decoding', () => {
    render(<VinDecoderTool />)
    // Interior spaces prove an all-\s strip, not a mere trim().
    typeVin('  5YJ3 E1EA 1NF0 00001  ')

    expect(screen.getByText('Tesla (USA)')).toBeInTheDocument()
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    const serialDt = screen.getByText('Serial')
    expect(serialDt.nextElementSibling).toHaveTextContent('000001')
  })

  it('treats a whitespace-only value as empty — no results and no hint', () => {
    render(<VinDecoderTool />)
    typeVin('          ') // ten spaces

    expect(resultsList()).toBeNull()
    expect(screen.queryByText(HINT)).toBeNull()
    expect(screen.queryByText('Manufacturer')).toBeNull()
  })

  it('decodes case-insensitively', () => {
    render(<VinDecoderTool />)
    typeVin(FULL_VIN.toLowerCase())

    expect(screen.getByText('Tesla (USA)')).toBeInTheDocument()
    expect(screen.getByText('Model 3')).toBeInTheDocument()
  })

  it('renders an em dash instead of a blank cell when the serial is empty', () => {
    render(<VinDecoderTool />)
    typeVin('5YJ3E1EA1NF') // exactly 11 chars → no serial characters remain

    // The mapped fields still decode…
    expect(screen.getByText('Fremont, CA')).toBeInTheDocument()
    // …and the serial cell is a placeholder, never blank.
    const serialDt = screen.getByText('Serial')
    expect(serialDt.nextElementSibling).toHaveTextContent('—')
  })

  it('shows an aria-described hint while too short, then hides it once decoded', () => {
    render(<VinDecoderTool />)

    typeVin('5YJ') // non-empty but shorter than 11 chars
    const hint = screen.getByText(HINT)
    expect(hint).toBeInTheDocument()
    expect(resultsList()).toBeNull()
    // The hint is programmatically associated with the input for screen readers.
    expect(getVinInput()).toHaveAttribute('aria-describedby', hint.id)

    typeVin(FULL_VIN) // now decodable → the hint gives way to results
    expect(screen.queryByText(HINT)).toBeNull()
    expect(resultsList()).not.toBeNull()
  })
})
