import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

export function resolveSourceImport(sourceRoot, file, specifier) {
  const base = specifier.startsWith('@/')
    ? join(sourceRoot, specifier.slice(2))
    : specifier.startsWith('.')
    ? resolve(dirname(file), specifier)
    : null
  if (!base) return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

export function runtimeModuleSpecifiers(sourceText, fileName = 'fixture.ts') {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  )
  const specifiers = new Set()
  for (const statement of source.statements) {
    let specifier
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      const hasRuntimeBinding = !clause
        || (!clause.isTypeOnly
          && (!clause.namedBindings
            || ts.isNamespaceImport(clause.namedBindings)
            || clause.namedBindings.elements.some((element) => !element.isTypeOnly)
            || clause.name !== undefined))
      if (hasRuntimeBinding) specifier = statement.moduleSpecifier
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      const hasRuntimeBinding = !statement.isTypeOnly
        && (!clause
          || ts.isNamespaceExport(clause)
          || (ts.isNamedExports(clause) && clause.elements.some((element) => !element.isTypeOnly)))
      if (hasRuntimeBinding) specifier = statement.moduleSpecifier
    }
    if (specifier && ts.isStringLiteral(specifier)) {
      specifiers.add(specifier.text)
    }
  }
  return specifiers
}

export function staticDependencies(sourceRoot, file) {
  const dependencies = new Set()
  for (const specifier of runtimeModuleSpecifiers(readFileSync(file, 'utf8'), file)) {
    const dependency = resolveSourceImport(sourceRoot, file, specifier)
    if (dependency) dependencies.add(dependency)
  }
  return dependencies
}

export function staticClosure(sourceRoot, roots) {
  const files = new Set()
  const pending = roots.filter((file) => existsSync(file))
  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || files.has(file)) continue
    files.add(file)
    for (const dependency of staticDependencies(sourceRoot, file)) {
      if (!files.has(dependency)) pending.push(dependency)
    }
  }
  return files
}

export function translationKeys(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const keys = new Set()
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 't'
      && node.arguments.length > 0
    ) {
      const key = node.arguments[0]
      if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
        if (key.text.includes('.')) keys.add(key.text)
      }
    }
    if (
      ts.isJsxAttribute(node)
      && node.name.text === 'i18nKey'
      && node.initializer
      && ts.isStringLiteral(node.initializer)
      && node.initializer.text.includes('.')
    ) {
      keys.add(node.initializer.text)
    }
    if (
      ts.isPropertyAssignment(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'i18nKey'
      && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
      && node.initializer.text.includes('.')
    ) {
      keys.add(node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return keys
}

export function translationNamespaces(file) {
  return new Set([...translationKeys(file)].map((key) => key.split('.')[0]))
}
