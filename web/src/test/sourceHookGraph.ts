import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface GraphOptions {
  sourceRoot?: string;
  readSource?: (file: string) => string | undefined;
  maxNodes?: number;
  maxDepth?: number;
}

interface HookCall {
  name: string;
  module: string;
}

const isHook = (name: string) => /^use[A-Z0-9]/.test(name);
const isCallable = (node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);

/**
 * Test-only static composition audit, not a runtime/data-flow proof.
 * Follow called hook bindings inside the entry's feature, not shared settings,
 * API, presentation components, or unrelated exports in an imported module.
 */
export function sourceHookCalls(entry: string, options: GraphOptions = {}): HookCall[] {
  const root = path.resolve(options.sourceRoot ?? path.join(process.cwd(), 'src'));
  const entryFile = path.resolve(entry);
  const relative = path.relative(root, entryFile).split(path.sep);
  const compositionRoot = relative[0] === 'features'
    ? path.join(root, 'features', relative[1])
    : path.dirname(entryFile);
  const read = options.readSource ?? ((file: string) =>
    fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : undefined);
  const cache = new Map<string, ReturnType<typeof parse>>();
  const visited = new Set<string>();
  const calls = new Map<string, HookCall>();
  const maxNodes = options.maxNodes ?? 128;
  const maxDepth = options.maxDepth ?? 24;

  function parse(file: string) {
    const text = read(file);
    if (text == null) throw new Error(`Missing composition source: ${file}`);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    // Bind one module only: imported packages and unrelated source graphs are
    // never loaded. The checker still distinguishes shadowed local identifiers.
    const compilerOptions = { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest };
    const host = ts.createCompilerHost(compilerOptions);
    host.getSourceFile = (name) => path.resolve(name) === file ? source : undefined;
    host.fileExists = (name) => path.resolve(name) === file;
    host.readFile = (name) => path.resolve(name) === file ? text : undefined;
    const checker = ts.createProgram([file], compilerOptions, host).getTypeChecker();
    return { source, checker };
  }

  function load(file: string) {
    let module = cache.get(file);
    if (!module) {
      module = parse(file);
      cache.set(file, module);
    }
    return module;
  }

  function resolve(from: string, specifier: string) {
    const base = specifier.startsWith('@/') ? path.resolve(root, specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : undefined;
    if (!base || path.relative(root, base).startsWith('..')) return undefined;
    return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
      .find((candidate) => read(candidate) != null);
  }

  function withinComposition(file: string) {
    const relativePath = path.relative(compositionRoot, file);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }

  function enter(key: string, depth: number) {
    if (visited.has(key)) return false;
    if (depth > maxDepth || visited.size >= maxNodes) {
      throw new Error(`Hook composition graph exceeds audit bounds (${maxNodes} nodes, ${maxDepth} depth)`);
    }
    visited.add(key);
    return true;
  }

  function callable(file: string, node: ts.Node | undefined, seen = new Set<ts.Node>()):
    ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | undefined {
    if (!node || seen.has(node)) return undefined;
    seen.add(node);
    if (isCallable(node)) return node;
    if (ts.isVariableDeclaration(node)) return callable(file, node.initializer, seen);
    if (ts.isParenthesizedExpression(node)) return callable(file, node.expression, seen);
    if (ts.isIdentifier(node)) {
      const declaration = load(file).checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && !ts.isImportClause(declaration) && !ts.isImportSpecifier(declaration)) {
        return callable(file, declaration, seen);
      }
    }
    return undefined;
  }

  function defaultHookName(file: string) {
    for (const statement of load(file).source.statements) {
      if (ts.isFunctionDeclaration(statement)
        && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        return statement.name?.text;
      }
      if (ts.isExportAssignment(statement)) {
        if (ts.isIdentifier(statement.expression)) return statement.expression.text;
        const fn = callable(file, statement.expression);
        return fn && 'name' in fn ? fn.name?.text : undefined;
      }
    }
    return undefined;
  }

  function followExport(file: string, name: string, depth: number) {
    if (!enter(`${file}#export:${name}`, depth)) return;
    const { source } = load(file);
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement) && name === 'default') {
        walkCallable(file, callable(file, statement.expression), depth);
      } else if (ts.isFunctionDeclaration(statement)) {
        const modifiers = statement.modifiers;
        const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        const defaultExport = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
        if (exported && (defaultExport ? name === 'default' : statement.name?.text === name)) {
          walkCallable(file, statement, depth);
        }
      } else if (ts.isVariableStatement(statement)
        && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
            walkCallable(file, callable(file, declaration), depth);
          }
        }
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly
        && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const binding of statement.exportClause.elements) {
          if (binding.isTypeOnly || binding.name.text !== name) continue;
          if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            const target = resolve(file, statement.moduleSpecifier.text);
            if (target && withinComposition(target)) {
              followExport(target, (binding.propertyName ?? binding.name).text, depth + 1);
            }
          } else {
            walkCallable(file, callable(file, binding.propertyName ?? binding.name), depth);
          }
        }
      }
    }
  }

  function walkCallable(file: string, fn: ReturnType<typeof callable>, depth: number) {
    if (!fn?.body || !enter(`${file}#body:${fn.pos}`, depth)) return;
    const { source, checker } = load(file);
    const imports = new Map<ts.Symbol, { name: string; specifier: string }>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !statement.importClause || statement.importClause.isTypeOnly) continue;
      const clause = statement.importClause;
      const specifier = statement.moduleSpecifier.text;
      const add = (node: ts.Identifier, name: string) => {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) imports.set(symbol, { name, specifier });
      };
      if (clause.name) add(clause.name, 'default');
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const binding of clause.namedBindings.elements) {
          if (!binding.isTypeOnly) add(binding.name, (binding.propertyName ?? binding.name).text);
        }
      } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        add(clause.namedBindings.name, '*');
      }
    }

    function visit(node: ts.Node) {
      // A declared callback/helper is not an invocation. Do not borrow hooks
      // from functions that the audited page/controller never calls.
      if (isCallable(node)) return;
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        && ts.isIdentifier(node.tagName)) {
        const symbol = checker.getSymbolAtLocation(node.tagName);
        // Same-module JSX is an actual composition edge (e.g. a route wrapper
        // rendering its local body), but imported presentation trees are not.
        if (symbol && !imports.has(symbol)) {
          walkCallable(file, callable(file, symbol.valueDeclaration), depth + 1);
        }
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const identifier = ts.isIdentifier(expression) ? expression
          : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
            ? expression.expression : undefined;
        const symbol = identifier ? checker.getSymbolAtLocation(identifier) : undefined;
        const binding = symbol ? imports.get(symbol) : undefined;
        const target = binding ? resolve(file, binding.specifier) : undefined;
        const hookName = ts.isPropertyAccessExpression(expression)
          ? binding?.name === '*' ? expression.name.text : undefined
          : ts.isIdentifier(expression)
            ? binding?.name === 'default' ? target && defaultHookName(target)
              : binding?.name ?? expression.text
            : undefined;
        if (hookName && isHook(hookName)) {
          if (binding) {
            if (target) {
              calls.set(`${target}#${hookName}`, { name: hookName, module: target });
              if (withinComposition(target)) {
                followExport(target, binding.name === '*' ? hookName : binding.name, depth + 1);
              }
            }
          } else {
            walkCallable(file, callable(file, symbol?.valueDeclaration), depth + 1);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(fn.body, visit);
  }

  const hasDefault = load(entryFile).source.statements.some((statement) =>
    ts.isExportAssignment(statement) ||
    (ts.isFunctionDeclaration(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) ||
    (ts.isExportDeclaration(statement) && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.some((binding) => binding.name.text === 'default')));
  // Shared filter surfaces such as InboxBody are named exports. Prefer a real
  // default entry so an unrelated same-named export cannot lend it ownership.
  followExport(entryFile, hasDefault ? 'default' : path.basename(entryFile).replace(/\.[^.]+$/, ''), 0);
  return [...calls.values()];
}
