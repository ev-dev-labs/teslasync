import { basename, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

function assetNamesFromTags(html, tagPattern, relationPattern) {
  const names = new Set()
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0]
    if (!relationPattern.test(tag)) continue
    const source = tag.match(/\b(?:src|href)=["']([^"']+\.js)["']/i)?.[1]
    if (source) names.add(basename(source))
  }
  return names
}

export function findEntryAssetNames(distDir) {
  const indexPath = join(distDir, 'index.html')
  if (!existsSync(indexPath)) return new Set()
  const html = readFileSync(indexPath, 'utf8')
  return assetNamesFromTags(
    html,
    /<script\b[^>]*>/gi,
    /\btype=["']module["']/i,
  )
}

export function findModulePreloadAssetNames(distDir) {
  const indexPath = join(distDir, 'index.html')
  if (!existsSync(indexPath)) return new Set()
  const html = readFileSync(indexPath, 'utf8')
  return assetNamesFromTags(
    html,
    /<link\b[^>]*>/gi,
    /\brel=["']modulepreload["']/i,
  )
}
