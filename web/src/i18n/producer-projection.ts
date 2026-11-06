import { createHash } from 'node:crypto'
import ts from 'typescript'

export type ProducerProjection = {
  bindings: string[]
  calls: { call: string; controls: string[] }[]
}

// Preserve actual translation calls, bindings, and enclosing controls independently of presentation.
export function producerProjection(file: string, text: string): ProducerProjection {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  const print = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, tree).trim()
  const projection: ProducerProjection = { bindings: [], calls: [] }
  const controls = (call: ts.CallExpression): string[] => {
    const result: string[] = []
    let child: ts.Node = call
    for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isIfStatement(parent)) {
        result.push(`if:${print(parent.expression)}:${child === parent.thenStatement ? 'then' : child === parent.elseStatement ? 'else' : 'condition'}`)
      } else if (ts.isConditionalExpression(parent)) {
        result.push(`conditional:${print(parent.condition)}:${child === parent.whenTrue ? 'true' : child === parent.whenFalse ? 'false' : 'condition'}`)
      } else if (ts.isBinaryExpression(parent)
        && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) {
        result.push(`binary:${ts.tokenToString(parent.operatorToken.kind)}:${child === parent.right ? print(parent.left) : 'left'}`)
      } else if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) {
        result.push(`parameters:${parent.parameters.map(print).join(', ')}`)
      }
    }
    return result
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && ['react-i18next', 'i18next'].includes(node.moduleSpecifier.text)) {
      projection.bindings.push(print(node))
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && ['useTranslation', 'getFixedT', 'useUnits', 'useNumberFormatting'].includes(node.initializer.expression.text)) {
      projection.bindings.push(print(node))
    }
    if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === 't'
      || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't')) {
      projection.calls.push({ call: print(node), controls: controls(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return projection
}

export function projectionDigest(projection: ProducerProjection): string {
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex')
}
