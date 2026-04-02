import { exportDriveAsGPX } from './gpx'

// Mock DOM APIs used by exportDriveAsGPX (Blob, URL, createElement, etc.)
const clickSpy = vi.fn()
let capturedGpx = ''

const OriginalBlob = globalThis.Blob

beforeEach(() => {
  clickSpy.mockReset()
  capturedGpx = ''

  // Replace Blob constructor to capture content
  globalThis.Blob = class MockBlob {
    constructor(parts: BlobPart[]) {
      capturedGpx = parts.map(p => String(p)).join('')
    }
  } as any

  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

  vi.spyOn(document, 'createElement').mockReturnValue({
    href: '',
    download: '',
    click: clickSpy,
  } as any)

  vi.spyOn(document.body, 'appendChild').mockImplementation(n => n)
  vi.spyOn(document.body, 'removeChild').mockImplementation(n => n)
})

afterEach(() => {
  globalThis.Blob = OriginalBlob
  vi.restoreAllMocks()
})

const drive = {
  id: 42,
  start_date: '2024-06-15T08:00:00Z',
  distance: 123.456,
  duration_min: 90,
}

const positions = [
  { latitude: 37.7749, longitude: -122.4194, elevation: 10, speed: 60, battery_level: 80, power: 15, created_at: '2024-06-15T08:01:00Z' },
  { latitude: 37.7849, longitude: -122.4094, elevation: 15, speed: 65, battery_level: 79, power: 18, created_at: '2024-06-15T08:02:00Z' },
]

describe('exportDriveAsGPX', () => {
  it('generates valid GPX XML with proper header', () => {
    exportDriveAsGPX(drive, positions, 'Model 3')
    expect(capturedGpx).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(capturedGpx).toContain('<gpx version="1.1" creator="TeslaSync"')
    expect(capturedGpx).toContain('http://www.topografix.com/GPX/1/1')
  })

  it('includes metadata with vehicle name', () => {
    exportDriveAsGPX(drive, positions, 'Model 3')
    expect(capturedGpx).toContain('Model 3')
    expect(capturedGpx).toContain('<metadata>')
  })

  it('includes track points with lat/lon', () => {
    exportDriveAsGPX(drive, positions, 'Model 3')
    expect(capturedGpx).toContain('lat="37.7749"')
    expect(capturedGpx).toContain('lon="-122.4194"')
    expect(capturedGpx).toContain('lat="37.7849"')
    expect(capturedGpx).toContain('lon="-122.4094"')
  })

  it('includes elevation, speed, battery, and power in extensions', () => {
    exportDriveAsGPX(drive, positions, 'Model 3')
    expect(capturedGpx).toContain('<ele>10</ele>')
    expect(capturedGpx).toContain('<speed>60</speed>')
    expect(capturedGpx).toContain('<battery>80</battery>')
    expect(capturedGpx).toContain('<power>15</power>')
  })

  it('handles empty position arrays', () => {
    exportDriveAsGPX(drive, [], 'Model 3')
    expect(capturedGpx).toContain('<trkseg>')
    expect(capturedGpx).toContain('</trkseg>')
    expect(capturedGpx).not.toContain('<trkpt')
  })

  it('filters out positions without coordinates', () => {
    const mixed = [
      { latitude: null, longitude: null, created_at: '2024-06-15T08:01:00Z' },
      { latitude: 37.0, longitude: -122.0, elevation: 0, speed: 0, battery_level: 50, power: 0, created_at: '2024-06-15T08:02:00Z' },
    ]
    exportDriveAsGPX(drive, mixed, 'Model S')
    expect(capturedGpx).not.toContain('lat="null"')
    expect(capturedGpx).toContain('lat="37"')
  })

  it('triggers a download', () => {
    exportDriveAsGPX(drive, positions, 'Model 3')
    expect(clickSpy).toHaveBeenCalled()
  })
})
