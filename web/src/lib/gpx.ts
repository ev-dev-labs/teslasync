export function exportDriveAsGPX(drive: any, positions: any[], vehicleName: string) {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TeslaSync"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${vehicleName} - ${new Date(drive.start_date).toLocaleDateString()}</name>
    <desc>Drive exported from TeslaSync. Distance: ${drive.distance?.toFixed(1)} km, Duration: ${Math.round(drive.duration_min)} min</desc>
    <time>${new Date(drive.start_date).toISOString()}</time>
  </metadata>
  <trk>
    <name>Drive ${drive.id}</name>
    <trkseg>
${positions
  .filter(p => p.latitude && p.longitude)
  .map(p => `      <trkpt lat="${p.latitude}" lon="${p.longitude}">
        <ele>${p.elevation || 0}</ele>
        <time>${new Date(p.created_at).toISOString()}</time>
        <extensions>
          <speed>${p.speed || 0}</speed>
          <battery>${p.battery_level || 0}</battery>
          <power>${p.power || 0}</power>
        </extensions>
      </trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`

  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `teslasync-drive-${drive.id}-${new Date(drive.start_date).toISOString().slice(0,10)}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
