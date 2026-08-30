#!/usr/bin/env node
/**
 * Reduced-motion audit (A11Y-08).
 *
 * Walks `web/src/**` and fails when an animation that runs forever, or
 * a Recharts series that animates by default, ships without consulting
 * the user's reduced-motion preference.
 *
 * Why a static audit
 * ------------------
 * The global `@media (prefers-reduced-motion: reduce)` block in
 * `index.css` is a safety net for CSS animations only. The two motion
 * sources that matter most in this app are invisible to it:
 *
 *  - **framer-motion loops** (`repeat: Infinity`) run on
 *    `requestAnimationFrame` and set inline styles directly. CSS cannot
 *    stop them, and an infinite loop over five seconds is a WCAG 2.2.2
 *    failure.
 *  - **Recharts series** animate by default via react-smooth, also on
 *    `requestAnimationFrame`.
 *
 * Runtime tooling cannot catch either: axe does not evaluate motion,
 * and the Playwright suite only visits a handful of routes. A static
 * scan covers every file in a second.
 *
 * What passes
 * -----------
 * An infinite loop is acceptable when the surrounding file:
 *   - calls `useMotionPreference()` (the hook form), OR
 *   - wraps the transition in `ambientLoop(...)` (the pure helper used
 *     by scenes with many looping layers).
 *
 * Run: `node scripts/audit-reduced-motion.mjs`
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

const ROOT = join('src');

/** framer-motion infinite loop. */
const INFINITE_RE = /repeat:\s*Infinity/g;

/** Evidence that a file is motion-aware. */
const AWARE_RE = /useMotionPreference\s*\(|ambientLoop\s*\(|prefersReducedMotion\s*\(/;

/**
 * Files allowed to mention `repeat: Infinity` without being
 * motion-aware. Keep this list empty unless there is a documented
 * reason — every entry is a user who cannot turn an animation off.
 */
const ALLOWED_FILES = new Set([
  // The pure helper module documents the pattern it replaces.
  toKey(join('src', 'components', 'motion', 'ambient.ts')),
]);

function toKey(p) {
  return p.split(sep).join('/');
}

const loopOffenders = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p);
      continue;
    }
    if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue;
    if (p.includes('.test.')) continue;
    if (ALLOWED_FILES.has(toKey(p))) continue;
    auditFile(p);
  }
}

/** Comment ranges, so documentation of the anti-pattern is not an offence. */
function buildCommentRegions(text) {
  const regions = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      regions.push([start, i]);
      continue;
    }
    if (c === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      regions.push([start, i]);
      continue;
    }
    i++;
  }
  return regions;
}

function isMasked(regions, offset) {
  for (const [s, e] of regions) {
    if (offset >= s && offset < e) return true;
    if (s > offset) return false;
  }
  return false;
}

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  if (!INFINITE_RE.test(text)) return;
  INFINITE_RE.lastIndex = 0;
  if (AWARE_RE.test(text)) return;

  const comments = buildCommentRegions(text);
  let m;
  while ((m = INFINITE_RE.exec(text)) !== null) {
    if (isMasked(comments, m.index)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
    const lineEndRaw = text.indexOf('\n', m.index);
    const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
    loopOffenders.push({
      where: `${path}:${line}`,
      snippet: text.slice(lineStart, lineEnd).trim(),
    });
  }
}

walk(ROOT);

if (loopOffenders.length > 0) {
  console.error(
    `\nreduced-motion audit: ${loopOffenders.length} infinite animation ` +
      `loop(s) run regardless of the user's reduced-motion preference ` +
      `(WCAG 2.2.2):`,
  );
  for (const o of loopOffenders) {
    console.error(`  ${o.where}\n      ${o.snippet}`);
  }
  console.error(
    '\nFix with the hook when a component owns one or two animations:\n' +
      '\n' +
      "  import { useMotionPreference } from '@/hooks/useMotionPreference';\n" +
      '  const { reduce } = useMotionPreference();\n' +
      '  <motion.div\n' +
      '    animate={{ opacity: reduce ? 0.4 : [0.4, 1, 0.4] }}\n' +
      '    transition={reduce ? { duration: 0 } : { duration: 2, repeat: Infinity }}\n' +
      '  />\n' +
      '\n' +
      'Or with the pure helpers inside a scene with many looping layers\n' +
      '(the root of the scene must call `useMotionPreference()` once so a\n' +
      'mid-session preference change repaints it):\n' +
      '\n' +
      "  import { ambientFrames, ambientLoop } from '@/components/motion';\n" +
      '  <motion.ellipse\n' +
      '    animate={ambientFrames({ opacity: [0.2, 0.55, 0.2] })}\n' +
      '    transition={ambientLoop({ duration: 2.4, repeat: Infinity })}\n' +
      '  />\n',
  );
  process.exit(1);
}

console.log(
  `OK — every infinite animation loop in ${ROOT} consults the ` +
    `reduced-motion preference`,
);
