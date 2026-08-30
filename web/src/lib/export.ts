/**
 * Client-side data export utilities for TeslaSync.
 *
 * Provides CSV and JSON export from in-memory data arrays,
 * as well as helpers for server-side export URL construction.
 */
import { redactExportValue, redactSensitiveData } from './privacy'

/** Build a server-side export URL with optional filters */
export function buildExportUrl(
  type: 'drives' | 'charging' | 'positions',
  format: 'csv' | 'json',
  filters?: { start?: string; end?: string; vehicleId?: number | string }
): string {
  const params = new URLSearchParams({ format })
  if (filters?.start) params.set('start', filters.start)
  if (filters?.end) params.set('end', filters.end)
  if (filters?.vehicleId) params.set('vehicle_id', String(filters.vehicleId))
  return `/api/v1/export/${type}?${params.toString()}`
}

/** Export an array of objects as a CSV file download */
export function exportAsCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  columns?: { key: keyof T; label: string }[]
) {
  if (!data.length) return

  const cols = columns ?? Object.keys(data[0]).map(key => ({ key: key as keyof T, label: String(key) }))
  const header = cols.map(c => c.label).join(',')
  const rows = data.map(row =>
    cols.map(c => {
      const val = redactExportValue(String(c.key), row[c.key])
      if (val === null || val === undefined) return ''
      const text = String(val)
      const safeText = typeof val === 'string' && /^[\t\r\n ]*[=+\-@]/.test(text)
        ? `'${text}`
        : text
      if (safeText.includes(',') || safeText.includes('"') || safeText.includes('\n')) {
        return `"${safeText.replace(/"/g, '""')}"`
      }
      return safeText
    }).join(',')
  )
  const csv = [header, ...rows].join('\n')
  downloadBlob(csv, filename, 'text/csv;charset=utf-8;')
}

/** Export an array of objects as a JSON file download */
export function exportAsJSON<T>(data: T[], filename: string) {
  const json = JSON.stringify(redactSensitiveData(data), null, 2)
  downloadBlob(json, filename, 'application/json')
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
