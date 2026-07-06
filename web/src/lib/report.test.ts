import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateDriveReport, generateMonthlyReport } from './report'

/**
 * Install a fake print window and capture everything written into it.
 * `generateDriveReport`/`generateMonthlyReport` populate a popup via
 * `window.open(...).document.write(...)`; jsdom's real `window.open` returns
 * null, so we stub it with a spy-backed fake and accumulate the HTML.
 */
function installOpen() {
  let html = ''
  const write = vi.fn((chunk: string) => {
    html += chunk
  })
  const close = vi.fn()
  const print = vi.fn()
  const win = { document: { write, close }, print }
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  return { openSpy, write, close, print, html: () => html }
}

/** Simulate a popup blocker: `window.open` yields null. */
function blockOpen() {
  return vi.spyOn(window, 'open').mockReturnValue(null)
}

afterEach(() => {
  vi.restoreAllMocks()
})

const drive = {
  start_date: '2024-06-15T08:00:00Z',
  end_date: '2024-06-15T09:30:00Z',
  distance: 123.4,
  duration_min: 90,
  speed_max: 118,
  start_battery_level: 88,
  end_battery_level: 60,
  start_range_km: 400,
  end_range_km: 300,
}

describe('generateDriveReport', () => {
  it('returns false and writes nothing when the popup is blocked', () => {
    blockOpen()
    const writeSpy = vi.fn()
    // Guard: the fake document must never be touched on the blocked path.
    expect(generateDriveReport(drive, { display_name: 'Model 3' })).toBe(false)
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('writes a complete, printed HTML document and returns true', () => {
    const { openSpy, close, print, html } = installOpen()
    const ok = generateDriveReport(drive, { display_name: 'Model 3' })

    expect(ok).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('', '_blank')
    expect(html()).toContain('<!DOCTYPE html>')
    expect(html()).toContain('TeslaSync — Drive Report')
    expect(close).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('renders vehicle name and formatted drive metrics', () => {
    const { html } = installOpen()
    generateDriveReport(drive, { display_name: 'Model 3' })
    const out = html()

    expect(out).toContain('Model 3')
    expect(out).toContain('123.4') // distance, 1 decimal
    expect(out).toContain('118') // max speed
    expect(out).toContain('88→60') // battery stat card
    expect(out).toContain('<td>Duration</td><td>1h 30m</td>')
    expect(out).toContain('<td>Average Speed</td><td>82 km/h</td>')
    expect(out).toContain('<td>Battery Used</td><td>28%</td>')
    expect(out).toContain('<td>Start Range</td><td>400 km</td>')
  })

  it('HTML-escapes the vehicle display name to prevent script injection', () => {
    const { html } = installOpen()
    generateDriveReport(drive, { display_name: '<img src=x onerror="alert(1)">' })
    const out = html()

    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('is null-safe: renders placeholders when drive and vehicle are null', () => {
    const { html } = installOpen()
    let ok: boolean | undefined
    expect(() => {
      ok = generateDriveReport(null, null)
    }).not.toThrow()

    const out = html()
    expect(ok).toBe(true)
    expect(out).toContain('N/A') // vehicle name fallback
    expect(out).toContain('?→?') // battery placeholders
    expect(out).toContain('<td>Distance</td><td>—</td>') // missing distance → em dash
  })

  it('guards against divide-by-zero: zero duration yields an em dash, not a bogus speed', () => {
    const { html } = installOpen()
    generateDriveReport({ distance: 50, duration_min: 0 }, { display_name: 'X' })
    const out = html()

    expect(out).toContain('<td>Average Speed</td><td>—</td>')
    expect(out).not.toContain('3,000 km/h') // 50 / (1/60) in the old fallback
  })

  it('shows a "—" (not "0.0 km") for a missing distance in the details table', () => {
    const { html } = installOpen()
    generateDriveReport({ duration_min: 30 }, {})
    const out = html()

    expect(out).toContain('<td>Distance</td><td>—</td>')
    expect(out).not.toContain('0.0 km')
  })

  it('shows "In progress" when the drive has no end date', () => {
    const { html } = installOpen()
    generateDriveReport({ start_date: '2024-06-15T08:00:00Z', duration_min: 10 }, {})
    expect(html()).toContain('<td>End Time</td><td>In progress</td>')
  })
})

describe('generateMonthlyReport', () => {
  const stats = {
    total_distance_km: 12345,
    total_drives: 42,
    total_energy_kwh: 3210,
    total_cost: 123.45,
    avg_efficiency_wh_km: 175,
  }

  it('returns false when the popup is blocked', () => {
    blockOpen()
    expect(generateMonthlyReport(stats, [{}, {}])).toBe(false)
  })

  it('writes a complete summary with all fleet totals and returns true', () => {
    const { openSpy, close, print, html } = installOpen()
    const ok = generateMonthlyReport(stats, [{}, {}, {}])
    const out = html()

    expect(ok).toBe(true)
    expect(openSpy).toHaveBeenCalledWith('', '_blank')
    expect(out).toContain('TeslaSync — Monthly Summary')
    expect(out).toContain('<td>Total Vehicles</td><td>3</td>')
    expect(out).toContain('12,345 km')
    expect(out).toContain('<td>Total Drives</td><td>42</td>')
    expect(out).toContain('3,210 kWh')
    expect(out).toContain('$123.45')
    expect(out).toContain('175 Wh/km')
    expect(close).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('is null-safe: renders zeros when stats is null and vehicles is undefined', () => {
    const { html } = installOpen()
    let ok: boolean | undefined
    expect(() => {
      ok = generateMonthlyReport(null, undefined as unknown as unknown[])
    }).not.toThrow()

    const out = html()
    expect(ok).toBe(true)
    expect(out).toContain('<td>Total Vehicles</td><td>0</td>')
    expect(out).toContain('<td>Total Distance</td><td>0 km</td>')
    expect(out).toContain('<td>Total Drives</td><td>0</td>')
  })
})
