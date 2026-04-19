#!/usr/bin/env node
/**
 * Generate PWA icon assets from the TeslaSync brand SVG.
 *
 * Usage:  node scripts/generate-icons.mjs
 * Requires: npm install --save-dev sharp  (in web/)
 *
 * Produces:
 *   web/public/icons/icon-192.png          — purpose: any  (taskbar/dock)
 *   web/public/icons/icon-512.png          — purpose: any
 *   web/public/icons/icon-maskable-192.png — purpose: maskable (Android adaptive)
 *   web/public/icons/icon-maskable-512.png — purpose: maskable
 *   web/public/icons/apple-touch-icon.png  — iOS home screen (180×180)
 */

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve sharp from web/node_modules where it's installed
const require = createRequire(resolve(__dirname, '../web/package.json'));
const sharp = require('sharp');

const ICONS_DIR = resolve(__dirname, '../web/public/icons');

// Brand constants
const BOLT_PATH = 'M112 30L62 108h34L78 170l58-82h-34z';
const GRADIENT_START = '#00f0ff';
const GRADIENT_END = '#10b981';

/**
 * Build an SVG string for the "any" purpose icon.
 * Rounded gradient rect fills the full canvas; white bolt centered.
 */
function buildAnySvg(size) {
  const radius = Math.round(size * 0.22);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
      <stop stop-color="${GRADIENT_START}"/>
      <stop offset="1" stop-color="${GRADIENT_END}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="${Math.round((radius / size) * 200)}" fill="url(#g)"/>
  <path d="${BOLT_PATH}" fill="white"/>
</svg>`;
}

/**
 * Build an SVG string for the "maskable" purpose icon.
 * Solid gradient rect fills full canvas (no rounded corners — OS masks it).
 * Bolt content scaled to center 80% (safe zone).
 */
function buildMaskableSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
      <stop stop-color="${GRADIENT_START}"/>
      <stop offset="1" stop-color="${GRADIENT_END}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#g)"/>
  <g transform="translate(100,100) scale(0.75) translate(-99,-100)">
    <path d="${BOLT_PATH}" fill="white"/>
  </g>
</svg>`;
}

/**
 * Build an SVG for the apple-touch-icon (180×180).
 * Square with full-bleed gradient (iOS applies its own rounding).
 * Bolt at slightly smaller scale to look good after iOS masking.
 */
function buildAppleTouchSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
      <stop stop-color="${GRADIENT_START}"/>
      <stop offset="1" stop-color="${GRADIENT_END}"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" fill="url(#g)"/>
  <g transform="translate(100,100) scale(0.85) translate(-99,-100)">
    <path d="${BOLT_PATH}" fill="white"/>
  </g>
</svg>`;
}

async function generate() {
  const tasks = [];

  // purpose: any — rounded gradient, full-bleed
  for (const size of [192, 512]) {
    const svg = Buffer.from(buildAnySvg(size));
    const outPath = resolve(ICONS_DIR, `icon-${size}.png`);
    tasks.push(
      sharp(svg, { density: 150 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toFile(outPath)
        .then(() => console.log(`✓ ${outPath}`))
    );
  }

  // purpose: maskable — full-bleed, bolt in safe zone
  for (const size of [192, 512]) {
    const svg = Buffer.from(buildMaskableSvg(size));
    const outPath = resolve(ICONS_DIR, `icon-maskable-${size}.png`);
    tasks.push(
      sharp(svg, { density: 150 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toFile(outPath)
        .then(() => console.log(`✓ ${outPath}`))
    );
  }

  // apple-touch-icon — 180×180, full-bleed gradient
  {
    const svg = Buffer.from(buildAppleTouchSvg());
    const outPath = resolve(ICONS_DIR, 'apple-touch-icon.png');
    tasks.push(
      sharp(svg, { density: 150 })
        .resize(180, 180)
        .png({ compressionLevel: 9 })
        .toFile(outPath)
        .then(() => console.log(`✓ ${outPath}`))
    );
  }

  await Promise.all(tasks);
  console.log('\nAll icons generated successfully.');
}

generate().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
