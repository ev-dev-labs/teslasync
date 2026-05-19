import { formatDate } from './dateFormat'
import { fmtNumber } from './numberFormat'

/**
 * Loose shape accepted by GPX exporter. Matches the fields actually used by
 * the renderer below; permissive about extras so callers can pass a full
 * `Drive` or a derived view without conversion.
 */
export interface GpxDriveInput {
  id?: number
  start_date?: string | null
  /** Distance in kilometres. */
  distance?: number | null
  duration_min?: number | null
}

/**
 * Loose shape accepted for individual position samples. Matches the per-point
 * fields the GPX `<trkpt>` block consumes.
 */
export interface GpxPositionInput {
  latitude?: number | null
  longitude?: number | null
  elevation?: number | null
  speed?: number | null
  power?: number | null
  battery_level?: number | null
  created_at?: string | null
}

export function exportDriveAsGPX(
  drive: GpxDriveInput,
  positions: ReadonlyArray<GpxPositionInput>,
  vehicleName: string,
) {
  const startDate = drive.start_date ?? ''
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TeslaSync"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${vehicleName} - ${formatDate(startDate)}</name>
    <desc>Drive exported from TeslaSync. Distance: ${fmtNumber(drive.distance ?? 0, 1)} km, Duration: ${Math.round(drive.duration_min ?? 0)} min</desc>
    <time>${new Date(startDate).toISOString()}</time>
  </metadata>
  <trk>
    <name>Drive ${drive.id ?? ''}</name>
    <trkseg>
${positions
  .filter(p => p.latitude != null && p.longitude != null)
  .map(p => `      <trkpt lat="${p.latitude}" lon="${p.longitude}">
        <ele>${p.elevation ?? 0}</ele>
        <time>${new Date(p.created_at ?? '').toISOString()}</time>
        <extensions>
          <speed>${p.speed ?? 0}</speed>
          <battery>${p.battery_level ?? 0}</battery>
          <power>${p.power ?? 0}</power>
        </extensions>
      </trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`

  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `teslasync-drive-${drive.id ?? 'export'}-${new Date(startDate).toISOString().slice(0,10)}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
