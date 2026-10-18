/** Verified, reproducible updates for the i18n trio. Dry-run unless a repair mode is selected. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { registryCalls, registryDependencies } from './i18n-trio-registries.mjs';

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
  const text = fs.readFileSync(path.resolve(root, file), 'utf8'), tree = typedProgram?.getSourceFile(path.resolve(root, file)) ?? parse(file, text), result = new Map();
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
export function staticValue(node, environment = {}, seen = new Set()) {
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
    if (ts.isIdentifier(node.expression) && node.expression.text === 'useMemo' && node.arguments[0] && ts.isArrowFunction(node.arguments[0]) && !node.arguments[0].parameters.length && !ts.isBlock(node.arguments[0].body)) return staticValue(node.arguments[0].body, environment, seen);
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.getText() === 'Object.freeze' && node.arguments.length === 1) return staticValue(node.arguments[0], environment, seen);
    if (ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[1] && ts.isStringLiteralLike(node.arguments[1])) return node.arguments[1].text;
    if (ts.isPropertyAccessExpression(node.expression)) {
      const value = staticValue(node.expression.expression, environment, seen), method = node.expression.name.text;
      if (Array.isArray(value) && ['filter', 'sort'].includes(method)) return value;
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
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(part => { if (ts.isSpreadElement(part)) { const value = staticValue(part.expression, environment, seen); return Array.isArray(value) ? value : [unknown]; } return [staticValue(part, environment, seen)]; });
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
function possibleValues(node, seen = new Set()) {
  node = unwrap(node);
  if (!node || seen.has(node)) return [];
  const next = new Set([...seen, node]);
  const value = staticValue(node);
  if (value !== unknown && value !== undefined) return [value];
  if (ts.isIdentifier(node)) {
    let symbol = typedProgram?.getTypeChecker().getSymbolAtLocation(node);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = typedProgram.getTypeChecker().getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    return declaration?.initializer ? possibleValues(declaration.initializer, next) : [];
  }
  if (ts.isConditionalExpression(node)) return [...possibleValues(node.whenTrue, next), ...possibleValues(node.whenFalse, next)];
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) return [...possibleValues(node.left, next), ...possibleValues(node.right, next)];
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'find') {
    const rows = staticValue(node.expression.expression);
    return Array.isArray(rows) ? rows : [];
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    let symbol = typedProgram?.getTypeChecker().getSymbolAtLocation(node.expression);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = typedProgram.getTypeChecker().getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body && !next.has(declaration)) {
      const values = [], seenReturns = new Set([...next, declaration]);
      const visit = part => { if (ts.isReturnStatement(part) && part.expression) values.push(...possibleValues(part.expression, seenReturns)); else if (part === declaration.body || !(ts.isFunctionDeclaration(part) || ts.isArrowFunction(part) || ts.isFunctionExpression(part))) ts.forEachChild(part, visit); };
      visit(declaration.body);
      return values;
    }
  }
  if (ts.isElementAccessExpression(node)) {
    const object = staticValue(node.expression), keys = finiteStrings(node.argumentExpression);
    if (object && object !== unknown && typeof object === 'object') return (keys ?? Object.keys(object)).filter(key => Object.hasOwn(object, key)).map(key => object[key]);
  }
  return [];
}
export function verificationCalls(file) {
  return callsIn(file).flatMap(call => {
    const registry = registryCalls(call, { declarations, staticValue });
    if (registry) return registry;
    const arrow = call.node.parent;
    if (ts.isArrowFunction(arrow) && arrow.body === call.node && arrow.parameters.length === 2 && call.node.arguments.length === 2 && arrow.parameters.every((parameter, index) => parameter.name.getText() === call.node.arguments[index].getText()) && ts.isPropertyAssignment(arrow.parent) && arrow.parent.name.getText() === 't' && ts.isObjectLiteralExpression(arrow.parent.parent) && ts.isCallExpression(arrow.parent.parent.parent)) {
      const invocation = arrow.parent.parent.parent;
      let symbol = typedProgram?.getTypeChecker().getSymbolAtLocation(invocation.expression);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = typedProgram.getTypeChecker().getAliasedSymbol(symbol);
      const provider = symbol?.valueDeclaration;
      if (provider && ts.isFunctionDeclaration(provider) && provider.body && provider.getSourceFile() === call.tree && provider.parameters[0] && ts.isIdentifier(provider.parameters[0].name)) {
        const argument = provider.parameters[0].name.text;
        const forwarded = callsIn(file).filter(row => row.node.pos >= provider.body.pos && row.node.end <= provider.body.end);
        if (forwarded.length && forwarded.every(row => row.key && row.fallback !== null && ts.isPropertyAccessExpression(row.node.expression) && row.node.expression.expression.getText() === argument)) return forwarded;
      }
    }
    const directKey = staticValue(call.keyNode), directFallback = call.fallbackNode ? staticValue(call.fallbackNode) : null;
    if (typeof directKey === 'string' && (directFallback === null || typeof directFallback === 'string')) return [{ ...call, key: directKey, fallback: directFallback }];
    if (call.keyNode && ts.isPropertyAccessExpression(call.keyNode) && call.fallbackNode && ts.isPropertyAccessExpression(call.fallbackNode) && call.keyNode.expression.getText() === call.fallbackNode.expression.getText()) {
      const rows = possibleValues(call.keyNode.expression);
      if (rows.length && rows.every(row => row && typeof row[call.keyNode.name.text] === 'string' && typeof row[call.fallbackNode.name.text] === 'string')) return rows.map(row => ({ ...call, key: row[call.keyNode.name.text], fallback: row[call.fallbackNode.name.text] }));
    }
    const indexes = [];
    const collectIndexes = node => { if (ts.isElementAccessExpression(node)) { const values = finiteStrings(node.argumentExpression); if (values) indexes.push({ expression: node.argumentExpression.getText(), values }); } ts.forEachChild(node, collectIndexes); };
    if (call.keyNode) collectIndexes(call.keyNode);
    if (indexes.length) {
      let environments = [{}];
      for (const { expression, values } of indexes) { if (environments.length * values.length > 500) { environments = []; break; } environments = environments.flatMap(environment => values.map(value => ({ ...environment, [expression]: value }))); }
      const rows = environments.map(environment => ({ ...call, key: staticValue(call.keyNode, environment), fallback: call.fallbackNode ? staticValue(call.fallbackNode, environment) : null }));
      if (rows.length && rows.every(row => typeof row.key === 'string' && (row.fallback === null || typeof row.fallback === 'string'))) return rows;
    }
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
      if (!['map', 'flatMap', 'filter', 'find', 'some', 'every'].includes(invocation.expression.name.text)) continue;
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
function existingHelper(file, name) {
  const text = fs.readFileSync(path.resolve(root, file), 'utf8'), tree = parse(file, text);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error('Missing existing snapshot helper: ' + file + ':' + name);
  const javascript = ts.transpileModule(declaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(javascript + '; return ' + name)();
}
export function checkpointCatalog(catalog) {
  if (!typedProgram) throw new Error('Catalog checkpoint requires --typed key verification');
  const calls = sourceFiles().flatMap(verificationCalls), missing = [], unknownKeys = [];
  for (const call of calls) {
    const keys = call.key ? [call.key] : finiteStrings(call.keyNode);
    if (!keys) { unknownKeys.push({ file: call.file, line: call.line }); continue; }
    for (const key of keys) if (![key, key + '_one', key + '_other', key + '_zero'].some(candidate => typeof valueAt(catalog, candidate) === 'string')) missing.push(key);
  }
  if (missing.length) throw new Error('Missing used English keys: ' + JSON.stringify([...new Set(missing)]));
  const names = { canonical: 'src/i18n/authorized-canonical-recovery.test.ts', owner: 'src/i18n/authorized-owner-recovery.test.ts', feature: 'src/i18n/excluded-feature-owned-producers.test.ts', consistent: 'src/i18n/excluded-consistent-defaults.test.ts', resolved: 'src/i18n/resolved-baseline-producer.test.ts' };
  const fixture = (file, name) => literal(declarations(file).get(name).node);
  const canonical = fixture(names.canonical, 'authorizedCanonicalAdditions'), owner = fixture(names.owner, 'ownerRecoveryAdditions'), finalFour = fixture(names.owner, 'finalFourAdditions');
  const feature = fixture(names.feature, 'featureOwnedAdditions'), copy = fixture(names.feature, 'copyOwnerAdditions'), drives = fixture(names.feature, 'drivesEmptyAddition');
  const later = fixture(names.feature, 'interveningAdditions'), consistent = fixture(names.consistent, 'additions'), resolved = fixture(names.resolved, 'additions');
  const shared = [...canonical, ...owner, ...finalFour];
  const exclude = {
    canonical: [...shared, ...later], owner: [...owner, ...finalFour, ...later],
    feature: [...feature, ...copy, drives, ['systemStatus.incidents.updateCount_other'], ...shared, ...later],
    consistent: [...consistent, ...feature, ...copy, drives, ['systemStatus.incidents.updateCount_other'], ...shared, ...later],
    resolved: [...resolved, ...consistent, ...feature, ...copy, drives, ['systemStatus.incidents.updateCount_other'], ...shared, ...later],
  };
  const physical = existingHelper(names.canonical, 'physical')(catalog);
  for (const language of ['ar', 'he']) {
    const resource = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/' + language + '.json'), 'utf8'));
    for (const [parts] of existingHelper(names.canonical, 'physical')(resource)) if (parts[0] !== '_meta' && valueAt(catalog, parts.join('.')) === undefined) throw new Error('Other-language key absent in English: ' + language + ':' + parts.join('.'));
  }
  const results = [];
  for (const [group, file] of Object.entries(names)) {
    const isPhysical = ['canonical', 'owner'].includes(group);
    const keys = new Set(exclude[group].map(([key]) => isPhysical ? JSON.stringify(key.split('.')) : key));
    const entries = existingHelper(file, isPhysical ? 'physical' : 'leaves')(catalog);
    const predecessor = entries.filter(([key]) => !keys.has(isPhysical ? JSON.stringify(key) : key));
    if (!isPhysical) predecessor.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const variable = isPhysical ? 'predecessor' : 'oldEntries';
    const text = fs.readFileSync(path.resolve(root, file), 'utf8'), tree = parse(file, text), edits = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.arguments.length === 1) {
        const method = node.expression.name.text, receiver = node.expression.expression.getText(tree), argument = node.arguments[0];
        if (method === 'toHaveLength' && receiver === 'expect(' + variable + ')') edits.push({ start: argument.getStart(tree), end: argument.end, value: String(predecessor.length) });
        if (method === 'toHaveLength' && receiver === (isPhysical ? 'expect(entries)' : 'expect(leaves(catalog))')) edits.push({ start: argument.getStart(tree), end: argument.end, value: String(entries.length) });
        if (method === 'toBe' && ts.isStringLiteralLike(argument) && /^[a-f0-9]{64}$/.test(argument.text) && receiver.includes('JSON.stringify(' + variable + ')')) edits.push({ start: argument.getStart(tree), end: argument.end, value: JSON.stringify(digest(JSON.stringify(predecessor))) });
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    if (edits.length !== 3) throw new Error('Expected exactly partition count/hash and total count: ' + file + ', got ' + edits.length);
    let updated = text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end);
    fs.writeFileSync(path.resolve(root, file), updated);
    results.push({ file, partition: predecessor.length, total: entries.length });
  }
  console.log(JSON.stringify({ knownKeysVerified: calls.length, unresolvedRuntimeExpressions: unknownKeys.length, languageKeysPreserved: true, checkpoints: results }));
}
export function checkpointSources(catalog, files) {
  const verification = files.map(file => verifyFile(file, catalog));
  if (verification.some(result => result.errors.length)) throw new Error('Translation verification failed; no checkpoints written: ' + JSON.stringify(verification.filter(result => result.errors.length)));
  const target = path.join(root, 'src/i18n/verified-producer-checkpoints.json');
  const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : [];
  const merged = new Map(existing.map(row => [row.file, row]));
  for (const result of verification) merged.set(result.file, { file: result.file, calls: result.calls, sha256: digest(fs.readFileSync(path.resolve(repo, result.file))),
    ...(['web/src/components/layout/Layout.tsx', 'web/src/components/layout/sidebar/AtlasPanel.tsx', 'web/src/components/ui/CommandPalette.tsx', 'web/src/features/system/components/help-index/HelpSearch.tsx'].includes(result.file)
      ? { dependencies: registryDependencies.map(file => ({ file, sha256: digest(fs.readFileSync(path.resolve(repo, file))) })) } : {}) });
  fs.writeFileSync(target, JSON.stringify([...merged.values()].sort((a, b) => a.file.localeCompare(b.file, 'en')), null, 2) + '\n');
  console.log('Verified and checkpointed ' + verification.length + ' source files');
}
function run() {
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  if (process.argv.includes('--typed')) enableTypedAudit();
  if (process.argv.includes('--checkpoint-catalog')) { checkpointCatalog(catalog); return; }
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
    checkpointSources(catalog, files);
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
