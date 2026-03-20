import { describe, it, expect, vi } from 'vitest'
import { buildExportUrl, exportAsCSV, exportAsJSON } from './export'

describe('buildExportUrl', () => {
  it('builds URL with type and format', () => {
    const url = buildExportUrl('drives', 'csv')
    expect(url).toBe('/api/v1/export/drives?format=csv')
  })

  it('builds URL with json format', () => {
    const url = buildExportUrl('charging', 'json')
    expect(url).toBe('/api/v1/export/charging?format=json')
  })

  it('includes date filters when provided', () => {
    const url = buildExportUrl('drives', 'csv', {
      start: '2024-01-01',
      end: '2024-12-31',
    })
    expect(url).toContain('start=2024-01-01')
    expect(url).toContain('end=2024-12-31')
    expect(url).toContain('format=csv')
  })

  it('includes vehicleId when provided', () => {
    const url = buildExportUrl('positions', 'json', { vehicleId: 42 })
    expect(url).toContain('vehicle_id=42')
  })

  it('omits optional filters when not provided', () => {
    const url = buildExportUrl('drives', 'csv', {})
    expect(url).toBe('/api/v1/export/drives?format=csv')
  })
})

describe('exportAsCSV', () => {
  it('does nothing with empty data', () => {
    // Should not throw
    exportAsCSV([], 'test.csv')
  })

  it('creates CSV and triggers download', () => {
    const clickSpy = vi.fn()
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
    } as unknown as HTMLAnchorElement)
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')

    const data = [
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 30 },
    ]

    exportAsCSV(data, 'test.csv')

    expect(createElementSpy).toHaveBeenCalledWith('a')
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeUrl).toHaveBeenCalledWith('blob:test')

    createElementSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
    revokeUrl.mockRestore()
    createUrl.mockRestore()
  })
})

describe('exportAsJSON', () => {
  it('creates JSON and triggers download', () => {
    const clickSpy = vi.fn()
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
    } as unknown as HTMLAnchorElement)
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')

    exportAsJSON([{ a: 1 }], 'test.json')

    expect(clickSpy).toHaveBeenCalled()
    expect(revokeUrl).toHaveBeenCalledWith('blob:test')

    createElementSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
    revokeUrl.mockRestore()
    createUrl.mockRestore()
  })
})
