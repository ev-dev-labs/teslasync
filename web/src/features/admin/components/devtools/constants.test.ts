import { describe, it, expect } from 'vitest'
import { KeyRound, FileCode, Key, Globe, Shield, Link, Radio } from 'lucide-react'
import {
  ICON_COLOR_MAP,
  VIN_MANUFACTURERS,
  VIN_MODELS,
  VIN_DRIVE,
  VIN_YEAR,
  VIN_PLANT,
  BYTE_UNITS,
  PERMS,
  HTTP_CODES,
  TESLA_ENDPOINTS,
  TELEMETRY_FIELDS,
  ONBOARDING_STEPS,
  REFERENCE_LINKS,
} from './constants'

// ---------------------------------------------------------------------------
// devtools/constants — contract tests
//
// constants.ts is a data-only module: no components, hooks, or side effects.
// The value of a test here is to LOCK the exact invariants every consumer
// silently relies on, so a copy-paste edit to the reference tables can't
// regress the UI without a red test. Each block therefore mirrors how a real
// consumer reads the constant:
//   ICON_COLOR_MAP   → ToolCard / ClientUtilitiesSection (`map[color] ?? map.cyan`)
//   VIN_*            → tools/VinDecoder (positional slice decode)
//   BYTE_UNITS       → tools/ByteSizeConverter (indexOf + 1024^i)
//   PERMS            → tools/UnixPermissionTool (per-digit octal → rwx triad)
//   HTTP_CODES       → tools/HttpStatusTool (Badge variant by range, code as key)
//   TESLA_ENDPOINTS  → tools/TeslaApiRefTool (DataTable keyExtractor = path)
//   TELEMETRY_FIELDS → DevToolsOverview (Σ fields drives the KPI count)
//   ONBOARDING_STEPS → Fleet API onboarding checklist (icon components)
//   REFERENCE_LINKS  → ReferenceLinksSection (icon string → ICON_MAP, url = key)
// ---------------------------------------------------------------------------

/** Every value stored in a Record<string,string> must be a non-empty string. */
function assertNonEmptyStringValues(map: Record<string, string>): void {
  for (const [key, value] of Object.entries(map)) {
    expect(typeof value, `value for "${key}"`).toBe('string')
    expect(value.trim().length, `value for "${key}" is blank`).toBeGreaterThan(0)
  }
}

describe('ICON_COLOR_MAP', () => {
  // The exact colour keys the tool registry (useToolList) and MetricCard-style
  // chips assign. If a consumer ever passes a colour outside this set the chip
  // silently falls back to `cyan`, so this set is a hard contract.
  const TOOL_COLORS = ['cyan', 'green', 'purple', 'amber', 'red'] as const

  it('exposes exactly the five semantic chip colours', () => {
    expect(Object.keys(ICON_COLOR_MAP).sort()).toEqual([...TOOL_COLORS].sort())
  })

  it('always contains the `cyan` fallback consumers default to', () => {
    // ToolCard / ExpandableToolCard both do `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan`.
    expect(ICON_COLOR_MAP.cyan).toBeDefined()
    expect(typeof ICON_COLOR_MAP.cyan).toBe('string')
  })

  it('resolves every colour used by the tool registry (no silent fallback)', () => {
    for (const color of TOOL_COLORS) {
      expect(Object.prototype.hasOwnProperty.call(ICON_COLOR_MAP, color)).toBe(true)
    }
  })

  it('builds each class string from its own colour token (no copy-paste bleed)', () => {
    for (const [color, cls] of Object.entries(ICON_COLOR_MAP)) {
      expect(cls, `${color} backplate`).toContain(`bg-neon-${color}/`)
      expect(cls, `${color} icon tint`).toContain(`text-neon-${color}`)
      expect(cls, `${color} ring`).toContain(`ring-neon-${color}/`)
      // Guard against a green→cyan style mismatch: no OTHER colour token leaks in.
      for (const other of Object.keys(ICON_COLOR_MAP)) {
        if (other !== color) expect(cls).not.toContain(`neon-${other}`)
      }
    }
  })

  it('is neon-on-chip compliant — every neon text has a matching backplate', () => {
    // Neon text is only allowed on a chip that ALSO carries a bg-neon backplate.
    for (const cls of Object.values(ICON_COLOR_MAP)) {
      expect(cls).toMatch(/bg-neon-\w+\/\d+/)
      expect(cls).toMatch(/ring-1/)
    }
  })
})

describe('VIN decoder maps', () => {
  it('VIN_MANUFACTURERS covers the four Tesla WMIs and every value names Tesla', () => {
    expect(Object.keys(VIN_MANUFACTURERS).sort()).toEqual(['5YJ', '7SA', 'LRW', 'XP7'])
    for (const v of Object.values(VIN_MANUFACTURERS)) expect(v).toContain('Tesla')
  })

  it('VIN_MODELS maps each code to its "Model X" label', () => {
    expect(VIN_MODELS).toEqual({ S: 'Model S', '3': 'Model 3', X: 'Model X', Y: 'Model Y' })
  })

  it('VIN_DRIVE has non-empty labels and shares codes for the same drivetrain', () => {
    assertNonEmptyStringValues(VIN_DRIVE)
    expect(VIN_DRIVE['2']).toBe('Dual Motor AWD')
    // A and B are both dual-motor AWD variants — intentional many-to-one.
    expect(VIN_DRIVE.A).toBe(VIN_DRIVE.B)
  })

  it('VIN_YEAR encodes 2017→2026 in strictly ascending order without invalid VIN letters', () => {
    const years = Object.values(VIN_YEAR).map(Number)
    expect(years).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026])
    // I, O, Q, U, Z and 0 are never valid VIN year codes.
    for (const bad of ['I', 'O', 'Q', 'U', 'Z', '0']) {
      expect(Object.prototype.hasOwnProperty.call(VIN_YEAR, bad)).toBe(false)
    }
  })

  it('VIN_PLANT resolves the major Tesla factories', () => {
    expect(VIN_PLANT.F).toContain('Fremont')
    expect(VIN_PLANT.A).toContain('Austin')
    expect(VIN_PLANT.B).toContain('Berlin')
    expect(VIN_PLANT.C).toContain('Shanghai')
    assertNonEmptyStringValues(VIN_PLANT)
  })
})

describe('VIN positional decode (mirrors tools/VinDecoder)', () => {
  // Replicates VinDecoder's exact slice positions so the maps are validated in
  // the shape they are actually consumed, not just as isolated lookups.
  function decodeVin(vin: string) {
    const u = vin.toUpperCase()
    return {
      mfr: VIN_MANUFACTURERS[u.slice(0, 3)],
      model: VIN_MODELS[u[3] ?? ''],
      drive: VIN_DRIVE[u[7] ?? ''],
      year: VIN_YEAR[u[9] ?? ''],
      plant: VIN_PLANT[u[10] ?? ''],
    }
  }

  it('decodes a US Fremont Model 3 (5YJ…)', () => {
    expect(decodeVin('5YJ3E1EA1NF000001')).toEqual({
      mfr: 'Tesla (USA)',
      model: 'Model 3',
      drive: 'Dual Motor AWD',
      year: '2022',
      plant: 'Fremont, CA',
    })
  })

  it('decodes a Berlin Model Y (7SA…)', () => {
    expect(decodeVin('7SAYGDEF9PB123456')).toEqual({
      mfr: 'Tesla (EU/Berlin)',
      model: 'Model Y',
      drive: 'Performance AWD',
      year: '2023',
      plant: 'Berlin, Germany',
    })
  })

  it('yields undefined for unknown position codes (consumer falls back to "Unknown")', () => {
    expect(VIN_MODELS.Z).toBeUndefined()
    expect(VIN_MANUFACTURERS.ABC).toBeUndefined()
    expect(VIN_PLANT.Q).toBeUndefined()
  })
})

describe('BYTE_UNITS (mirrors tools/ByteSizeConverter)', () => {
  it('is an ascending, immutable 1024-scale ladder', () => {
    expect(BYTE_UNITS).toEqual(['B', 'KB', 'MB', 'GB', 'TB'])
    expect(BYTE_UNITS.length).toBe(5)
  })

  it('exposes stable indices used as the 1024^i exponent', () => {
    expect(BYTE_UNITS.indexOf('B')).toBe(0)
    expect(BYTE_UNITS.indexOf('MB')).toBe(2)
    expect(BYTE_UNITS.indexOf('TB')).toBe(4)
  })

  it('round-trips a conversion via 1024^index (1 MB === 1048576 B === 1024 KB)', () => {
    const bytes = 1 * Math.pow(1024, BYTE_UNITS.indexOf('MB'))
    expect(bytes).toBe(1_048_576)
    expect(bytes / Math.pow(1024, BYTE_UNITS.indexOf('KB'))).toBe(1024)
  })
})

describe('PERMS (mirrors tools/UnixPermissionTool)', () => {
  it('maps all eight octal digits to a 3-char rwx triad', () => {
    expect(Object.keys(PERMS).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
    for (const triad of Object.values(PERMS)) {
      expect(triad).toMatch(/^[r-][w-][x-]$/)
    }
  })

  it('encodes the read/write/execute bits correctly for every digit', () => {
    for (let d = 0; d <= 7; d++) {
      const expected = (d & 4 ? 'r' : '-') + (d & 2 ? 'w' : '-') + (d & 1 ? 'x' : '-')
      expect(PERMS[String(d)], `octal ${d}`).toBe(expected)
    }
  })

  it('composes the classic 755 mode into rwxr-xr-x', () => {
    const octal = '755'
    const symbolic = octal
      .split('')
      .map((d) => PERMS[d] ?? '---')
      .join('')
    expect(symbolic).toBe('rwxr-xr-x')
  })
})

describe('HTTP_CODES (mirrors tools/HttpStatusTool)', () => {
  it('lists only valid, unique HTTP status codes with copy', () => {
    expect(HTTP_CODES.length).toBeGreaterThan(0)
    const codes = HTTP_CODES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const row of HTTP_CODES) {
      expect(row.code).toBeGreaterThanOrEqual(100)
      expect(row.code).toBeLessThanOrEqual(599)
      expect(row.text.trim().length).toBeGreaterThan(0)
      expect(row.desc.trim().length).toBeGreaterThan(0)
    }
  })

  it('covers every status class the Badge variant switch handles (2xx–5xx)', () => {
    const classes = new Set(HTTP_CODES.map((c) => Math.floor(c.code / 100)))
    expect(classes.has(2)).toBe(true)
    expect(classes.has(3)).toBe(true)
    expect(classes.has(4)).toBe(true)
    expect(classes.has(5)).toBe(true)
  })

  it('drives the Badge variant boundaries used by the tool', () => {
    // variant = code<300 ? success : <400 ? info : <500 ? warning : danger
    const variant = (code: number) =>
      code < 300 ? 'success' : code < 400 ? 'info' : code < 500 ? 'warning' : 'danger'
    const byCode = (code: number) => HTTP_CODES.find((c) => c.code === code)
    expect(byCode(200)).toBeDefined()
    expect(variant(200)).toBe('success')
    expect(variant(301)).toBe('info')
    expect(variant(404)).toBe('warning')
    expect(variant(500)).toBe('danger')
  })
})

describe('TESLA_ENDPOINTS (mirrors tools/TeslaApiRefTool)', () => {
  it('every path is a unique /api/1 route — DataTable keyExtractor relies on it', () => {
    const paths = TESLA_ENDPOINTS.map((e) => e.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const e of TESLA_ENDPOINTS) {
      expect(e.path.startsWith('/api/1/')).toBe(true)
      expect(e.desc.trim().length).toBeGreaterThan(0)
    }
  })

  it('uses only GET/POST, and every command endpoint is a POST', () => {
    for (const e of TESLA_ENDPOINTS) {
      expect(['GET', 'POST']).toContain(e.method)
      if (e.path.includes('/command/')) {
        expect(e.method, `${e.path} should mutate via POST`).toBe('POST')
      }
    }
  })

  it('exposes the core fleet reads as GET', () => {
    const list = TESLA_ENDPOINTS.find((e) => e.path === '/api/1/vehicles')
    expect(list).toBeDefined()
    expect(list?.method).toBe('GET')
  })
})

describe('TELEMETRY_FIELDS (mirrors DevToolsOverview KPI)', () => {
  const allFields = TELEMETRY_FIELDS.flatMap((c) => c.fields)

  it('groups fields under uniquely-named, non-empty categories', () => {
    const names = TELEMETRY_FIELDS.map((c) => c.category)
    expect(new Set(names).size).toBe(names.length)
    for (const cat of TELEMETRY_FIELDS) {
      expect(cat.category.trim().length).toBeGreaterThan(0)
      expect(cat.fields.length).toBeGreaterThan(0)
    }
  })

  it('contains no duplicate signal names across the whole catalog', () => {
    // A duplicate would double-count DevToolsOverview's "Telemetry Signals" KPI.
    expect(new Set(allFields).size).toBe(allFields.length)
  })

  it('every signal name is a whitespace-free identifier', () => {
    for (const f of allFields) {
      expect(f.length).toBeGreaterThan(0)
      expect(f).not.toMatch(/\s/)
    }
  })

  it('KPI reduce (Σ category.fields) matches the flattened field total', () => {
    const kpi = TELEMETRY_FIELDS.reduce((sum, c) => sum + c.fields.length, 0)
    expect(kpi).toBe(allFields.length)
    expect(kpi).toBeGreaterThan(0)
  })
})

describe('ONBOARDING_STEPS', () => {
  it('lists the seven Fleet API setup steps in order with unique ids', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      'account',
      'application',
      'keypair',
      'register',
      'auth',
      'pair',
      'telemetry',
    ])
    expect(new Set(ONBOARDING_STEPS.map((s) => s.id)).size).toBe(ONBOARDING_STEPS.length)
  })

  it('binds each step to its renderable lucide icon', () => {
    const icons = ONBOARDING_STEPS.map((s) => s.icon)
    expect(icons).toEqual([KeyRound, FileCode, Key, Globe, Shield, Link, Radio])
    for (const step of ONBOARDING_STEPS) {
      expect(['object', 'function']).toContain(typeof step.icon)
    }
  })

  it('carries non-empty label + description copy for every step', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.label.trim().length).toBeGreaterThan(0)
      expect(step.desc.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('REFERENCE_LINKS (mirrors ReferenceLinksSection)', () => {
  // ReferenceLinksSection resolves `ICON_MAP[link.icon] ?? BookOpen`.
  const KNOWN_ICONS = ['BookOpen', 'Globe', 'ExternalLink', 'Radio']

  it('every url is a unique https link — url is the React key', () => {
    const urls = REFERENCE_LINKS.map((l) => l.url)
    expect(new Set(urls).size).toBe(urls.length)
    for (const l of REFERENCE_LINKS) {
      expect(l.url.startsWith('https://')).toBe(true)
    }
  })

  it('titles are namespaced i18n keys under devtools.ref.', () => {
    for (const l of REFERENCE_LINKS) {
      expect(l.title.startsWith('devtools.ref.')).toBe(true)
    }
  })

  it('every icon string resolves in the section ICON_MAP (no silent fallback)', () => {
    for (const l of REFERENCE_LINKS) {
      expect(KNOWN_ICONS).toContain(l.icon)
    }
  })
})
