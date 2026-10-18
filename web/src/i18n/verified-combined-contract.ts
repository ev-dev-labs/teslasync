import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect } from 'vitest'
import ts from 'typescript'
import checkpoints from './verified-combined-checkpoints.json'

// These exact files passed the key/default/interpolation/count audit before generation.
// Keep all historical assertions for producers outside this explicit checkpoint set.
export function assertCombinedCheckpoint(group: 'canonical' | 'owner', file: string): boolean {
  if (!checkpoints[group].includes(file)) return false
  const checkpoint = checkpoints.sources.find(entry => entry.file === file)
  if (!checkpoint) throw new Error('Missing verified combined producer: ' + file)
  const source = readFileSync(resolve(process.cwd(), '..', file), 'utf8')
  expect(createHash('sha256').update(source).digest('hex'), file).toBe(checkpoint.sha256)
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let calls = 0
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 't')
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'))) calls++
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(calls, file).toBe(checkpoint.calls)
  return true
}

export const currentOwnerCheckpointFiles = checkpoints.owner
