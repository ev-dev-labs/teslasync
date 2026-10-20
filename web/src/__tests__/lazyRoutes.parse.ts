import ts from 'typescript'
import { posix } from 'node:path'

function importsIn(node: ts.Node): string[] {
  const imports: string[] = []
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = child.arguments[0]
      if (!specifier || !ts.isStringLiteralLike(specifier)) {
        throw new Error('Lazy loaders must use a static import specifier')
      }
      imports.push(specifier.text)
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return imports
}

export function sharedLoaderSpecifiers(source: string): Map<string, string> {
  const file = ts.createSourceFile('routeLoaders.ts', source, ts.ScriptTarget.Latest, true)
  const loaders = new Map<string, string>()
  const modules = new Set<string>()
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)
      || !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
      || !(statement.declarationList.flags & ts.NodeFlags.Const)) {
      throw new Error('Shared loaders must be exported const literal-import functions')
    }
    for (const declaration of statement.declarationList.declarations) {
      const loader = declaration.initializer
      if (!ts.isIdentifier(declaration.name) || !loader || !ts.isArrowFunction(loader)
        || loader.parameters.length !== 0 || !ts.isCallExpression(loader.body)
        || loader.body.expression.kind !== ts.SyntaxKind.ImportKeyword
        || loader.body.arguments.length !== 1) {
        throw new Error('Shared loaders must be zero-argument literal-import functions')
      }
      const imports = importsIn(loader)
      if (imports.length !== 1) throw new Error('Every shared loader must have exactly one static import')
      const name = declaration.name.text
      if (loaders.has(name) || modules.has(imports[0])) {
        throw new Error('Ambiguous shared loader export or module')
      }
      loaders.set(name, imports[0])
      modules.add(imports[0])
    }
  }
  if (loaders.size === 0) throw new Error('Shared loader source must not be empty')
  return loaders
}

export function lazyBindings(
  source: string,
  sharedSources: Readonly<Record<string, string>> = {},
): Array<{ name: string; specifier: string }> {
  const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const bindings: Array<{ name: string; specifier: string }> = []
  const namespaces = new Map<string, { module: string; loaders: Map<string, string> }>()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamespaceImport(clause.namedBindings)) continue
    const module = statement.moduleSpecifier.text
    if (!Object.prototype.hasOwnProperty.call(sharedSources, module)) continue
    const name = clause.namedBindings.name.text
    if (namespaces.has(name)) throw new Error('Ambiguous shared loader namespace')
    namespaces.set(name, { module, loaders: sharedLoaderSpecifiers(sharedSources[module]) })
  }
  const checkShadowing = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)
      || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name && ts.isIdentifier(node.name) && namespaces.has(node.name.text)) {
      throw new Error('Ambiguous shadowed shared loader namespace')
    }
    ts.forEachChild(node, checkShadowing)
  }
  checkShadowing(file)
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'lazy') {
      let binding: ts.Node = node
      while (!ts.isVariableDeclaration(binding) && binding.parent) binding = binding.parent
      if (node.arguments.length !== 1) throw new Error('Every lazy call must have exactly one loader')
      const loader = node.arguments[0]
      let imports: string[]
      if (ts.isPropertyAccessExpression(loader) && ts.isIdentifier(loader.expression)) {
        const namespace = namespaces.get(loader.expression.text)
        const specifier = namespace?.loaders.get(loader.name.text)
        if (!namespace || !specifier) throw new Error('Unknown shared loader reference')
        const resolved = posix.normalize(posix.join(posix.dirname(namespace.module), specifier))
        imports = [resolved.startsWith('.') || resolved.startsWith('@/') ? resolved : `./${resolved}`]
      } else {
        if (!ts.isArrowFunction(loader) && !ts.isFunctionExpression(loader)) {
          throw new Error('Lazy loaders must be literal-import functions or known shared references')
        }
        imports = importsIn(node)
      }
      if (!ts.isVariableDeclaration(binding) || !ts.isIdentifier(binding.name) || imports.length !== 1) {
        throw new Error('Every lazy call must have a named binding and exactly one static import')
      }
      bindings.push({ name: binding.name.text, specifier: imports[0] })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return bindings
}

export function manifestSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('lazyRoutes.list.ts', source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'load') {
      const imports = importsIn(node.initializer)
      if (imports.length !== 1) throw new Error('Every manifest loader must have exactly one static import')
      specifiers.push(imports[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return specifiers
}
