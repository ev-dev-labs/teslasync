import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', '.vitepress', 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const domain = readFileSync(join(dist, 'CNAME'), 'utf8').trim()
if (domain !== 'teslasync.dev') {
  throw new Error(`Expected teslasync.dev in the Pages artifact CNAME, got ${domain}`)
}

const urls = [...html.matchAll(/\b(?:src|href)="(\/(?:assets\/|hero\/|screenshots\/|logo\.svg|vp-icons\.css)[^"]*)"/g)]
  .map((match) => match[1])

if (!urls.some((url) => url.startsWith('/assets/style.')) ||
    !urls.some((url) => url.startsWith('/assets/app.')) ||
    !urls.some((url) => url.startsWith('/hero/model3.jpg'))) {
  throw new Error('The homepage must reference root-relative CSS, JS, and hero assets')
}
if (/\/teslasync\/(?:assets|hero|screenshots)\//.test(html)) {
  throw new Error('Project-path assets cannot load on the root-domain teslasync.dev')
}

for (const url of urls) {
  const pathname = new URL(url, 'https://teslasync.dev').pathname
  if (!existsSync(join(dist, pathname.slice(1)))) {
    throw new Error(`Referenced Pages asset is missing: ${url}`)
  }
}

for (const name of ['automations', 'catalogue', 'appearance']) {
  for (const theme of ['light', 'dark']) {
    const screenshot = `screenshots/current-${name}-red-${theme}.png`
    if (!existsSync(join(dist, screenshot))) {
      throw new Error(`Homepage screenshot is missing: ${screenshot}`)
    }
  }
}

console.log(`Verified ${urls.length} root-relative asset references, six screenshots, and ${domain} CNAME`)
