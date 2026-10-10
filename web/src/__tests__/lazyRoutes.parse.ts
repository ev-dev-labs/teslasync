import ts from 'typescript'

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

export function lazyBindings(source: string): Array<{ name: string; specifier: string }> {
  const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const bindings: Array<{ name: string; specifier: string }> = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'lazy') {
      let binding: ts.Node = node
      while (!ts.isVariableDeclaration(binding) && binding.parent) binding = binding.parent
      const imports = importsIn(node)
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
