import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildAppIconSvg,
  renderSvgToPngDataUrl,
  svgToDataUrl,
  type AppIconMode,
  type BuildIconOptions,
} from '../appIcon'

const BOLT = 'M112 30L62 108h34L78 170l58-82h-34z'
const VIEWBOX = 'viewBox="0 0 200 200"'
const decode = (url: string) =>
  atob(url.replace('data:image/svg+xml;base64,', ''))

describe('buildAppIconSvg — shared artwork across every mode', () => {
  const modes: AppIconMode[] = ['standard', 'maskable', 'apple']

  it('emits well-formed SVG with the brand viewBox + bolt in all modes', () => {
    for (const mode of modes) {
      const svg = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode })
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(svg).toContain(VIEWBOX)
      expect(svg).toContain(`<path d="${BOLT}" fill="#ffffff"/>`)
      expect(svg).toContain('<linearGradient')
    }
  })

  it('defaults to the standard mode when mode is omitted', () => {
    const explicit = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode: 'standard' })
    const implicit = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981' })
    expect(implicit).toBe(explicit)
  })

  it('is a pure function — identical inputs give byte-identical output', () => {
    const opts: BuildIconOptions = { primary: '#123abc', accent: '#654321', mode: 'maskable' }
    expect(buildAppIconSvg(opts)).toBe(buildAppIconSvg(opts))
  })

  it('produces distinct markup per mode (silhouette differs)', () => {
    const std = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode: 'standard' })
    const msk = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode: 'maskable' })
    const apl = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode: 'apple' })
    expect(std).not.toBe(msk)
    expect(std).not.toBe(apl)
    expect(msk).not.toBe(apl)
  })
})

describe('buildAppIconSvg — per-mode geometry', () => {
  it('standard: rounded rect (rx=44), no safe-zone transform group', () => {
    const svg = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode: 'standard' })
    expect(svg).toContain('<rect width="200" height="200" rx="44" fill="url(#g)"/>')
    expect(svg).not.toContain('<g transform')
  })

  it('apple: full-bleed rect with NO rounding (iOS applies its own mask)', () => {
    const svg = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode: 'apple' })
    expect(svg).toContain('<rect width="200" height="200" fill="url(#g)"/>')
    expect(svg).not.toContain('rx="44"')
    expect(svg).not.toContain('<g transform')
  })

  it('maskable: bolt shifted into the inner 80% safe-zone, no rounding', () => {
    const svg = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981', mode: 'maskable' })
    expect(svg).toContain('<g transform="translate(20 20) scale(0.8)">')
    expect(svg).not.toContain('rx="44"')
  })
})

describe('buildAppIconSvg — safeHex colour guarding', () => {
  it('passes through every valid CSS hex notation (3/4/6/8 digits, either case)', () => {
    const cases = ['#abc', '#ABCD', '#00f0ff', '#00F0FF80']
    for (const c of cases) {
      const svg = buildAppIconSvg({ primary: c, accent: c })
      expect(svg).toContain(`stop-color="${c}"`)
    }
  })

  it('falls back to brand defaults for malformed / non-hex values', () => {
    const svg = buildAppIconSvg({ primary: 'rgb(1,2,3)', accent: 'not-a-colour' })
    expect(svg).toContain('stop-color="#00f0ff"')
    expect(svg).toContain('stop-color="#10b981"')
    expect(svg).not.toContain('rgb(1,2,3)')
    expect(svg).not.toContain('not-a-colour')
  })

  // Regression: 5- and 7-digit strings satisfy /^#[0-9a-fA-F]{3,8}$/ but are
  // NOT valid CSS colours — a renderer drops the stop and blanks the gradient.
  // The guard must reject them (only 3/4/6/8 are legal hex lengths).
  it('rejects 5- and 7-digit hex strings that are not legal CSS colours', () => {
    const five = buildAppIconSvg({ primary: '#12345', accent: '#10b981' })
    expect(five).not.toContain('stop-color="#12345"')
    expect(five).toContain('stop-color="#00f0ff"')

    const seven = buildAppIconSvg({ primary: '#00f0ff', accent: '#1234567' })
    expect(seven).not.toContain('stop-color="#1234567"')
    expect(seven).toContain('stop-color="#10b981"')
  })

  it('rejects out-of-range lengths and stray hash-only input', () => {
    for (const bad of ['#', '#12', '#123456789', '', '#gggggg']) {
      const svg = buildAppIconSvg({ primary: bad, accent: bad })
      expect(svg).toContain('stop-color="#00f0ff"')
      expect(svg).toContain('stop-color="#10b981"')
    }
  })
})

describe('svgToDataUrl', () => {
  it('base64-encodes with the SVG mime prefix and round-trips via atob', () => {
    const svg = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981' })
    const url = svgToDataUrl(svg)
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(decode(url)).toBe(svg)
  })

  it('is byte-stable so the browser does not churn the favicon', () => {
    const svg = buildAppIconSvg({ primary: '#00f0ff', accent: '#10b981' })
    expect(svgToDataUrl(svg)).toBe(svgToDataUrl(svg))
  })

  it('encodes the empty string to a bare data-URL header', () => {
    expect(svgToDataUrl('')).toBe('data:image/svg+xml;base64,')
  })

  it('degrades to a predictable empty data URL when btoa is unavailable', () => {
    vi.stubGlobal('btoa', undefined)
    try {
      expect(svgToDataUrl('<svg/>')).toBe('data:image/svg+xml;base64,')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('renderSvgToPngDataUrl', () => {
  const realCreateElement = document.createElement.bind(document)
  type Ctx2D = { drawImage: ReturnType<typeof vi.fn> }
  type FakeCanvas = {
    width: number
    height: number
    getContext: () => Ctx2D | null
    toDataURL: () => string
  }

  let imgBehavior: 'load' | 'error' = 'load'
  let currentCanvas: FakeCanvas | null = null

  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private _src = ''
    get src() {
      return this._src
    }
    set src(value: string) {
      this._src = value
      queueMicrotask(() => {
        if (imgBehavior === 'error') this.onerror?.()
        else this.onload?.()
      })
    }
  }

  function makeCanvas(
    ctx: Ctx2D | null,
    toDataURL: () => string = () => 'data:image/png;base64,PNGDATA',
  ): FakeCanvas {
    return { width: 0, height: 0, getContext: () => ctx, toDataURL }
  }

  beforeEach(() => {
    imgBehavior = 'load'
    currentCanvas = null
    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' && currentCanvas
        ? (currentCanvas as unknown as HTMLElement)
        : realCreateElement(tag)) as unknown as typeof document.createElement)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rasterises to a PNG data URL, sizing the canvas and drawing the image', async () => {
    const ctx: Ctx2D = { drawImage: vi.fn() }
    currentCanvas = makeCanvas(ctx)

    const result = await renderSvgToPngDataUrl('<svg/>', 64)

    expect(result).toBe('data:image/png;base64,PNGDATA')
    expect(currentCanvas.width).toBe(64)
    expect(currentCanvas.height).toBe(64)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 64, 64)
  })

  it('resolves null when the 2D context is unavailable', async () => {
    currentCanvas = makeCanvas(null)
    await expect(renderSvgToPngDataUrl('<svg/>', 192)).resolves.toBeNull()
  })

  it('resolves null when the image fails to decode', async () => {
    imgBehavior = 'error'
    currentCanvas = makeCanvas({ drawImage: vi.fn() })
    await expect(renderSvgToPngDataUrl('<svg/>', 192)).resolves.toBeNull()
  })

  it('resolves null (never throws) when drawImage raises', async () => {
    const ctx: Ctx2D = {
      drawImage: vi.fn(() => {
        throw new Error('tainted canvas')
      }),
    }
    currentCanvas = makeCanvas(ctx)
    await expect(renderSvgToPngDataUrl('<svg/>', 512)).resolves.toBeNull()
  })

  it('resolves null in a non-DOM environment (no document)', async () => {
    vi.stubGlobal('document', undefined)
    try {
      await expect(renderSvgToPngDataUrl('<svg/>', 192)).resolves.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
