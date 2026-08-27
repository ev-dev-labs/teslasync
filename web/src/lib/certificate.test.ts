import { generateCarbonCertificate } from './certificate'

describe('generateCarbonCertificate', () => {
  let writeSpy: ReturnType<typeof vi.fn>
  let closeSpy: ReturnType<typeof vi.fn>
  let printSpy: ReturnType<typeof vi.fn>
  let capturedHTML = ''

  beforeEach(() => {
    writeSpy = vi.fn((html: string) => { capturedHTML = html })
    closeSpy = vi.fn()
    printSpy = vi.fn()
    capturedHTML = ''

    vi.spyOn(window, 'open').mockReturnValue({
      document: { write: writeSpy, close: closeSpy },
      print: printSpy,
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseData = {
    vehicleName: 'Model Y',
    totalKm: 10000,
    totalKwh: 2000,
  }

  it('opens a new window and writes HTML', () => {
    generateCarbonCertificate(baseData)
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalled()
    expect(printSpy).toHaveBeenCalled()
  })

  it('includes the vehicle name', () => {
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('Model Y')
    expect(capturedHTML).toMatch(/<link rel="stylesheet" href="[^"]+\/print\.css">/)
    expect(capturedHTML).not.toContain('<style>')
  })

  it('calculates CO2 saved correctly', () => {
    // 10000 km => (10000/100)*8 = 800 L gas => 800*2.31 = 1848 kg CO2
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('1,848')
  })

  it('calculates trees equivalent', () => {
    // 1848 / 22 ≈ 84 trees
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('84')
  })

  it('calculates gallons saved', () => {
    // 800 * 0.264172 ≈ 211
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('211')
  })

  it('includes the total kWh', () => {
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('2000')
  })

  it('includes the total km', () => {
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('10,000')
  })

  it('shows owner name when provided', () => {
    generateCarbonCertificate({ ...baseData, ownerName: 'Alice' })
    expect(capturedHTML).toContain('Alice')
  })

  it('HTML-escapes vehicle and owner names in the print document', () => {
    generateCarbonCertificate({ ...baseData, vehicleName: '<img src=x>', ownerName: '<script>alert(1)</script>' })
    expect(capturedHTML).not.toContain('<img src=x>')
    expect(capturedHTML).not.toContain('<script>alert(1)</script>')
    expect(capturedHTML).toContain('&lt;img src=x&gt;')
    expect(capturedHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('falls back to "TeslaSync User" when no owner name', () => {
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('TeslaSync User')
  })

  it('does nothing if window.open returns null (popup blocked)', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    // Should not throw
    expect(() => generateCarbonCertificate(baseData)).not.toThrow()
    expect(writeSpy).not.toHaveBeenCalled()
  })

  it('contains certificate heading and TeslaSync branding', () => {
    generateCarbonCertificate(baseData)
    expect(capturedHTML).toContain('Carbon Offset Certificate')
    expect(capturedHTML).toContain('Powered by TeslaSync')
  })
})
