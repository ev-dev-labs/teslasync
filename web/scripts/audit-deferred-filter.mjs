#!/usr/bin/env node
// useDeferredFilter adoption audit.
//
// Locks in the rule that the configured "heavy filter" pages either:
//
// 1. Adopt the deferred-filter pattern — the file imports
// `useDeferredFilter` from '@/hooks/useDeferredFilter' OR uses
// React's `useDeferredValue` primitive directly. AND, when the
// page renders a per-row component in a list, that row component
// is wrapped in `memo(...)` so it skips re-render when the
// deferred value catches up.
//
// 2. OR carry a `// deferred-filter:no <reason>` justification
// comment within the file. This is the documented escape hatch
// for pages where the filter is server-driven (URL param ⇒ refetch)
// and a client-side deferred value would be redundant.
//
// Why this exists
// ---------------
// Heavy list pages (drives, command history, signal log) re-render
// hundreds of rows + chart/stat panels on every keystroke. Without
// `useDeferredValue`, the input field lags by 80–200ms on a mid-tier
// laptop because the keystroke render is forced to wait for the
// downstream filter compute. The fix is small and local; this audit
// keeps it from regressing and forces new heavy-list pages to make
// a conscious choice between adopting the pattern or documenting why
// it doesn't apply.
//
// Run via `npm run audit:deferred-filter` (chained from `npm run lint`).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = 'src';

// Each TARGET is a path (relative to web/) and an optional row component
// name. When `rowComponent` is set, the audit also requires that name
// to be wrapped in `memo(` — otherwise the row will still re-render on
// every filter keystroke even though the filter compute is deferred.
//
// `rowComponentPath` says WHERE that memo() wrapper lives. Row components
// are routinely extracted out of the page into their own file (one exported
// component per file, per the repo's monolith rule), and the memo() wrapper
// travels with them. Without this the audit greps the page file, finds no
// `memo(`, and reports a false positive against a component that is in fact
// correctly memoised. Defaults to the page itself for inline row components.
//
// Server-driven targets are still listed: they must carry the
// `deferred-filter:no` justification or the audit fails. That keeps
// reviewers from silently dropping the comment in a refactor.
const TARGETS = [
  {
    path: join(ROOT, 'features', 'driving', 'pages', 'DrivesListPage.tsx'),
    rowComponent: 'DriveCard',
    rowComponentPath: join(ROOT, 'features', 'driving', 'components', 'DriveCard.tsx'),
  },
  {
    path: join(ROOT, 'features', 'system', 'pages', 'CommandHistoryPage.tsx'),
    // Renders a `Timeline items={...}` aggregate, not per-row JSX —
    // memo() check is not applicable.
    rowComponent: null,
  },
  {
    path: join(ROOT, 'features', 'telemetry', 'pages', 'SignalLogViewerPage.tsx'),
    rowComponent: null,
  },
];

const JUSTIFICATION = 'deferred-filter:no';

// Match `import {..., useDeferredFilter,... } from '...useDeferredFilter...'`
const RE_USE_DEFERRED_FILTER_IMPORT =
  /from\s+['"][^'"]*useDeferredFilter['"]/;

// Match `useDeferredValue` as an imported identifier OR as a call —
// covers both `import {useDeferredValue } from 'react'` and direct
// usage in the file body (e.g. `const x = useDeferredValue(y)`).
const RE_USE_DEFERRED_VALUE = /\buseDeferredValue\b/;

const offenders = [];

function locOfMatch(text, pattern) {
  const m = pattern.exec(text);
  if (!m) return null;
  const idx = m.index;
  const before = text.slice(0, idx);
  const line = before.split('\n').length;
  return line;
}

function memoCallNamesIn(text) {
  // Captures the identifier passed as the first argument to `memo(`.
  // Handles:
  // const X = memo(function X() {... })
  // const X = memo((props) =>...) ← anonymous, not captured
  // const X = memo(XInner) ← captures `X` via lhs
  // const X = memo(XInner, areEqual)
  // export const X = memo(...)
  // Captures the LHS const-name first; falls back to the function name
  // inside `memo(function NAME(...) {... })`.
  const found = new Set();

  const lhsRe =
    /(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:React\.)?memo\b/g;
  let m;
  while ((m = lhsRe.exec(text)) !== null) {
    found.add(m[1]);
  }

  // `memo(function NAME(...) {... })` — captures the function name.
  const fnRe = /(?:React\.)?memo\(\s*function\s+([A-Z][A-Za-z0-9_$]*)/g;
  while ((m = fnRe.exec(text)) !== null) {
    found.add(m[1]);
  }

  return found;
}

function auditFile(target) {
  const { path, rowComponent } = target;

  if (!existsSync(path)) {
    offenders.push({
      where: path,
      why: `Target file does not exist. Update web/scripts/audit-deferred-filter.mjs to remove or re-point this entry.`,
    });
    return;
  }

  const text = readFileSync(path, 'utf8');

  // Server-driven escape hatch.
  if (text.includes(JUSTIFICATION)) {
    return;
  }

  // Otherwise, the file MUST adopt the deferred-filter pattern.
  const importsHelper = RE_USE_DEFERRED_FILTER_IMPORT.test(text);
  const usesDeferredValue = RE_USE_DEFERRED_VALUE.test(text);

  if (!importsHelper && !usesDeferredValue) {
    offenders.push({
      where: path,
      why:
        `Heavy filter page must either import \`useDeferredFilter\` ` +
        `from '@/hooks/useDeferredFilter', use React's \`useDeferredValue\` ` +
        `directly, or carry a \`// ${JUSTIFICATION} <reason>\` justification ` +
        `comment.`,
    });
    return;
  }

  // Row-component memo() check — only when the target declares one.
  if (rowComponent) {
    // Resolve where the component is actually defined. An extracted row
    // component keeps its memo() wrapper in its own file, not in the page.
    const declPath = target.rowComponentPath ?? path;
    if (!existsSync(declPath)) {
      offenders.push({
        where: declPath,
        why:
          `Declared \`rowComponentPath\` for \`${rowComponent}\` does not ` +
          `exist. Update web/scripts/audit-deferred-filter.mjs to re-point ` +
          `this entry at the file that defines and memoises the row.`,
      });
      return;
    }

    const declText = declPath === path ? text : readFileSync(declPath, 'utf8');

    // Accept either form:
    //   export const DriveCard = memo(DriveCardImpl, areEqual)   ← extracted
    //   const DriveCard = memo(function DriveCard() {...})        ← inline
    // The first wraps a differently-named impl, so a plain
    // `memo(DriveCard` substring search misses it.
    const exportedMemo = new RegExp(
      `(?:export\\s+)?const\\s+${rowComponent}\\s*(?::[^=]+)?=\\s*memo\\s*\\(`,
    ).test(declText);
    const memoNames = memoCallNamesIn(declText);

    if (!exportedMemo && !memoNames.has(rowComponent)) {
      const declLine = locOfMatch(
        declText,
        new RegExp(`function\\s+${rowComponent}\\b|const\\s+${rowComponent}\\b`),
      );
      offenders.push({
        where: declLine ? `${declPath}:${declLine}` : declPath,
        why:
          `Row component \`${rowComponent}\` must be wrapped in ` +
          `\`memo(${rowComponent}, areEqual?)\` so unchanged rows skip ` +
          `re-render when the deferred filter value commits. Without ` +
          `memo() React still diffs every row on every keystroke and ` +
          `useDeferredValue alone is insufficient.`,
      });
    }
  }
}

for (const target of TARGETS) {
  auditFile(target);
}

if (offenders.length > 0) {
  console.error(
    `\nuseDeferredFilter adoption audit failed (${offenders.length} issue(s)):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`);
  }
  console.error(
    '\nFix by either:\n' +
      '\n' +
      '  1. Adopting the deferred-filter pattern:\n' +
      '\n' +
      '     import { useDeferredFilter } from \'@/hooks/useDeferredFilter\';\n' +
      '     // ...\n' +
      '     const filter = useDeferredFilter(\'\');\n' +
      '     const filtered = useMemo(\n' +
      '       () => rows.filter((r) => match(r, filter.deferred)),\n' +
      '       [rows, filter.deferred],\n' +
      '     );\n' +
      '\n' +
      '     // For URL-persisted filters, useDeferredValue alone is fine:\n' +
      '     const [search] = useUrlString(\'q\', \'\');\n' +
      '     const deferredSearch = useDeferredValue(search);\n' +
      '\n' +
      '     // And memoize the row component:\n' +
      '     const Row = memo(function Row({ ... }) { ... }, areRowEqual);\n' +
      '\n' +
      '  2. Or, when the page filters server-side (URL ⇒ fetch), document\n' +
      '     why the deferred-value pattern does not apply:\n' +
      '\n' +
      `     // ${JUSTIFICATION} server-driven — filters are forwarded to\n` +
      '     // the API and a fresh fetch returns the matching rows.\n',
  );
  process.exit(1);
}

console.log(
  `OK — ${TARGETS.length} configured heavy-filter page(s) either adopt ` +
    `useDeferredFilter / useDeferredValue (with memo() on the row component) ` +
    `or carry a \`${JUSTIFICATION}\` justification.`,
);
