#!/usr/bin/env node
/**
 * Touch-target audit (WCAG 2.5.8).
 *
 * WCAG 2.5.8 (Target Size Minimum, AA) calls for ≥ 24 × 24 CSS-px hit
 * areas or sufficient spacing; Apple HIG recommends 44 px and Material
 * 48 px. This script blocks regressions where a clickable
 * element clearly collapses to icon size (16 × 16) without padding
 * or where the element itself is sized below 32 px tall on the visual
 * dimension.
 *
 * Detection algorithm — for every JSX element matching
 * `<Button|<button|<a|<IconButton` followed by `\s|/|>`:
 *
 * 1. Extract the opening tag (bracket-aware so JSX expression children
 * like `<Btn props={{…}}>` don't confuse the tag boundary).
 * 2. Skip the element when it lacks any "interactive" prop —
 * `onClick`, `onPress`, `onPointerDown`, `formAction`, `href=`,
 * `to=`, or `type="submit"`. Decorative buttons and presentational
 * anchors aren't touch targets.
 * 3. Skip the element when the file/name pair appears in
 * `web/src/lib/touchTargetAllowlist.ts`.
 * 4. PASS when the opening tag's text contains a known SAFE class —
 * `min-h-11|12|14|16|20|24`, `h-11|12|14|16|20|24|d-row`,
 * arbitrary-value variants like `h-[44px]`/`min-h-[44px]`,
 * `p-3|4|5|6|7|8|10|12`, `py-…`, `px-…`, `size-11|12|14|16|20|24`,
 * or the new `touch-target` utility — OR a Button `size="lg|md|auto"`
 * prop. (`md` is the Button default and resolves to `h-10` = 40 px,
 * which exceeds the WCAG 2.5.8 AA 24 × 24 floor.)
 * 5. PASS for `<Button>` with NO `size=` prop at all (default `md`).
 * 6. FAIL when the opening tag has an explicitly tiny dimension
 * (`h-3|4|5|6|7|8|w-3|4|5|6|7|8|min-h-…|min-w-…|size-…`) on the
 * element itself with no SAFE class to compensate.
 * 7. FAIL when the element wraps a single icon-only child (a self-
 * closing JSX tag whose className contains `h-3|4|5|6` or
 * `w-3|4|5|6`, the typical `<Icon h-4 w-4 />` shape) AND the
 * opening tag has padding strictly below `p-2` (i.e. no padding,
 * `p-0`, `p-0.5`, `p-1`, `p-1.5`, or only horizontal/vertical
 * padding below `2`). 16 + 4 + 4 = 24 px is the AA floor.
 * 8. PASS otherwise.
 *
 * Why a regex/heuristic walker rather than a JSX parser:
 * • The audit needs to run as a fast, dependency-free `node` script in
 * pre-commit / CI. Bringing in `@babel/parser` for one audit doubles
 * cold-start cost and adds yet another transitive dependency to
 * track for CVE alerts.
 * • The patterns we care about (`<button onClick><X h-4 w-4/></button>`
 * versus `<button className="h-11 w-11" onClick><X/></button>`) are
 * cleanly captured by bracket-aware text scanning.
 * • False positives can be silenced via the explicit allowlist.
 *
 * Exit 0 on success, 1 with per-file FAIL lines (file:line) on regression.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, '..');
const SRC_ROOT = resolve(WEB_ROOT, 'src');

// ────────────────────────────────────────────────────────────────────────────
// Regex toolkit
// ────────────────────────────────────────────────────────────────────────────

// Matches the start of a clickable JSX element tag. The lookahead
// `(?=[\s/>])` prevents `<Avatar`, `<address`, `<aside`, `<area`,
// `<ButtonBar`, `<bodyEl` from accidentally matching (those have a
// non-`\s/>` character immediately after the captured name).
const ELEMENT_OPEN_RE = /<(Button|IconButton|button|a)(?=[\s/>])/g;

// "Interactive" props — at least one of these must appear in the opening
// tag for the element to count as a touch target. Word boundaries
// guard against `formActionable`, `tooltips`, etc.
const INTERACTIVE_PROPS_RE =
  /(?:^|[\s{])(onClick|onPress|onPointerDown|formAction)\s*=|(?:^|[\s{])type\s*=\s*["']submit["']|(?:^|[\s{])href\s*=|(?:^|[\s{])to\s*=/;

// SAFE CLASS PATTERNS ────────────────────────────────────────────────────
// Tailwind utilities that prove the element meets at least the WCAG 2.5.8
// AA minimum (24 × 24 CSS px) on the relevant dimension. Apple HIG (44)
// and AAA recommend more, but our floor is the AA contract. We
// additionally accept density-aware row tokens (`h-d-row`,
// `min-h-d-row`) since `--density-row-h` is set to a value ≥ 36 px in
// every density preset.
const SAFE_CLASS_PATTERNS = [
  // Standard Tailwind utility classes ≥ h-6 (24 px). h-13 isn't a
  // Tailwind default so we list the discrete sizes explicitly.
  /\b(min-h|h)-([6-9]|10|11|12|14|16|20|24|32|40|48|56|64|72|80|96|d-row)\b/,
  /\b(min-w|w)-([6-9]|10|11|12|14|16|20|24|32|40|48|56|64|72|80|96)\b/,
  /\bsize-([6-9]|10|11|12|14|16|20|24|32)\b/,
  // Arbitrary-value escape hatches like `min-w-[44px]` / `h-[28px]`.
  /\b(min-h|h|min-w|w)-\[(2[4-9]|[3-9]\d|1\d\d|200)px\]/,
  // Padding utilities. `p-1.5` = 6 px on each side ⇒ on a 16-px icon
  // 6 + 16 + 6 = 28 px (clears AA). `p-2` (8 px) ⇒ 32 px. `p-3`+ gives
  // ≥ 40 px (clears AAA).
  /\b(p|px|py)-(1\.5|[2-9]|1[0-9]|2[0-4]|d-pad-[xy])\b/,
  // Density-aware padding tokens.
  /\b(p|px|py)-d-pad-[xy]\b/,
  // The `touch-target` utilities we add here:
  // • `touch-target` — direct min-h/min-w 44 px (good for
  // elements that can grow).
  // • `touch-target-overlay` — invisible::before hit-extender for
  // elements that must stay visually small
  // (timeline markers, chip-X glyphs).
  /\btouch-target(-overlay)?\b/,
];

// Button/IconButton size props that are known-safe. `md` = h-10 (40 px),
// `lg` = h-12 (48 px), `auto` = density-aware row (≥ 36 px).
const SAFE_BUTTON_SIZE_RE =
  /\bsize\s*=\s*\{?\s*["'`](lg|md|auto)["'`]\s*\}?/;

// Any `size=` prop on a Button (used to distinguish "Button with no size
// prop ⇒ default md" from "Button with explicit size prop").
const HAS_BUTTON_SIZE_RE = /\bsize\s*=\s*\{?\s*["'`](\w+)["'`]\s*\}?/;

// Element wears an explicitly tiny dimension on itself (e.g.
// `<button className="h-5 w-5">` or `h-2.5 w-2.5`). Combined with no
// SAFE class this is an unambiguous fail. Threshold: classes resolving
// to < 24 px on the default 16 px font (h-1 = 4 px, h-2 = 8 px,
// h-2.5 = 10 px, h-3 = 12 px, h-3.5 = 14 px, h-4 = 16 px, h-4.5 = 18 px,
// h-5 = 20 px). h-6 maps to exactly 24 px so it just clears WCAG 2.5.8
// AA. The optional `\.5` allows the half-step variants Tailwind ships;
// the trailing lookahead `(?![\d.])` prevents `h-5` matching the `5`
// suffix of e.g. `h-55`.
const TINY_SIZE_ON_SELF_RE =
  /\b(h|w|min-h|min-w|size)-([1-5](?:\.5)?)(?![\d.])/;

// Padding ≥ p-1.5 (6 px) — the floor for "icon-only inside is OK"
// against a 16-px icon: 6 + 16 + 6 = 28 px which clears WCAG 2.5.8 AA.
// Smaller paddings (`p-1`, `p-0.5`, `p-0`) collapse to ≤ 24 × 24 on a
// 16-px icon and are flagged as failures.
const PADDING_OK_RE =
  /\b(p|px|py)-(1\.5|[2-9]|1[0-9]|2[0-4]|d-pad-[xy])\b/;

// Looks for an icon-only child: a single self-closing JSX element where
// the className includes a sub-24 `h-…|w-…` size token (the typical
// lucide `<X className="h-4 w-4" />` shape, or `h-3.5`, `h-2.5`).
const ICON_ONLY_CHILD_RE =
  /^<[A-Za-z][\w.]*\b[^<>]*\bclassName\s*=\s*["'`][^"'`]*\b(h|w|min-h|min-w|size)-([1-5](?:\.5)?)(?![\d.])[^"'`]*["'`][^<>]*\/>$/;

// ────────────────────────────────────────────────────────────────────────────
// File walker
// ────────────────────────────────────────────────────────────────────────────

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '__tests__',
  'storybook',
  '.storybook',
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      walk(full, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!/\.tsx$/.test(name)) continue;
    if (/\.(test|stories)\.tsx$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// JSX scanning
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walk forward from `startIdx` in `source` to the matching `>` or `/>`
 * that closes the JSX opening tag. Honours nested braces (JSX
 * expressions like `props={{ a: 1 }}`) and quoted strings so e.g. an
 * embedded `>` inside a string attribute doesn't terminate the scan
 * prematurely.
 *
 * Returns `{ end, selfClosing }` where `end` is the index AFTER the
 * closing `>`/`/>` and `selfClosing` is true if the tag ends with `/>`.
 * Returns `null` on malformed input.
 */
function findOpenTagEnd(source, startIdx) {
  let i = startIdx;
  let inString = false;
  let stringQuote = '';
  let braceDepth = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? '';
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === stringQuote) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringQuote = ch;
      i += 1;
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (braceDepth > 0) braceDepth -= 1;
      i += 1;
      continue;
    }
    if (braceDepth > 0) {
      i += 1;
      continue;
    }
    if (ch === '/' && next === '>') return { end: i + 2, selfClosing: true };
    if (ch === '>') return { end: i + 1, selfClosing: false };
    i += 1;
  }
  return null;
}

/**
 * Find the matching `</elementName>` for an opening tag whose body
 * starts at `bodyStart`. Tracks nesting of same-name tags so e.g. a
 * nested `<button>` inside a `<button>` (rare but possible in JSX-as-
 * data tests) doesn't terminate the outer scan early.
 *
 * Returns the index just BEFORE the matching close tag, or `null` when
 * no close tag is found within the file.
 */
function findCloseTag(source, elementName, bodyStart) {
  const openRe = new RegExp(`<${elementName}(?=[\\s/>])`, 'g');
  const closeRe = new RegExp(`</${elementName}\\s*>`, 'g');
  openRe.lastIndex = bodyStart;
  closeRe.lastIndex = bodyStart;
  let depth = 1;
  while (depth > 0) {
    const o = openRe.exec(source);
    const c = closeRe.exec(source);
    if (!c) return null;
    if (o && o.index < c.index) {
      depth += 1;
      // Skip past the opening tag we just discovered so the next
      // `closeRe.exec` starts after it (otherwise the nested close
      // would match the wrong open).
      const innerEnd = findOpenTagEnd(source, o.index + o[0].length);
      const next = innerEnd?.end ?? o.index + o[0].length;
      openRe.lastIndex = next;
      closeRe.lastIndex = next;
      continue;
    }
    depth -= 1;
    if (depth === 0) return c.index;
    openRe.lastIndex = c.index + c[0].length;
    closeRe.lastIndex = c.index + c[0].length;
  }
  return null;
}

function lineNumberFor(source, idx) {
  // Count newlines BEFORE idx then add 1 (line numbers are 1-based).
  let n = 1;
  for (let i = 0; i < idx; i += 1) if (source[i] === '\n') n += 1;
  return n;
}

function hasAnyPattern(text, patterns) {
  for (const re of patterns) if (re.test(text)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Allowlist
// ────────────────────────────────────────────────────────────────────────────

function readAllowlist() {
  const file = resolve(SRC_ROOT, 'lib', 'touchTargetAllowlist.ts');
  if (!existsSync(file)) return [];
  const src = readFileSync(file, 'utf8');
  // Tolerate any field order; just extract the three required keys.
  const entries = [];
  const objRe = /\{([^{}]*)\}/g;
  let m;
  while ((m = objRe.exec(src)) !== null) {
    const body = m[1];
    const fileM = /\bfile\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);
    const elemM = /\belement\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);
    const reasonM = /\breason\s*:\s*['"`]([^'"`]*)['"`]/.exec(body);
    if (fileM && elemM && reasonM) {
      entries.push({ file: fileM[1], element: elemM[1], reason: reasonM[1] });
    }
  }
  return entries;
}

function isAllowlisted(allowlist, relPath, elementName) {
  return allowlist.some((a) => {
    const norm = relPath.replace(/\\/g, '/');
    const fileMatch = norm === a.file || norm.endsWith('/' + a.file) || norm.endsWith(a.file);
    const elementMatch = a.element === '*' || a.element === elementName;
    return fileMatch && elementMatch;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Per-element classification
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mask the contents of every JSX expression `{…}` in `openTag` with
 * spaces (preserving newlines so line numbers stay stable). The braces
 * themselves are kept so callers can still see `className={` and detect
 * its presence, but values like `<Btn icon={<X className="h-4 w-4"/>}>`
 * become `<Btn icon={                          }>` so attribute scans
 * don't pick up class tokens that belong to a child JSX element.
 */
function maskJsxExpressions(openTag) {
  let out = '';
  let i = 0;
  let depth = 0;
  let inStr = false;
  let q = '';
  while (i < openTag.length) {
    const c = openTag[i];
    if (depth === 0) {
      if (inStr) {
        out += c;
        if (c === '\\' && i + 1 < openTag.length) {
          out += openTag[i + 1];
          i += 2;
          continue;
        }
        if (c === q) inStr = false;
        i += 1;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        q = c;
        out += c;
        i += 1;
        continue;
      }
      if (c === '{') {
        depth = 1;
        out += '{';
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    // depth > 0 — inside a JSX expression. Skip over string literals
    // wholesale (replacing each character with whitespace) so a string
    // inside the expression doesn't get its `{` counted.
    if (c === '"' || c === "'" || c === '`') {
      const term = c;
      let j = i + 1;
      while (j < openTag.length) {
        if (openTag[j] === '\\') {
          j += 2;
          continue;
        }
        if (openTag[j] === term) {
          j += 1;
          break;
        }
        j += 1;
      }
      for (let k = i; k < j; k += 1) {
        out += openTag[k] === '\n' ? '\n' : ' ';
      }
      i = j;
      continue;
    }
    if (c === '{') {
      depth += 1;
      out += '{';
      i += 1;
      continue;
    }
    if (c === '}') {
      depth -= 1;
      out += '}';
      i += 1;
      continue;
    }
    out += c === '\n' ? '\n' : ' ';
    i += 1;
  }
  return out;
}

/**
 * Compute JSX-expression `{` depth at character index `idx` in
 * `openTag`. Tracks string-literal state so a `}` inside a quoted
 * attribute value doesn't decrement the depth count. Used by
 * `extractClassNameTokens` to skip `className=` occurrences that are
 * nested inside another JSX expression (e.g. an `icon={…}` prop).
 */
function depthAt(openTag, idx) {
  let depth = 0;
  let inStr = false;
  let q = '';
  for (let i = 0; i < idx; i += 1) {
    const c = openTag[i];
    if (inStr) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = true;
      q = c;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
  }
  return depth;
}

/**
 * Pull out every class token that ends up applied to the element via
 * `className=`. Only top-level `className=` props are considered —
 * nested occurrences inside `icon={…}` or `props={{…}}` are skipped via
 * `depthAt(…) !== 0`. Handles three forms:
 *  • `className="literal"`           — quoted string attribute.
 *  • `className={`template ${x}`}`   — template literal expression.
 *  • `className={cn('a', 'b', x)}`   — JSX expression with embedded
 *                                       string literals.
 * Static literals are returned verbatim; dynamic JS bits are skipped
 * silently. Returns the joined class-token string.
 */
function extractClassNameTokens(openTag) {
  const tokens = [];
  const re = /\bclassName\s*=\s*/g;
  let m;
  while ((m = re.exec(openTag)) !== null) {
    if (depthAt(openTag, m.index) !== 0) continue;
    const start = m.index + m[0].length;
    if (start >= openTag.length) continue;
    const ch0 = openTag[start];
    if (ch0 === '"' || ch0 === "'") {
      const end = openTag.indexOf(ch0, start + 1);
      if (end < 0) continue;
      tokens.push(openTag.slice(start + 1, end));
      re.lastIndex = end + 1;
      continue;
    }
    if (ch0 !== '{') continue;
    let i = start + 1;
    let depth = 1;
    let inStr = false;
    let q = '';
    while (i < openTag.length && depth > 0) {
      const c = openTag[i];
      if (inStr) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === q) inStr = false;
        i += 1;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inStr = true;
        q = c;
        i += 1;
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      i += 1;
    }
    const expr = openTag.slice(start + 1, i - 1);
    const strRe = /['"`]([^'"`\\]*)['"`]/g;
    let sm;
    while ((sm = strRe.exec(expr)) !== null) tokens.push(sm[1]);
    re.lastIndex = i;
  }
  return tokens.join(' ');
}

/**
 * Classify a single clickable element. Returns one of:
 *  • `{ status: 'skip',   reason }`  — not interactive / allowlisted / etc.
 *  • `{ status: 'pass'             }` — meets the touch-target floor.
 *  • `{ status: 'fail',   detail }` — below the floor; must be fixed.
 *
 * Classification uses two views of the opening tag:
 *  • `maskedTag`  — top-level attributes only; values inside `{…}` JSX
 *    expressions are blanked. Used to detect `onClick=`, `href=`,
 *    `size="lg"` etc. without false-matching attributes nested inside
 *    `icon={…}` or `props={{ … }}` props.
 *  • `classTokens` — concatenation of every static string applied to
 *    the element via `className=`. Used to detect SAFE / TINY / padding
 *    classes without picking up classes that belong to children passed
 *    via other props.
 */
function classifyElement({ openTag, elementName, innerContent, allowlisted }) {
  if (allowlisted) return { status: 'skip', reason: 'allowlisted' };
  const maskedTag = maskJsxExpressions(openTag);
  if (!INTERACTIVE_PROPS_RE.test(maskedTag)) {
    return { status: 'skip', reason: 'no interactive prop' };
  }

  const classTokens = extractClassNameTokens(openTag);

  if (hasAnyPattern(classTokens, SAFE_CLASS_PATTERNS) || SAFE_BUTTON_SIZE_RE.test(maskedTag)) {
    return { status: 'pass' };
  }

  // <Button>/<IconButton> with no explicit size= prop → default `md`
  // (h-10 = 40 px). That clears WCAG 2.5.8 AA on its own.
  if (
    (elementName === 'Button' || elementName === 'IconButton') &&
    !HAS_BUTTON_SIZE_RE.test(maskedTag)
  ) {
    return { status: 'pass' };
  }

  if (TINY_SIZE_ON_SELF_RE.test(classTokens)) {
    return {
      status: 'fail',
      detail:
        'tiny size class on element itself (e.g. h-5/w-5) without a safe class',
    };
  }

  // Inner-content check — only meaningful for raw `<button>` / `<a>` with
  // self-closing icon child. We deliberately skip this for `<Button>` /
  // `<IconButton>` because shared components paint their own padding.
  if (elementName === 'button' || elementName === 'a') {
    if (innerContent != null) {
      const trimmed = innerContent.trim();
      if (ICON_ONLY_CHILD_RE.test(trimmed) && !PADDING_OK_RE.test(classTokens)) {
        return {
          status: 'fail',
          detail:
            'icon-only child (<Icon h-4 w-4 />) without padding ≥ p-2 — touch target collapses to icon size',
        };
      }
    }
  }

  return { status: 'pass' };
}

// ────────────────────────────────────────────────────────────────────────────
// Main scan
// ────────────────────────────────────────────────────────────────────────────

function scanFile(absPath, allowlist) {
  let src;
  try {
    src = readFileSync(absPath, 'utf8');
  } catch {
    return { failures: [], scanned: 0 };
  }
  // Strip block comments so a `/* <button onClick>...</button> */` doc
  // example doesn't false-positive. We replace with same-length spaces
  // so line numbers stay stable.
  const cleaned = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

  const rel = relative(WEB_ROOT, absPath).replace(/\\/g, '/');
  const failures = [];
  let scanned = 0;
  let m;
  ELEMENT_OPEN_RE.lastIndex = 0;
  while ((m = ELEMENT_OPEN_RE.exec(cleaned)) !== null) {
    const elementName = m[1];
    const tagStart = m.index;
    const openEnd = findOpenTagEnd(cleaned, tagStart + m[0].length);
    if (!openEnd) continue;
    const openTag = cleaned.slice(tagStart, openEnd.end);
    let innerContent = null;
    if (!openEnd.selfClosing) {
      const closeIdx = findCloseTag(cleaned, elementName, openEnd.end);
      if (closeIdx != null) innerContent = cleaned.slice(openEnd.end, closeIdx);
    }
    scanned += 1;
    const result = classifyElement({
      openTag,
      elementName,
      innerContent,
      allowlisted: isAllowlisted(allowlist, rel, elementName),
    });
    if (result.status === 'fail') {
      const line = lineNumberFor(cleaned, tagStart);
      failures.push({ file: rel, line, elementName, detail: result.detail });
    }
    // Advance past the opening tag so we don't re-match the same `<Button…`.
    ELEMENT_OPEN_RE.lastIndex = openEnd.end;
  }
  return { failures, scanned };
}

function runAudit({ scanRoot = SRC_ROOT, allowlist = readAllowlist() } = {}) {
  const files = walk(scanRoot);
  const allFailures = [];
  let totalElements = 0;
  for (const file of files) {
    const { failures, scanned } = scanFile(file, allowlist);
    totalElements += scanned;
    allFailures.push(...failures);
  }
  return { failures: allFailures, files: files.length, elements: totalElements, allowlist };
}

// ────────────────────────────────────────────────────────────────────────────
// Test seam — `--self-test` runs a smoke test on a synthetic source string
// rather than scanning the real `src/` tree. Used by the audit-script
// tests to keep them hermetic.
// ────────────────────────────────────────────────────────────────────────────

export function _classifyForTest(opts) {
  return classifyElement(opts);
}

export function _scanSourceForTest(source, { rel = 'synthetic.tsx', allowlist = [] } = {}) {
  const failures = [];
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  let m;
  const re = new RegExp(ELEMENT_OPEN_RE.source, 'g');
  while ((m = re.exec(cleaned)) !== null) {
    const elementName = m[1];
    const tagStart = m.index;
    const openEnd = findOpenTagEnd(cleaned, tagStart + m[0].length);
    if (!openEnd) continue;
    const openTag = cleaned.slice(tagStart, openEnd.end);
    let innerContent = null;
    if (!openEnd.selfClosing) {
      const closeIdx = findCloseTag(cleaned, elementName, openEnd.end);
      if (closeIdx != null) innerContent = cleaned.slice(openEnd.end, closeIdx);
    }
    const result = classifyElement({
      openTag,
      elementName,
      innerContent,
      allowlisted: isAllowlisted(allowlist, rel, elementName),
    });
    if (result.status === 'fail') {
      const line = lineNumberFor(cleaned, tagStart);
      failures.push({ file: rel, line, elementName, detail: result.detail });
    }
    re.lastIndex = openEnd.end;
  }
  return failures;
}

// ────────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────────

const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule) {
  const { failures, files, elements, allowlist } = runAudit();
  console.log(
    `[audit:touch-target] scanned ${files} file(s) / ${elements} clickable element(s); ` +
      `allowlist=${allowlist.length}; failures=${failures.length}`,
  );
  if (failures.length === 0) {
    console.log('[audit:touch-target] OK — every clickable element meets the WCAG 2.5.8 floor.');
    process.exit(0);
  }
  console.error('');
  console.error('[audit:touch-target] FAIL — the following clickable elements are below the WCAG 2.5.8 24×24 floor:');
  for (const f of failures) {
    console.error(`  ✗ ${f.file}:${f.line} <${f.elementName}> — ${f.detail}`);
  }
  console.error('');
  console.error('  Fix by adding one of these to the element\'s className:');
  console.error('    • `min-h-11 min-w-11` (44 × 44 — Apple HIG / AAA)');
  console.error('    • `h-12 w-12`         (48 × 48 — Material)');
  console.error('    • `p-3` or `p-4`      (12-16 px padding around an icon)');
  console.error('    • `touch-target`      (the shared 44 × 44 utility)');
  console.error('  Or, for shared `<Button>`, set `size="lg"`. As a last');
  console.error('  resort add an entry to web/src/lib/touchTargetAllowlist.ts');
  console.error('  with a non-empty `reason` justifying the waiver.');
  process.exit(1);
}
