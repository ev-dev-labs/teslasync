#!/usr/bin/env node
/**
 * audit-freshness-actions — guards the shared freshness dot and icon-only
 * repeated actions (docs/ui-simplification-plan.md, row 11).
 *
 * Fails when source under src/ (tests excluded):
 *   (a) uses the old freshness indicator: the Wi-Fi / WifiOff icon, rendered
 *       "just now" text, the chip `DataFreshness` / `DataFreshnessAuto`
 *       (anything other than the shared FreshnessDot), `FreshnessIndicator`,
 *       or a last-sync / updated-at badge component;
 *   (b) renders a repeated action (Refresh, More, Customize, View history,
 *       Export, Filter, Settings, Download, …) as an icon plus visible text
 *       instead of the shared icon-only IconButton.
 *
 * Form and flow CTAs (Save, Choose session, Compare drives, Retry …) are not
 * in the vocabulary and stay as text. Menu items inside an overflow menu keep
 * their text: the menu is the place where the label is read.
 *
 *   node scripts/audit-freshness-actions.mjs          # guard (exit 1 on findings)
 *   node scripts/audit-freshness-actions.mjs --report # list every finding with counts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// `--root <dir>` scans a fixture tree (tests); default is this package.
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > -1 ? process.argv[rootArg + 1] : fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const REPORT = process.argv.includes('--report');

// The shared icon-only primitive itself renders an icon with a label prop.
const OWNERS = new Set(['src/components/ui/IconButton.tsx']);
// Documented exceptions: a marker comment on the line or up to 3 lines above.
//   `relative-time: <reason>` — "just now" dates an event (or lives only in a
//     tooltip / accessible name); it is not a freshness indicator.
//   `flow-cta: <reason>` — the action is the primary call to action of its
//     dialog or panel, so it keeps visible text.
const MARKER_LOOKBACK = 3;

// Repeated tool actions that are icon-only app-wide (rule of thumb: on 3+
// pages, or in a header/toolbar next to other tools).
const ACTION_WORDS = [
  'refresh', 'reload', 'more', 'more options', 'more actions', 'customize', 'customise',
  'view history', 'history', 'export', 'download', 'filter', 'filters', 'settings',
  'configure', 'options', 'undo', 'redo', 'auto arrange', 'auto-arrange', 'reset',
  'columns', 'density', 'share', 'print', 'copy', 'copy link', 'expand', 'collapse',
  'expand all', 'collapse all', 'edit', 'delete', 'remove', 'clear',
];
const ACTION_KEY = /(^|\.)(refresh|reload|more|moreOptions|moreActions|customize|customise|viewHistory|history|export|download|filter|filters|settings|configure|options|undo|redo|autoArrange|reset|columns|density|share|print|copy|copyLink|expand|collapse|expandAll|collapseAll|edit|delete|remove|clear)$/i;
// Destructive icon-only actions need a confirmation step (rule 3).
const DESTRUCTIVE_LABEL = /['.](reset|delete|remove|clear)\b|'(Reset|Delete|Remove|Clear)\b|^(Reset|Delete|Remove|Clear)\b/;
const DESTRUCTIVE = /(^|\.|')(reset|delete|remove|clear)(')?$/i;
const ACTION_ELEMENTS = new Set(['Button', 'button', 'Link', 'PrefetchLink', 'NavLink', 'a']);
const MENU_ANCESTORS = /^(DropdownMenu|Menu|MenuItem|DropdownMenuItem|ContextMenu|Popover|CommandPalette)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__' && entry.name !== 'test') walk(path, out);
    } else if (/\.(tsx?)$/.test(entry.name) && !/\.(test|spec|stories)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

const tagName = (node) => (ts.isJsxElement(node) ? node.openingElement.tagName.getText()
  : ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : null);
const attributes = (node) => (ts.isJsxElement(node) ? node.openingElement.attributes
  : ts.isJsxSelfClosingElement(node) ? node.attributes : null);
const attr = (node, name) => attributes(node)?.properties
  .find((p) => ts.isJsxAttribute(p) && p.name.getText() === name);
const attrText = (node, name) => {
  const a = attr(node, name);
  if (!a) return null;
  if (!a.initializer) return 'true';
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  return a.initializer.getText();
};

function isActionLabel(text) {
  const normalized = text.replace(/[…:.]+$/u, '').trim().toLowerCase();
  return ACTION_WORDS.includes(normalized);
}

/** Visible action text directly rendered as a child (not aria-label / title). */
function visibleActionText(node, sf) {
  if (!ts.isJsxElement(node)) return null;
  let found = null;
  const inspect = (child) => {
    if (found) return;
    if (ts.isJsxText(child)) {
      if (isActionLabel(child.text)) found = child.text.trim();
      return;
    }
    if (ts.isJsxExpression(child) && child.expression) {
      const expr = child.expression;
      if (ts.isStringLiteral(expr) && isActionLabel(expr.text)) found = expr.text;
      if (ts.isCallExpression(expr) && expr.expression.getText(sf) === 't') {
        const [key, fallback] = expr.arguments;
        if (key && ts.isStringLiteral(key) && ACTION_KEY.test(key.text)) found = `t('${key.text}')`;
        else if (fallback && ts.isStringLiteral(fallback) && isActionLabel(fallback.text)) found = `t(…'${fallback.text}')`;
      }
      return;
    }
    // Text wrapped in a span/Text label still renders visibly.
    const name = tagName(child);
    if (name && /^(span|Text|strong|em)$/.test(name) && !/sr-only/.test(attrText(child, 'className') ?? '')) {
      for (const grandchild of child.children ?? []) inspect(grandchild);
    }
  };
  for (const child of node.children) inspect(child);
  return found;
}

function hasIcon(node, iconNames) {
  if (attr(node, 'icon')) return true;
  if (!ts.isJsxElement(node)) return false;
  return node.children.some((child) => {
    const name = tagName(child);
    return name != null && (iconNames.has(name) || name === 'Icon' || /Icon$/.test(name));
  });
}

function insideMenu(node) {
  for (let p = node.parent; p; p = p.parent) {
    const name = tagName(p);
    if (name && MENU_ANCESTORS.test(name)) return true;
    if (name && attrText(p, 'role')?.includes('menu')) return true;
  }
  return attrText(node, 'role')?.includes('menuitem') ?? false;
}

const findings = { indicator: [], action: [] };
const menuText = [];
const allowed = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (OWNERS.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const lines = text.split(/\r?\n/);
  const marker = (node, kind) => {
    // `kind:` on the node's line or up to MARKER_LOOKBACK lines above.
    const at = line(node) - 1;
    for (let i = at; i >= Math.max(0, at - MARKER_LOOKBACK); i -= 1) {
      const match = lines[i].match(new RegExp(`${kind}:\\s*(.+?)\\s*(\\*\\/\\}?)?$`));
      if (match) return match[1];
    }
    return null;
  };
  const iconNames = new Set();

  const visit = (node) => {
    // Icon imports (lucide or the shared registry) — remember names, flag Wi-Fi.
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const named = node.importClause?.namedBindings;
      if ((from === 'lucide-react' || from === '@/lib/icons') && named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const imported = (element.propertyName ?? element.name).text;
          iconNames.add(element.name.text);
          if (/^Wifi(Off)?$/.test(imported)) findings.indicator.push(`${rel}:${line(element)}  Wi-Fi icon import ${imported}`);
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(sf) === 'Icons'
      && /^wifi(Off)?$/.test(node.name.text)) {
      findings.indicator.push(`${rel}:${line(node)}  Icons.${node.name.text}`);
    }
    // Rendered "just now" text or a justNow key.
    if (ts.isStringLiteral(node) && (/^just now$/i.test(node.text.trim()) || /(^|\.)justNow$/.test(node.text))) {
      const reason = marker(node, 'relative-time');
      const entry = `${rel}:${line(node)}  "${node.text}"`;
      if (reason) allowed.push(`${entry} — relative-time: ${reason}`);
      else findings.indicator.push(`${entry} (freshness text)`);
    }
    const name = tagName(node);
    if (name) {
      if (name === 'DataFreshness' || name === 'DataFreshnessAuto') {
        findings.indicator.push(`${rel}:${line(node)}  <${name}> chip (old indicator; use FreshnessDot)`);
      }
      if (name === 'FreshnessIndicator' || /^(LastSync|LastSynced|LastUpdated|UpdatedAt)(Badge|Chip|Label|Indicator)?$/.test(name)) {
        findings.indicator.push(`${rel}:${line(node)}  <${name}> (old indicator)`);
      }
      // Guard 3: an icon-only button must keep a non-empty accessible name.
      if (name === 'IconButton' && /^(""|''|\{\s*(''|""|``)\s*\})?$/.test(attrText(node, 'label') ?? '')) {
        findings.action.push(`${rel}:${line(node)}  <IconButton> without an accessible name (empty label)`);
      }
      // Rule 3: a destructive icon-only action confirms first — via the
      // IconButton `confirm` prop, or a documented existing confirmation step.
      if (name === 'IconButton' && DESTRUCTIVE_LABEL.test(attrText(node, 'label') ?? '') && !attr(node, 'confirm')) {
        const reason = marker(node, 'confirm-step') ?? marker(node, 'not-destructive');
        if (reason) allowed.push(`${rel}:${line(node)}  <IconButton> destructive — ${reason}`);
        else findings.action.push(`${rel}:${line(node)}  <IconButton> destructive without a confirmation step`);
      }
      // (c) Repeated icon-only actions are ghost; only Customize may be filled.
      if (name === 'IconButton' && /^(primary|secondary)$/.test(attrText(node, 'variant') ?? '')
        && !/customi[sz]e/i.test(attrText(node, 'label') ?? '')) {
        findings.action.push(`${rel}:${line(node)}  <IconButton variant="${attrText(node, 'variant')}"> (repeated actions are ghost)`);
      }
      if (ACTION_ELEMENTS.has(name) && hasIcon(node, iconNames)) {
        const label = visibleActionText(node, sf);
        if (label) {
          const kind = DESTRUCTIVE.test(label.replace(/^t\(…?'?|'\)$/g, '')) ? 'destructive' : 'icon-only';
          const entry = `${rel}:${line(node)}  <${name}> icon + "${label}" [${kind}]`;
          const reason = marker(node, 'flow-cta');
          if (insideMenu(node)) menuText.push(entry);
          else if (reason) allowed.push(`${entry} — flow-cta: ${reason}`);
          else findings.action.push(entry);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const total = findings.indicator.length + findings.action.length;
if (REPORT) {
  console.log(`(a) old freshness indicator: ${findings.indicator.length}`);
  for (const f of findings.indicator) console.log(`  ${f}`);
  console.log(`(b) text-labelled repeated actions: ${findings.action.length}`);
  for (const f of findings.action) console.log(`  ${f}`);
  console.log(`menu items keeping their text (allowed): ${menuText.length}`);
  for (const f of menuText) console.log(`  ${f}`);
  console.log(`documented exceptions (allowed): ${allowed.length}`);
  for (const f of allowed) console.log(`  ${f}`);
}
if (total > 0) {
  if (!REPORT) {
    console.error(`audit:freshness-actions — ${total} finding(s). Use FreshnessDot for freshness and the shared IconButton (icon-only, label in the tooltip) for repeated actions.`);
    for (const f of [...findings.indicator, ...findings.action]) console.error(`  ${f}`);
  }
  process.exit(1);
}
console.log('OK — no old freshness indicator and no text-labelled repeated actions');
