#!/usr/bin/env node
/**
 * Blessed re-pin generator for the authorized shell-preservation tripwire.
 *
 * The shell files (Layout, CommandPalette, ThemeQuickSwitcherPopover) changed
 * legitimately (trio + sidenav redesigns), invalidating the pinned current
 * hashes, predecessor fingerprints, and (where the redesign rewrote a pinned
 * region) the fragment `current` sides. This script re-derives everything
 * from the reviewed tree instead of hand-editing hashes:
 *
 * - stale fragment `current` sides are re-extracted by aligning the trio-era
 *   span (TRIO_REV, the last tree where every fragment matched) through the
 *   current diff, keeping the canonical `predecessor` sides untouched;
 * - predecessorSHA256 + the test's current/predecessor pins are recomputed;
 * - the palette derived pin (canonical with the translator inverse applied)
 *   is recomputed with the test's own literals;
 * - sentinel strings the test relies on must still exist, else fail loudly.
 *
 * Usage: node --experimental-strip-types web/scripts/repin-shell-preservation.mts
 * Must be idempotent: a second run changes nothing.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptedShellDeltas,
  restoreAcceptedShellSource,
} from '../src/i18n/authorized-shell-preservation.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRIO_REV = '887511e3ab';
const MODULE_PATH = 'web/src/i18n/authorized-shell-preservation.ts';
const TEST_PATH = 'web/src/i18n/authorized-shell-preservation.test.ts';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const gitShow = (rev, path) =>
  execFileSync('git', ['show', `${rev}:${path}`], { cwd: ROOT, encoding: 'buffer', maxBuffer: 1 << 26 }).toString('utf8');

// Escape exactly like the committed module: double-quoted, \n \" \\, \uXXXX lowercase.
function escapeModuleString(s) {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 32 || code === 127) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else if (code > 126) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out + '"';
}

function parseHunks(diff) {
  const hunks = [];
  for (const m of diff.matchAll(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g)) {
    hunks.push({
      oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return hunks;
}

// Map a 1-based trio line span through the diff to a 1-based worktree span,
// expanding across intersecting changed hunks.
function mapSpan(hunks, from, to) {
  const mapLine = (line, edge) => {
    let offset = 0;
    for (const h of hunks) {
      const oldEnd = h.oldStart + h.oldCount;
      const newEnd = h.newStart + h.newCount;
      if (line >= h.oldStart && line < oldEnd) {
        return edge === 'start' ? h.newStart : newEnd - 1;
      }
      if (oldEnd <= line) offset += h.newCount - h.oldCount;
    }
    return line + offset;
  };
  return [mapLine(from, 'start'), mapLine(to, 'end')];
}

function lineSpanOf(text, needle) {
  const at = text.indexOf(needle);
  if (at < 0 || text.indexOf(needle, at + 1) >= 0) return null;
  if (at > 0 && text[at - 1] !== '\n') return null;
  const from = text.slice(0, at).split('\n').length;
  const parts = needle.split('\n').length - (needle.endsWith('\n') ? 1 : 0);
  return [from, from + parts - 1];
}

const moduleText = readFileSync(resolve(ROOT, MODULE_PATH), 'utf8');
// The escaper must reproduce every committed fragment byte-for-byte, or the
// updated fragments would introduce formatting drift.
for (const delta of acceptedShellDeltas) {
  for (const fragment of delta.fragments) {
    for (const side of [fragment.current, fragment.predecessor]) {
      if (!moduleText.includes(`: ${escapeModuleString(side)}`)) {
        throw new Error(`escaper drift on ${delta.path} fragment (${side.slice(0, 60)}…)`);
      }
    }
  }
}

let moduleOut = moduleText;
const predecessors = {};
const mappedByPath = {};
for (const delta of acceptedShellDeltas) {
  const trioText = gitShow(TRIO_REV, delta.path);
  const newText = readFileSync(resolve(ROOT, delta.path), 'utf8');
  const diff = execFileSync('git', ['diff', '--unified=0', TRIO_REV, '--', delta.path], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  const hunks = parseHunks(diff);
  const newLines = newText.split('\n');
  // First pass: map every stale fragment to a worktree span (or drop).
  const plans = [];
  for (const [index, fragment] of delta.fragments.entries()) {
    if (newText.split(fragment.current).length - 1 === 1) {
      plans.push({ index, fragment, action: 'keep' });
      continue;
    }
    const span = lineSpanOf(trioText, fragment.current);
    if (!span) throw new Error(`cannot locate trio span for ${delta.path} fragment ${index}`);
    const [newFrom, newTo] = mapSpan(hunks, span[0], span[1]);
    if (newTo < newFrom) {
      plans.push({ index, fragment, action: 'drop', span });
      continue;
    }
    if (!(newFrom >= 1 && newTo <= newLines.length)) {
      throw new Error(`mapped span out of range for ${delta.path} fragment ${index}`);
    }
    plans.push({ index, fragment, action: 'rederive', span, newFrom, newTo });
  }
  // Fragments whose trio regions merged into one worktree span merge into one
  // fragment (current = the merged span, predecessor = concatenated
  // predecessors in trio order).
  const groups = new Map();
  for (const plan of plans) {
    if (plan.action !== 'rederive') continue;
    const key = `${plan.newFrom}-${plan.newTo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plan);
  }
  const kept = [];
  for (const plan of plans) {
    const { index, fragment } = plan;
    if (plan.action === 'keep') {
      kept.push({ fragment, current: fragment.current });
      continue;
    }
    if (plan.action === 'drop') {
      // The redesign deleted this region outright: drop the fragment. The
      // whole-file pins still guard the file; a phantom region cannot.
      const block = `      {\n        current: ${escapeModuleString(fragment.current)},\n        predecessor: ${escapeModuleString(fragment.predecessor)},\n      },\n`;
      if (moduleOut.split(block).length - 1 !== 1) {
        throw new Error(`cannot uniquely drop ${delta.path} fragment ${index} from module`);
      }
      moduleOut = moduleOut.replace(block, '');
      console.log(`dropped ${delta.path} fragment ${index}: trio lines ${plan.span[0]}-${plan.span[1]} deleted by redesign`);
      continue;
    }
    const group = groups.get(`${plan.newFrom}-${plan.newTo}`);
    if (group[0] !== plan) continue; // merged into the group's first fragment
    const replacement = newLines.slice(plan.newFrom - 1, plan.newTo).join('\n') + '\n';
    if (newText.split(replacement).length - 1 !== 1) {
      throw new Error(`mapped replacement ambiguous for ${delta.path} fragment ${index}`);
    }
    const mergedPredecessor = group.map((p) => p.fragment.predecessor).join('');
    const mergedFragment = { current: replacement, predecessor: mergedPredecessor };
    kept.push({ fragment: mergedFragment, current: replacement });
    // Replace the first group member's block with the merged block, drop the rest.
    for (const [gi, member] of group.entries()) {
      const block = `      {\n        current: ${escapeModuleString(member.fragment.current)},\n        predecessor: ${escapeModuleString(member.fragment.predecessor)},\n      },\n`;
      if (moduleOut.split(block).length - 1 !== 1) {
        throw new Error(`cannot uniquely rewrite ${delta.path} fragment ${member.index} in module`);
      }
      const mergedBlock = gi === 0
        ? `      {\n        current: ${escapeModuleString(replacement)},\n        predecessor: ${escapeModuleString(mergedPredecessor)},\n      },\n`
        : '';
      moduleOut = moduleOut.replace(block, mergedBlock);
    }
    const ids = group.map((p) => p.index).join(',');
    console.log(`merged ${delta.path} fragments [${ids}]: trio -> worktree lines ${plan.newFrom}-${plan.newTo}`);
    if (group.length === 1) {
      console.log(`re-derived ${delta.path} fragment ${index}: trio lines ${plan.span[0]}-${plan.span[1]} -> worktree lines ${plan.newFrom}-${plan.newTo}`);
    }
  }
  // Sanity: mapped spans must be disjoint and ordered.
  let cursor = -1;
  for (const { current } of kept) {
    const at = newText.indexOf(current, cursor + 1);
    if (at < 0) throw new Error(`mapped fragment lost in ${delta.path}`);
    cursor = at;
  }
  // Mirror restoreAcceptedShellSource exactly, including its guards.
  let restored = newText;
  for (const [index, { fragment, current }] of kept.entries()) {
    if (restored.split(current).length !== 2 || restored.includes(fragment.predecessor)) {
      throw new Error(`mirror restore rejected ${delta.path} fragment ${index}`);
    }
    restored = restored.replace(current, fragment.predecessor);
  }
  const predecessor = sha256(restored);
  predecessors[delta.path] = { current: sha256(newText), predecessor };
  const oldPin = `: '${delta.predecessorSHA256}'`;
  const newPin = `: '${predecessor}'`;
  if (moduleOut.split(oldPin).length - 1 !== 1) {
    throw new Error(`cannot uniquely replace predecessor pin for ${delta.path}`);
  }
  moduleOut = moduleOut.replace(oldPin, newPin);
  mappedByPath[delta.path] = kept;
  console.log(`${delta.path}: current=${predecessors[delta.path].current.slice(0, 12)} predecessor=${predecessor.slice(0, 12)}`);
}

// --- test file pins -------------------------------------------------------
let testOut = readFileSync(resolve(ROOT, TEST_PATH), 'utf8');
const blocks = [
  { name: 'Layout', file: 'web/src/components/layout/Layout.tsx', pins: ['current', 'predecessor'] },
  { name: 'palette', file: 'web/src/components/ui/CommandPalette.tsx', pins: ['current', 'predecessor', 'derived'] },
  { name: 'theme popover', file: 'web/src/components/layout/ThemeQuickSwitcherPopover.tsx', pins: ['current', 'predecessor'] },
];
// Palette derived pin uses the test's own translator literals; extract them so
// the generator cannot drift from the test.
const actualMatch = testOut.match(/const actual = ("(?:[^"\\]|\\.)*")/);
const originalMatch = testOut.match(/const original = ("(?:[^"\\]|\\.)*")/);
if (!actualMatch || !originalMatch) throw new Error('cannot extract palette translator literals');
const paletteActual = JSON.parse(actualMatch[1]);
const paletteOriginal = JSON.parse(originalMatch[1]);

for (const block of blocks) {
  const marker = `reconstructs the ${block.name === 'palette' ? 'palette' : block.name === 'Layout' ? 'actual Layout' : 'actual theme popover'}`;
  const start = testOut.indexOf(marker);
  if (start < 0) throw new Error(`cannot find ${block.name} block`);
  const end = testOut.indexOf('})', testOut.indexOf('expect(currentSource(file)).toBe(current)', start));
  const segment = testOut.slice(start, end);
  const hexes = [...segment.matchAll(/\.toBe\('([0-9a-f]{64})'\)/g)];
  if (hexes.length !== block.pins.length) {
    throw new Error(`expected ${block.pins.length} pins in ${block.name} block, found ${hexes.length}`);
  }
  let replacement = segment;
  const { current, predecessor } = predecessors[block.file];
  const values = { current, predecessor };
  if (block.name === 'palette') {
    const newText = readFileSync(resolve(ROOT, block.file), 'utf8');
    let canonical = newText;
    for (const { fragment, current } of mappedByPath[block.file]) {
      canonical = canonical.replace(current, fragment.predecessor);
    }
    if (canonical.split(paletteActual).length !== 2 || canonical.includes(paletteOriginal)) {
      throw new Error('palette translator literals no longer behave on canonical text');
    }
    values.derived = sha256(canonical.replace(paletteActual, paletteOriginal));
  }
  for (const [i, pin] of block.pins.entries()) {
    replacement = replacement.replace(hexes[i][1], values[pin]);
  }
  testOut = testOut.slice(0, start) + replacement + testOut.slice(end);
  console.log(`${block.file}: test pins updated (${block.pins.join(', ')})`);
}

// --- sentinel checks --------------------------------------------------------
const sentinels = [
  ['web/src/components/layout/ThemeQuickSwitcherPopover.tsx', 'return { default: module.ThemePicker }'],
  ['web/src/components/layout/Layout.tsx', 'const { preferences: productPreferences } = useProductPreferences()'],
  ['web/src/components/ui/CommandPalette.tsx', 'const [open, setOpen] = useState(initialOpen)'],
];
for (const [file, sentinel] of sentinels) {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  if (text.split(sentinel).length !== 2) {
    throw new Error(`sentinel lost in ${file}: ${sentinel} (human review needed)`);
  }
}
const literalProbes = [
  ["web/src/components/layout/Layout.tsx", "t('a11y.primaryHeader', 'Site header')"],
  ["web/src/components/ui/CommandPalette.tsx", "t('palette.clearScope', 'Clear {{scope}} filter'"],
  ["web/src/components/layout/ThemeQuickSwitcherPopover.tsx", "t('theme.openPicker', 'Open theme picker')"],
];
for (const [file, probe] of literalProbes) {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  if (text.split(probe).length !== 2) {
    throw new Error(`translator probe lost in ${file}: ${probe} (human review needed)`);
  }
}

writeFileSync(resolve(ROOT, MODULE_PATH), moduleOut);
writeFileSync(resolve(ROOT, TEST_PATH), testOut);
console.log('shell preservation re-pinned; run the suite to confirm.');


