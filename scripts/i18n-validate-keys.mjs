#!/usr/bin/env node
/**
 * i18n-validate-keys.mjs
 *
 * Cross-references every t('key', ...) call in web/src/ against the keys
 * defined in web/src/i18n/en.json. Reports:
 *
 *   - Missing keys: used in code but not present in en.json (will fall back to
 *     the second argument in production, but should be added so translators
 *     have a clear contract).
 *   - Unused keys: defined in en.json but never referenced (dead translations).
 *
 * Exit codes:
 *   0  no missing keys (or non-strict mode)
 *   1  one or more missing keys (CI-failing in --strict mode)
 *
 * Usage:
 *   node scripts/i18n-validate-keys.mjs                 # default (warn only)
 *   node scripts/i18n-validate-keys.mjs --strict        # exit 1 on missing
 *   node scripts/i18n-validate-keys.mjs --report=json   # emit JSON summary
 *   node scripts/i18n-validate-keys.mjs --extract       # ADD missing keys
 *                                                       # to en.json using
 *                                                       # the fallback string
 *                                                       # from each t() call
 *
 * Uses the frontend's installed TypeScript parser, as the catalog source
 * graph does, without running compiler diagnostics. JSON reports include
 * every missing reference and its fallback; dynamic keys remain unaudited.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EN_PATH = path.join(REPO_ROOT, 'web', 'src', 'i18n', 'en.json');
const SRC_ROOT = path.join(REPO_ROOT, 'web', 'src');
const require = createRequire(path.join(REPO_ROOT, 'web', 'package.json'));
const ts = require('typescript');

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const EXTRACT = args.has('--extract');
const JSON_OUT = [...args].find((a) => a.startsWith('--report=json'));

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) return flatten(v, key);
    return [key];
  });
}

export function isProductionSource(file) {
  const normalized = file.replace(/\\/g, '/');
  return /\.(tsx?|jsx?|mjs)$/.test(normalized)
    && !/(?:^|\/)(?:__tests__|__mocks__|__fixtures__|tests?|fixtures)(?:\/|$)/.test(normalized)
    && !/\.(?:test|spec|stories|story)\.[^.]+$/.test(normalized)
    && !/(?:^|\/)test-setup\.[^.]+$/.test(normalized)
    && !/\.d\.ts$/.test(normalized);
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (isProductionSource(full)) {
      acc.push(full);
    }
  }
  return acc;
}

function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text : null;
}

function property(node, name) {
  return node && ts.isObjectLiteralExpression(node)
    ? node.properties.find((p) => p.name?.text === name) : undefined;
}

// Symbol binding distinguishes a shadowing local t from the hook's t. The
// isolated host never resolves dependencies or runs semantic diagnostics.
export function scanTranslationCalls(text, file = 'fixture.tsx') {
  file = file.replace(/\\/g, '/');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const host = {
    getSourceFile: (name) => name === file ? source : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {},
    getCurrentDirectory: () => '', getDirectories: () => [],
    fileExists: (name) => name === file,
    readFile: (name) => name === file ? text : undefined,
    getCanonicalFileName: (name) => name, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const checker = ts.createProgram([file], { noResolve: true, noLib: true, allowJs: true }, host).getTypeChecker();
  const declaration = (node) => node && ts.isIdentifier(node)
    ? (ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node))?.declarations?.[0] : undefined;
  const imported = (node, module, name) => {
    const decl = declaration(node);
    if (!decl) return false;
    const importedName = ts.isImportSpecifier(decl) ? (decl.propertyName ?? decl.name).text
      : ts.isImportClause(decl) || ts.isNamespaceImport(decl) ? 'default' : null;
    let parent = decl;
    while (parent && !ts.isImportDeclaration(parent)) parent = parent.parent;
    return parent?.moduleSpecifier.text === module && (!name || importedName === name);
  };
  const hook = (node) => node && ts.isCallExpression(node)
    && (imported(node.expression, 'react-i18next', 'useTranslation')
      || (ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'useTranslation'
        && imported(node.expression.expression, 'react-i18next')));
  const instance = (node) => {
    if (!node) return false;
    if (imported(node, 'i18next', 'default')) return true;
    const decl = declaration(node);
    if (decl && ts.isImportClause(decl)) {
      const specifier = decl.parent.moduleSpecifier.text;
      if (/(?:^|\/)i18n(?:\/index)?$/.test(specifier)) return true;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'i18n' && hook(node.expression)) return true;
    if (decl && ts.isBindingElement(decl) && (decl.propertyName ?? decl.name).text === 'i18n') {
      return hook(decl.parent.parent.initializer);
    }
    return false;
  };
  const typedTranslator = (type) => type && ts.isTypeReferenceNode(type)
    && imported(type.typeName, 'i18next', 'TFunction');
  const binding = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return 'unresolved';
    seen.add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return binding(node.expression, seen);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return functionBinding(node, seen);
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === 't' && (instance(node.expression) || hook(node.expression))) return 'translation';
      const decl = declaration(node.expression);
      if (node.name.text === 't' && decl?.initializer && hook(decl.initializer)) return 'translation';
      if (decl?.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
        const member = property(decl.initializer, node.name.text);
        if (member && ts.isPropertyAssignment(member)) return binding(member.initializer, seen);
        if (member && ts.isShorthandPropertyAssignment(member)) return binding(member.name, seen);
        if (member && ts.isMethodDeclaration(member)) return functionBinding(member, seen);
        return 'non-translation';
      }
      return 'unresolved';
    }
    if (imported(node, 'i18next', 't')) return 'translation';
    const decl = declaration(node);
    if (!decl) return 'unresolved';
    if (typedTranslator(decl.type)) return 'translation';
    if (ts.isBindingElement(decl)) {
      const owner = decl.parent.parent;
      const name = (decl.propertyName ?? decl.name).text;
      if (hook(owner.initializer)) {
        const first = ts.isArrayBindingPattern(decl.parent) && decl.parent.elements[0] === decl;
        return name === 't' || first ? 'translation' : 'non-translation';
      }
      if (owner.type && ts.isTypeLiteralNode(owner.type)) {
        const member = owner.type.members.find((m) => m.name?.text === name);
        if (typedTranslator(member?.type)) return 'translation';
      }
    }
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
        return functionBinding(decl.initializer, seen);
      }
      return binding(decl.initializer, seen);
    }
    if (ts.isFunctionDeclaration(decl)) return functionBinding(decl, seen);
    return 'unresolved';
  };
  const functionBindings = new WeakMap();
  const forwardingReturns = new WeakMap();
  const functionOf = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return functionOf(node.expression, seen);
    if (ts.isPropertyAccessExpression(node)) {
      const owner = declaration(node.expression);
      const member = property(owner?.initializer, node.name.text);
      return member && ts.isMethodDeclaration(member) ? member
        : functionOf(member?.initializer ?? member?.name, seen);
    }
    const decl = declaration(node);
    return decl && ts.isFunctionDeclaration(decl) ? decl
      : decl && ts.isVariableDeclaration(decl) ? functionOf(decl.initializer, seen) : null;
  };
  const translationArguments = (expression, args, seen = new Set()) => {
    const fn = functionOf(expression);
    const returned = fn && forwardingReturns.get(fn);
    if (!returned || seen.has(fn)) return args;
    seen.add(fn);
    const substitute = (node) => {
      const parameter = node && ts.isIdentifier(node) ? declaration(node) : null;
      const index = fn.parameters.indexOf(parameter);
      if (index !== -1) return args[index] ?? parameter.initializer;
      if (node && ts.isObjectLiteralExpression(node)) {
        return ts.factory.updateObjectLiteralExpression(node, node.properties.map((member) =>
          ts.isPropertyAssignment(member)
            ? ts.factory.updatePropertyAssignment(member, member.name, substitute(member.initializer) ?? member.initializer)
            : ts.isShorthandPropertyAssignment(member)
              ? ts.factory.createPropertyAssignment(member.name, substitute(member.name) ?? member.name)
            : member));
      }
      return node;
    };
    return translationArguments(returned.expression, returned.arguments.map(substitute), seen);
  };
  const functionBinding = (node, seen) => {
    if (functionBindings.has(node)) return functionBindings.get(node);
    functionBindings.set(node, 'unresolved');
    let result = 'non-translation';
    // A translation somewhere in the body does not make the caller's id a
    // translation key. Only a direct, unchanged first-parameter return proves
    // forwarding; the returned call also owns the fallback/options positions.
    const returned = node.body && !ts.isBlock(node.body) ? node.body
      : node.body?.statements.length === 1 && ts.isReturnStatement(node.body.statements[0])
        ? node.body.statements[0].expression : null;
    if (returned && ts.isCallExpression(returned)) {
      const targetBinding = binding(returned.expression, new Set(seen));
      const key = translationArguments(returned.expression, returned.arguments)[0];
      if (node.parameters[0] && ts.isIdentifier(node.parameters[0].name)
        && key && ts.isIdentifier(key) && declaration(key) === node.parameters[0]) {
        if (targetBinding === 'translation') {
          forwardingReturns.set(node, returned);
          result = 'translation';
        } else if (targetBinding === 'unresolved') {
          result = 'unresolved';
        }
      }
    }
    functionBindings.set(node, result);
    return result;
  };
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && literal(node.arguments[0]) !== null
      && (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression))) {
      const kind = binding(node.expression);
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
      const key = literal(node.arguments[0]);
      // Unproven helper parameters remain strict rather than silently being
      // discarded. Reports identify them separately for binding follow-up.
      if (key !== null && (kind === 'translation' || (kind === 'unresolved' && name === 't'))) {
        const effectiveArgs = translationArguments(node.expression, node.arguments);
        const options = effectiveArgs.find((arg, i) => i > 0 && arg && ts.isObjectLiteralExpression(arg));
        const fallback = literal(effectiveArgs[1]) ?? literal(property(options, 'defaultValue')?.initializer);
        const count = property(options, 'count');
        const countValue = count?.initializer;
        const numericCount = countValue && ts.isNumericLiteral(countValue) ? Number(countValue.text) : null;
        calls.push({
          key, fallback, binding: kind,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          count: count ? numericCount ?? 'dynamic' : null,
          ordinal: property(options, 'ordinal')?.initializer?.kind === ts.SyntaxKind.TrueKeyword,
          context: literal(property(options, 'context')?.initializer),
          dynamicOptions: effectiveArgs.slice(1).some((arg) =>
            arg && literal(arg) === null && !ts.isObjectLiteralExpression(arg))
            || !!options?.properties.some(ts.isSpreadAssignment),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

export function collectUsedKeys(files) {
  const used = new Map(); // key -> { refs: [{file, line}], fallback?: string }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let calls;
    try {
      calls = scanTranslationCalls(text, file);
    } catch (cause) {
      throw new Error(`Cannot scan translation bindings in ${file}`, { cause });
    }
    for (const call of calls) {
      const { key, fallback, line, ...contract } = call;
      const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (!used.has(key)) used.set(key, { refs: [], fallback: null });
      const entry = used.get(key);
      entry.refs.push({ file: rel, line, fallback, ...contract });
      if (entry.fallback === null && fallback !== null) entry.fallback = fallback;
    }
  }
  return used;
}

export function resolvesCall(definedKeys, key, call) {
  // App resources live in translation with fallbackNS: translation. A hook
  // namespace does not prepend a dotted path; an explicit colon selects a
  // resource namespace and leaves only the suffix as the fallback lookup key.
  // Keep the original literal in reports so genuine misses stay actionable.
  const separator = key.indexOf(':');
  if (separator !== -1) key = key.slice(separator + 1);
  if (definedKeys.has(key)) return true;
  if (call.context && definedKeys.has(`${key}_${call.context}`)) return true;
  if (call.count === null || call.dynamicOptions) return false;
  if (call.count === 0 && !call.ordinal
    && (definedKeys.has(`${key}_zero`) || (call.context && definedKeys.has(`${key}_${call.context}_zero`)))) return true;
  const type = call.ordinal ? 'ordinal' : 'cardinal';
  const rules = new Intl.PluralRules('en', { type });
  const categories = call.count === 'dynamic'
    ? rules.resolvedOptions().pluralCategories : [rules.select(call.count)];
  const prefix = call.ordinal ? '_ordinal' : '';
  return categories.every((category) =>
    definedKeys.has(`${key}${call.context ? `_${call.context}` : ''}${prefix}_${category}`)
    || definedKeys.has(`${key}${prefix}_${category}`));
}

// Insert a flat dotted key into a nested object, e.g.
//   setNested(obj, 'foo.bar.baz', 'Hi') -> obj.foo.bar.baz = 'Hi'
// If a path collision occurs (e.g. existing string at obj.foo when we try to
// set obj.foo.bar), the function returns false and leaves the tree untouched.
export function setNested(obj, dottedKey, value) {
  const parts = dottedKey.split('.');
  if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
    return false;
  }
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    // Keep the boundary explicit at the dynamic dereference, not just in preflight.
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return false;
    if (!Object.hasOwn(node, p)) {
      node[p] = Object.create(null);
    } else if (node[p] === null || typeof node[p] !== 'object' || Array.isArray(node[p])) {
      return false; // collision with an existing leaf
    }
    node = node[p];
  }
  const last = parts[parts.length - 1];
  if (last === '__proto__' || last === 'constructor' || last === 'prototype') return false;
  if (Object.hasOwn(node, last)) {
    // Existing leaf — leave it as-is. Caller checks definedKeys first.
    return false;
  }
  node[last] = value;
  return true;
}

function main() {
  if (!fs.existsSync(EN_PATH)) {
    console.error(`error: en.json not found at ${EN_PATH}`);
    process.exit(2);
  }
  const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
  const definedKeys = new Set(flatten(en));

  const files = walk(SRC_ROOT);
  const used = collectUsedKeys(files);

  // Every call must resolve: a plural-only base cannot answer a no-count call.
  const missing = [];
  for (const [key, info] of used) {
    const unresolvedRefs = info.refs.filter((ref) => !resolvesCall(definedKeys, key, ref));
    if (unresolvedRefs.length) missing.push({ key, refs: info.refs, unresolvedRefs, fallback: info.fallback });
  }

  // Defined-but-unused leaf keys. We do not count parent objects.
  const unused = [];
  const usedSet = new Set(used.keys());
  for (const k of definedKeys) {
    if (!usedSet.has(k)) unused.push(k);
  }

  // ─── Extract mode: write missing keys (with their fallback strings) into
  //     en.json so the bundle is the source of truth for translators. Keys
  //     without a fallback are left for manual entry — we do not invent text.
  //     Special case: a single-word key like t('Run') with no fallback is
  //     i18next's "use the key as the value" pattern; we add it to en.json
  //     using the key itself as the value so future bundles can override it.
  if (EXTRACT) {
    let added = 0;
    let skippedNoFallback = 0;
    let skippedCollision = 0;
    for (const { key, fallback } of missing) {
      let value = fallback;
      if (!value) {
        // i18next pattern: t('Run') or t('kW') with no fallback uses the key
        // itself as the displayed value. We mirror that in en.json so other
        // language bundles can override. Restrict this convenience to short
        // identifiers without dots — anything with a dotted namespace and no
        // fallback is a real bug we want translators to fix manually.
        const isLiteralEnglishKey =
          !key.includes('.') &&
          /^[A-Za-z][a-zA-Z0-9]*$/.test(key) &&
          key.length <= 32;
        if (isLiteralEnglishKey) {
          value = key;
        } else {
          skippedNoFallback++;
          continue;
        }
      }
      const ok = setNested(en, key, value);
      if (ok) added++;
      else skippedCollision++;
    }
    fs.writeFileSync(EN_PATH, JSON.stringify(en, null, 2) + '\n', 'utf8');
    console.log(`Extract complete:`);
    console.log(`  Added:                ${added}`);
    console.log(`  Skipped (no default): ${skippedNoFallback}`);
    console.log(`  Skipped (collision):  ${skippedCollision}`);
    process.exit(0);
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          definedCount: definedKeys.size,
          usedCount: used.size,
          missingCount: missing.length,
          unusedCount: unused.length,
          missing: missing.map(({ key, refs, unresolvedRefs, fallback }) => ({
            key,
            fallback,
            firstRef: refs[0],
            refs,
            unresolvedRefs,
          })),
          unused: unused.slice(0, 200),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Defined keys (en.json): ${definedKeys.size}`);
    console.log(`Used keys (t() calls):  ${used.size}`);
    console.log(`Missing in en.json:     ${missing.length}`);
    console.log(`Unused in en.json:      ${unused.length}`);
    if (missing.length > 0) {
      console.log('\nFirst 50 missing keys:');
      for (const { key, refs, fallback } of missing.slice(0, 50)) {
        const ref = refs[0];
        const f = fallback ? ` = "${fallback.slice(0, 40)}${fallback.length > 40 ? '…' : ''}"` : '';
        console.log(`  - ${key}${f}  (${ref.file}:${ref.line})`);
      }
    }
    if (unused.length > 0) {
      console.log('\nFirst 30 unused keys:');
      for (const k of unused.slice(0, 30)) console.log(`  - ${k}`);
    }
  }

  if (STRICT && missing.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main();
}
