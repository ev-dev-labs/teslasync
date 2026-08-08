import {
  DNA_CENTER,
  DNA_VIEWBOX,
  petalLine,
  type DriveGenome,
} from '../../lib/driveDNA';

export const DRIVE_DNA_SVG_REVOKE_DELAY_MS = 1_500;

/** Escape text and attribute metacharacters before inserting data into XML. */
export function escapeDriveDnaXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build a standalone, inert SVG document from a deterministic genome. */
export function buildDriveDnaSvg(
  genome: DriveGenome,
  label: string,
): string {
  const rings = genome.rings
    .map(
      (ring) =>
        `<circle cx="${DNA_CENTER}" cy="${DNA_CENTER}" r="${ring.r.toFixed(2)}" fill="none" stroke="${escapeDriveDnaXml(ring.color)}" stroke-width="0.4"/>`,
    )
    .join('');
  const petals = genome.petals
    .map((petal) => {
      const line = petalLine(petal);
      return `<line x1="${line.x1.toFixed(2)}" y1="${line.y1.toFixed(2)}" x2="${line.x2.toFixed(2)}" y2="${line.y2.toFixed(2)}" stroke="${escapeDriveDnaXml(petal.color)}" stroke-width="${petal.width.toFixed(2)}" stroke-linecap="round" opacity="${petal.opacity.toFixed(2)}"/>`;
    })
    .join('');
  const caption = escapeDriveDnaXml(`${label} · ${genome.signature}`);
  const halo = escapeDriveDnaXml(genome.haloColor);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DNA_VIEWBOX} ${DNA_VIEWBOX}" width="512" height="512">`,
    `<rect width="${DNA_VIEWBOX}" height="${DNA_VIEWBOX}" rx="3" fill="${halo}"/>`,
    `<circle cx="${DNA_CENTER}" cy="${DNA_CENTER}" r="${DNA_CENTER - 2}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>`,
    rings,
    petals,
    `<text x="${DNA_CENTER}" y="${DNA_VIEWBOX - 4}" fill="rgba(255,255,255,0.62)" font-size="3.2" text-anchor="middle" font-family="monospace">${caption}</text>`,
    '</svg>',
  ].join('');
}

/** Trigger a safe local SVG download. Returns false when there is no artwork. */
export function downloadDriveDnaSvg(
  genome: DriveGenome,
  label: string,
): boolean {
  if (genome.petals.length === 0 || typeof document === 'undefined') {
    return false;
  }
  const svg = buildDriveDnaSvg(genome, label);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeSignature =
    genome.signature.replace(/[^0-9A-Z-]/gi, '') || 'fingerprint';
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `drive-dna-${safeSignature}.svg`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Let the browser consume the object URL before releasing it. The
    // temporary DOM node itself is removed synchronously.
    setTimeout(
      () => URL.revokeObjectURL(url),
      DRIVE_DNA_SVG_REVOKE_DELAY_MS,
    );
  }
  return true;
}
