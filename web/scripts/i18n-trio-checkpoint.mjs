/** Verified, reproducible updates for the i18n trio. Dry-run unless a repair mode is selected. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const root = fileURLToPath(new URL('../', import.meta.url));
const repo = path.dirname(root);
const catalogFile = path.join(root, 'src/i18n/en.json');
const unwrap = node => node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) ? unwrap(node.expression) : node;
let typedProgram;
export function enableTypedAudit() {
  const configPath = path.join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  typedProgram = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  // Bind parent/symbol links before walking callback environments (independent of file order).
  typedProgram.getTypeChecker();
}
export function finiteStrings(node) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isConditionalExpression(node)) {
    const left = finiteStrings(node.whenTrue), right = finiteStrings(node.whenFalse);
    return left && right ? [...new Set([...left, ...right])] : null;
  }
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const parts = finiteStrings(span.expression);
      if (!parts || values.length * parts.length > 500) return null;
      values = values.flatMap(value => parts.map(part => value + part + span.literal.text));
    }
    return values;
  }
  if (!typedProgram) return null;
  const type = typedProgram.getTypeChecker().getTypeAtLocation(node);
  const types = type.isUnion() ? type.types : [type];
  return types.every(type => type.isStringLiteral()) ? [...new Set(types.map(type => type.value))] : null;
}
export const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
export const digest = value => createHash('sha256').update(value).digest('hex');
export function literal(node) {
  node = unwrap(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  throw new Error('Nonliteral fixture: ' + node.getText());
}
export function declarations(file) {
  const text = fs.readFileSync(path.resolve(root, file), 'utf8'), tree = parse(file, text), result = new Map();
  for (const statement of tree.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (declaration.initializer && ts.isIdentifier(declaration.name)) result.set(declaration.name.text, { node: unwrap(declaration.initializer), tree, text });
  }
  return result;
}
export function valueAt(catalog, key) {
  const parts = key.replace(/^([^:]+):/, '$1.').split('.');
  function find(target, offset) {
    if (target === null || typeof target !== 'object') return undefined;
    for (let end = offset + 1; end <= parts.length; end++) {
      const segment = parts.slice(offset, end).join('.');
      if (!Object.hasOwn(target, segment)) continue;
      const value = target[segment];
      const found = end === parts.length ? value : find(value, end);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return find(catalog, 0);
}
export function callsIn(file) {
  const text = fs.readFileSync(path.resolve(repo, file), 'utf8'), tree = typedProgram?.getSourceFile(path.resolve(repo, file)) ?? parse(file, text), calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 't') || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'))) {
      const second = node.arguments[1], third = node.arguments[2];
      let options = second && ts.isObjectLiteralExpression(second) ? second : third && ts.isObjectLiteralExpression(third) ? third : null;
      if (!options && third && ts.isIdentifier(third)) {
        // Resolve a local immutable options object, never an unknown parameter.
        for (let scope = node.parent; scope; scope = scope.parent) {
          const candidates = [];
          for (const statement of scope.statements ?? []) if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
            for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.name.text === third.text && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) candidates.push(declaration.initializer);
          }
          if (candidates.length === 1) { options = candidates[0]; break; }
        }
      }
      const properties = new Map(options?.properties.filter(part => ts.isPropertyAssignment(part) || ts.isShorthandPropertyAssignment(part)).map(part => [part.name.getText(tree).replace(/^['"]|['"]$/g, ''), ts.isPropertyAssignment(part) ? part.initializer : part.name]) ?? []);
      const fallback = second && !ts.isObjectLiteralExpression(second) ? second : properties.get('defaultValue');
      calls.push({ file, tree, node, keyNode: node.arguments[0], key: node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null, fallbackNode: fallback, fallback: fallback && ts.isStringLiteralLike(fallback) ? fallback.text : null, options, properties, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return calls;
}
export function sourceFiles() {
  return execFileSync('rg', ['--files', 'src', '-g', '*.ts', '-g', '*.tsx', '-g', '!*.test.*', '-g', '!*.spec.*'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map(file => 'web/' + file.replaceAll('\\', '/')).filter(file => !file.includes('/src/test/') && !file.endsWith('/test-setup.ts'));
}
export function insert(catalog, key, value) {
  const parts = key.split('.'); let target = catalog;
  for (const [index, part] of parts.slice(0, -1).entries()) {
    if (target[part] !== undefined && (typeof target[part] !== 'object' || target[part] === null)) {
      // Preserve scalar headings using the catalog's existing dotted-sibling convention.
      const sibling = parts.slice(index).join('.');
      if (target[sibling] !== undefined && target[sibling] !== value) throw new Error('Conflicting value: ' + key);
      target[sibling] = value;
      return;
    }
    target = target[part] ??= {};
  }
  if (target[parts.at(-1)] !== undefined && target[parts.at(-1)] !== value) throw new Error('Conflicting value: ' + key);
  target[parts.at(-1)] = value;
}
export function allCatalogCalls() { return sourceFiles().flatMap(callsIn); }
const unknown = Symbol('unresolved');
function staticValue(node, environment = {}, seen = new Set()) {
  node = unwrap(node);
  if (!node) return unknown;
  if (Object.hasOwn(environment, node.getText())) return environment[node.getText()];
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isIdentifier(node)) {
    if (Object.hasOwn(environment, node.text)) return environment[node.text];
    let symbol = typedProgram?.getTypeChecker().getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = typedProgram.getTypeChecker().getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (!declaration || seen.has(declaration) || !declaration.initializer) return unknown;
    if (ts.isVariableDeclaration(declaration) && !(declaration.parent.flags & ts.NodeFlags.Const)) return unknown;
    return staticValue(declaration.initializer, environment, new Set([...seen, declaration]));
  }
  if (ts.isBinaryExpression(node)) {
    const left = staticValue(node.left, environment, seen);
    if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && left !== unknown) return left ?? staticValue(node.right, environment, seen);
    const right = staticValue(node.right, environment, seen);
    if (left !== unknown && right !== unknown && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) return left === right;
    if (left !== unknown && right !== unknown && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    return unknown;
  }
  if (ts.isConditionalExpression(node)) {
    const condition = staticValue(node.condition, environment, seen);
    return typeof condition === 'boolean' ? staticValue(condition ? node.whenTrue : node.whenFalse, environment, seen) : unknown;
  }
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[1] && ts.isStringLiteralLike(node.arguments[1])) return node.arguments[1].text;
    if (ts.isPropertyAccessExpression(node.expression)) {
      const value = staticValue(node.expression.expression, environment, seen), method = node.expression.name.text;
      if (typeof value !== 'string') return unknown;
      if (method === 'toUpperCase' && !node.arguments.length) return value.toUpperCase();
      if (method === 'toLowerCase' && !node.arguments.length) return value.toLowerCase();
      if (method === 'charAt' && node.arguments.length === 1) { const index = staticValue(node.arguments[0], environment, seen); return typeof index === 'number' ? value.charAt(index) : unknown; }
      if (method === 'slice') { const args = node.arguments.map(arg => staticValue(arg, environment, seen)); return args.every(arg => typeof arg === 'number') ? value.slice(...args) : unknown; }
      if (method === 'replace' && node.arguments.length === 2 && ts.isRegularExpressionLiteral(node.arguments[0])) {
        const pattern = node.arguments[0].getText(), end = pattern.lastIndexOf('/');
        const replacement = node.arguments[1];
        if (ts.isStringLiteralLike(replacement)) return value.replace(new RegExp(pattern.slice(1, end), pattern.slice(end + 1)), replacement.text);
        if (ts.isArrowFunction(replacement) && replacement.parameters.length === 1 && ts.isCallExpression(replacement.body) && ts.isPropertyAccessExpression(replacement.body.expression) && replacement.body.expression.name.text === 'toUpperCase' && replacement.body.expression.expression.getText() === replacement.parameters[0].name.getText()) return value.replace(new RegExp(pattern.slice(1, end), pattern.slice(end + 1)), char => char.toUpperCase());
      }
    }
    return unknown;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(part => staticValue(part, environment, seen));
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(part => [part.name.getText().replace(/^['"]|['"]$/g, ''), staticValue(part.initializer, environment, seen)]));
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const object = staticValue(node.expression, environment, seen);
    const key = ts.isPropertyAccessExpression(node) ? node.name.text : staticValue(node.argumentExpression, environment, seen);
    if (object === unknown || key === unknown || object == null) return unknown;
    return Object.hasOwn(Object(object), key) ? object[key] : undefined;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) { const part = staticValue(span.expression, environment, seen); if (part === unknown) return unknown; value += part + span.literal.text; }
    return value;
  }
  return unknown;
}
export function verificationCalls(file) {
  return callsIn(file).flatMap(call => {
    if (call.keyNode && call.fallbackNode && ts.isConditionalExpression(call.keyNode) && ts.isConditionalExpression(call.fallbackNode) && call.keyNode.condition.getText() === call.fallbackNode.condition.getText()) {
      const pairs = [[call.keyNode.whenTrue, call.fallbackNode.whenTrue], [call.keyNode.whenFalse, call.fallbackNode.whenFalse]];
      if (pairs.every(([key, fallback]) => ts.isStringLiteralLike(key) && ts.isStringLiteralLike(fallback))) return pairs.map(([key, fallback]) => ({ ...call, key: key.text, fallback: fallback.text }));
    }
    if (call.keyNode && ts.isTemplateExpression(call.keyNode)) {
      let environments = [{}];
      for (const span of call.keyNode.templateSpans) {
        const values = finiteStrings(span.expression);
        if (!values || environments.length * values.length > 500) { environments = []; break; }
        environments = environments.flatMap(environment => values.map(value => ({ ...environment, [span.expression.getText()]: value })));
      }
      const expanded = environments.map(environment => ({ ...call, key: staticValue(call.keyNode, environment), fallback: call.fallbackNode ? staticValue(call.fallbackNode, environment) : null }));
      if (expanded.length && expanded.every(row => typeof row.key === 'string' && (row.fallback === null || typeof row.fallback === 'string'))) return expanded;
    }
    for (let parent = call.node.parent; parent; parent = parent.parent) {
      if (!ts.isArrowFunction(parent) || !ts.isCallExpression(parent.parent) || !ts.isPropertyAccessExpression(parent.parent.expression)) continue;
      const invocation = parent.parent;
      if (!['map', 'flatMap'].includes(invocation.expression.name.text)) continue;
      const rows = staticValue(invocation.expression.expression);
      if (!Array.isArray(rows)) continue;
      const parameter = parent.parameters[0]?.name;
      if (!parameter) continue;
      const expanded = rows.map(row => {
        const environment = {};
        if (ts.isIdentifier(parameter)) environment[parameter.text] = row;
        else if (ts.isArrayBindingPattern(parameter)) parameter.elements.forEach((part, index) => { if (ts.isBindingElement(part) && ts.isIdentifier(part.name)) environment[part.name.text] = row?.[index] ?? unknown; });
        else if (ts.isObjectBindingPattern(parameter)) parameter.elements.forEach(part => { if (ts.isIdentifier(part.name)) environment[part.name.text] = row?.[part.propertyName?.getText() ?? part.name.text] ?? unknown; });
        else return null;
        const key = staticValue(call.keyNode, environment);
        const fallback = call.fallbackNode ? staticValue(call.fallbackNode, environment) : null;
        return typeof key === 'string' && (fallback === null || typeof fallback === 'string') ? { ...call, key, fallback } : null;
      });
      if (expanded.length && expanded.every(Boolean)) return expanded;
    }
    const fallback = call.fallbackNode ? staticValue(call.fallbackNode) : null;
    return [typeof fallback === 'string' ? { ...call, fallback } : call];
  });
}
/** Conservative eligibility: unresolved dynamic expressions never receive a checkpoint. */
export function verifyFile(file, catalog) {
  const calls = verificationCalls(file), errors = [];
  for (const call of calls) {
    const at = { line: call.line, key: call.key };
    if (!call.key) {
      const keys = finiteStrings(call.keyNode);
      if (!keys || !keys.length) { errors.push({ ...at, reason: 'Unresolved dynamic key', expression: call.keyNode?.getText(call.tree) }); continue; }
      const defaults = call.fallbackNode ? finiteStrings(call.fallbackNode) : null;
      for (const key of keys) {
        const value = valueAt(catalog, key);
        if (typeof value !== 'string') { errors.push({ ...at, key, reason: 'Missing dynamic English key' }); continue; }
        if (call.fallbackNode && (!defaults || defaults.some(fallback => fallback !== value))) errors.push({ ...at, key, reason: 'Dynamic key/default pairing requires review' });
        for (const match of value.matchAll(/{{-?\s*([^},\s]+)[^}]*}}/g)) if (!call.properties.has(match[1])) errors.push({ ...at, key, reason: 'Missing dynamic interpolation option', variable: match[1] });
      }
      continue;
    }
    const direct = valueAt(catalog, call.key);
    const plural = ['_one', '_other'].map(suffix => valueAt(catalog, call.key + suffix));
    const values = typeof direct === 'string' ? [direct] : plural.every(value => typeof value === 'string') ? plural : [];
    if (!values.length) { errors.push({ ...at, reason: 'Missing English key' }); continue; }
    if (call.fallbackNode && call.fallback === null) {
      const fallback = call.fallbackNode;
      const count = call.properties.get('count');
      const conditionalPlural = ts.isConditionalExpression(fallback) && count && ts.isBinaryExpression(fallback.condition)
        && fallback.condition.left.getText(call.tree) === count.getText(call.tree)
        && fallback.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        && fallback.condition.right.getText(call.tree) === '1'
        && ts.isStringLiteralLike(fallback.whenTrue) && ts.isStringLiteralLike(fallback.whenFalse)
        && fallback.whenTrue.text === plural[0] && fallback.whenFalse.text === plural[1];
      if (!conditionalPlural) errors.push({ ...at, reason: 'Unresolved dynamic fallback' });
    }
    if (call.fallback !== null && !values.includes(call.fallback)) errors.push({ ...at, reason: 'Fallback differs', fallback: call.fallback, expected: values[0] });
    if (typeof direct !== 'string' && !call.properties.has('count')) errors.push({ ...at, reason: 'Plural key without explicit count' });
    for (const value of values) for (const match of value.matchAll(/{{-?\s*([^},\s]+)[^}]*}}/g)) {
      if (!call.properties.has(match[1])) errors.push({ ...at, reason: 'Missing explicit interpolation option', variable: match[1] });
    }
  }
  return { file, calls: callsIn(file).length, errors };
}
export function repairMissing(catalog, calls) {
  const grouped = Map.groupBy(calls.filter(call => call.key && ![call.key, call.key + '_one', call.key + '_other', call.key + '_zero'].some(key => typeof valueAt(catalog, key) === 'string')), call => call.key);
  const added = [], unresolved = [];
  for (const [key, uses] of grouped) {
    const values = new Set(uses.map(call => call.fallback));
    if (values.size !== 1 || values.has(null) || uses.some(call => call.properties.has('count')) || [...values][0].includes('{{count}}')) {
      unresolved.push({ key, reason: 'Requires plural forms, a missing default, or conflicting source defaults', uses: uses.map(call => ({ file: call.file, line: call.line, fallback: call.fallback })) });
      continue;
    }
    try { insert(catalog, key.replace(/^([^:]+):/, '$1.'), [...values][0]); added.push({ key, value: [...values][0], uses: uses.length }); }
    catch (error) { unresolved.push({ key, reason: error.message }); }
  }
  return { added, unresolved };
}
function run() {
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  if (process.argv.includes('--typed')) enableTypedAudit();
  const typographyList = process.argv.find(arg => arg.startsWith('--align-typography='))?.slice(19);
  if (typographyList) {
    const files = JSON.parse(fs.readFileSync(path.resolve(typographyList), 'utf8'));
    const normalize = text => text.toLowerCase().replaceAll('…', '...').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    let changed = 0;
    for (const file of files) {
      const edits = callsIn(file).flatMap(call => {
        const expected = call.key ? valueAt(catalog, call.key) : undefined;
        return call.fallback !== null && typeof expected === 'string' && call.fallback !== expected && normalize(call.fallback) === normalize(expected)
          ? [{ start: call.fallbackNode.getStart(call.tree), end: call.fallbackNode.end, value: JSON.stringify(expected) }] : [];
      });
      if (!edits.length) continue;
      let source = fs.readFileSync(path.resolve(repo, file), 'utf8');
      for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
      fs.writeFileSync(path.resolve(repo, file), source);
      changed += edits.length;
    }
    console.log('Aligned ' + changed + ' typographic/case-only fallback differences');
    return;
  }
  const checkpointList = process.argv.find(arg => arg.startsWith('--checkpoint-sources='))?.slice(21);
  if (checkpointList) {
    const files = JSON.parse(fs.readFileSync(path.resolve(checkpointList), 'utf8'));
    const verification = files.map(file => verifyFile(file, catalog));
    if (verification.some(result => result.errors.length)) throw new Error('Translation verification failed; no checkpoints written: ' + JSON.stringify(verification.filter(result => result.errors.length)));
    const target = path.join(root, 'src/i18n/verified-producer-checkpoints.json');
    const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : [];
    const merged = new Map(existing.map(row => [row.file, row]));
    for (const result of verification) merged.set(result.file, { file: result.file, calls: result.calls, sha256: digest(fs.readFileSync(path.resolve(repo, result.file))) });
    fs.writeFileSync(target, JSON.stringify([...merged.values()].sort((a, b) => a.file.localeCompare(b.file, 'en')), null, 2) + '\n');
    console.log('Verified and checkpointed ' + verification.length + ' source files');
    return;
  }
  let calls = process.argv.includes('--repair-bounded') || process.argv.includes('--repair-known') ? sourceFiles().flatMap(verificationCalls) : allCatalogCalls();
  if (process.argv.includes('--repair-known')) calls = calls.flatMap(call => call.key ? [call] : (finiteStrings(call.keyNode)?.map(key => ({ ...call, key })) ?? [call]));
  if (process.argv.includes('--repair-missing') || process.argv.includes('--repair-bounded') || process.argv.includes('--repair-known')) {
    const result = repairMissing(catalog, calls);
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
    console.log(JSON.stringify(result));
  }
  const missing = [], fallback = [], dynamic = [];
  for (const call of calls) {
    const row = { file: call.file, line: call.line, key: call.key, fallback: call.fallback };
    if (!call.key) { dynamic.push({ ...row, expression: call.keyNode?.getText(call.tree) }); continue; }
    const values = [valueAt(catalog, call.key), ...(['_one', '_other', '_zero'].map(suffix => valueAt(catalog, call.key + suffix)))].filter(value => typeof value === 'string');
    if (!values.length) missing.push(row);
    else if (call.fallback !== null && !values.includes(call.fallback)) fallback.push({ ...row, expected: values[0] });
  }
  const report = { files: sourceFiles().length, calls: calls.length, missing, fallback, dynamic };
  const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice(9);
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ files: report.files, calls: report.calls, missing: missing.length, fallback: fallback.length, dynamic: dynamic.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
