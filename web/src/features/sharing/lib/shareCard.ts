/**
 * Share Card model — a self-contained SVG stat card for social sharing.
 *
 * Aggregates a period of drives into headline stats and renders them into a
 * standalone SVG document string (fixed dark styling, like the Drive DNA
 * export — a share card must look identical wherever it lands, so it is
 * deliberately NOT themed by the app). All labels/values arrive
 * pre-translated and pre-formatted from the page. Pure.
 */

import type { Drive } from '@/types/driving';

export interface ShareCardStats {
  drives: number;
  distanceM: number;
  energyUsedWh: number;
  regenWh: number;
  /** Distance-weighted consumption, Wh/km; null under 1 km total. */
  whPerKm: number | null;
  /** Longest single drive, meters. */
  longestM: number;
  maxSpeedMps: number | null;
}

export function computeShareStats(drives: readonly Drive[]): ShareCardStats {
  let distance = 0;
  let energy = 0;
  let regen = 0;
  let longest = 0;
  let maxSpeed: number | null = null;
  for (const d of drives) {
    const dist = Number.isFinite(d.distanceM) ? Math.max(0, d.distanceM) : 0;
    distance += dist;
    if (dist > longest) longest = dist;
    if (d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0) energy += d.energyUsedWh;
    if (d.regenEnergyWh != null && Number.isFinite(d.regenEnergyWh) && d.regenEnergyWh > 0) regen += d.regenEnergyWh;
    if (d.maxSpeedMps != null && Number.isFinite(d.maxSpeedMps)) {
      if (maxSpeed == null || d.maxSpeedMps > maxSpeed) maxSpeed = d.maxSpeedMps;
    }
  }
  return {
    drives: drives.length,
    distanceM: distance,
    energyUsedWh: energy,
    regenWh: regen,
    whPerKm: distance >= 1000 ? Math.round((energy / (distance / 1000)) * 10) / 10 : null,
    longestM: longest,
    maxSpeedMps: maxSpeed,
  };
}

export type ShareCardTheme = 'midnight' | 'aurora' | 'ember';

export const SHARE_CARD_THEMES: Record<ShareCardTheme, { bg: string; accent: string; soft: string }> = {
  midnight: { bg: '#0b1220', accent: '#22d3ee', soft: '#38bdf8' },
  aurora: { bg: '#071a12', accent: '#34d399', soft: '#a7f3d0' },
  ember: { bg: '#1c0f0a', accent: '#fb923c', soft: '#fdba74' },
};

export interface ShareCardLine {
  label: string;
  value: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a 800×418 (social 1.91:1) SVG document. `title`/`subtitle`/`lines`
 * are already translated and unit-formatted; this only lays them out.
 */
export function renderShareCardSvg(
  title: string,
  subtitle: string,
  lines: readonly ShareCardLine[],
  theme: ShareCardTheme,
): string {
  const t = SHARE_CARD_THEMES[theme] ?? SHARE_CARD_THEMES.midnight;
  const W = 800;
  const H = 418;
  const shown = lines.slice(0, 6);
  const cols = shown.length > 3 ? 3 : Math.max(1, shown.length);
  const colW = (W - 96) / cols;

  const cells = shown
    .map((line, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 48 + col * colW;
      const y = 210 + row * 92;
      return (
        `<text x="${x}" y="${y}" fill="${t.accent}" font-size="34" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${esc(line.value)}</text>` +
        `<text x="${x}" y="${y + 26}" fill="#94a3b8" font-size="15" font-family="Segoe UI, Arial, sans-serif">${esc(line.label)}</text>`
      );
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" rx="24" fill="${t.bg}"/>` +
    `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="22.5" fill="none" stroke="${t.accent}" stroke-opacity="0.35" stroke-width="3"/>` +
    `<circle cx="${W - 84}" cy="84" r="120" fill="${t.soft}" opacity="0.08"/>` +
    `<circle cx="${W - 44}" cy="44" r="60" fill="${t.accent}" opacity="0.1"/>` +
    `<text x="48" y="86" fill="#f8fafc" font-size="40" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${esc(title)}</text>` +
    `<text x="48" y="120" fill="#94a3b8" font-size="18" font-family="Segoe UI, Arial, sans-serif">${esc(subtitle)}</text>` +
    `<line x1="48" y1="150" x2="${W - 48}" y2="150" stroke="${t.accent}" stroke-opacity="0.3" stroke-width="1.5"/>` +
    cells +
    `<text x="48" y="${H - 28}" fill="#64748b" font-size="13" font-family="Segoe UI, Arial, sans-serif">TeslaSync</text>` +
    `</svg>`
  );
}
