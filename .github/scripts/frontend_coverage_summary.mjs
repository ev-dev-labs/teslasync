#!/usr/bin/env node
/**
 * Extensive GitHub Actions job summary from Vitest JSON + Istanbul
 * coverage-summary.json. Leads with failing tests so a newly red spec
 * is visible on the job page without opening logs.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function pct(covered, total) {
  if (!total) return 100
  return (100 * covered) / total
}

function fmtPct(n) {
  return `${Number(n).toFixed(1)}%`
}

function mdTable(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ]
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`)
  return lines
}

function relSrc(filePath) {
  const norm = String(filePath).replaceAll('\\', '/')
  const idx = norm.lastIndexOf('/src/')
  if (idx >= 0) return norm.slice(idx + 1)
  if (norm.startsWith('src/')) return norm
  return norm
}

function areaOf(rel) {
  const parts = rel.split('/')
  if (parts[0] !== 'src') return 'other'
  if (parts[1] === 'features' && parts[2]) return `features/${parts[2]}`
  if (parts[1] === 'components' && parts[2]) return `components/${parts[2]}`
  if (parts[1]) return parts[1]
  return 'src'
}

function band(p) {
  if (p >= 100) return '100%'
  if (p >= 80) return '80–99%'
  if (p >= 50) return '50–79%'
  if (p > 0) return '1–49%'
  return '0%'
}

function collectVitest(results) {
  const failed = []
  const slow = []
  let passed = 0
  let skipped = 0
  if (!results) {
    return { failed, slow, passed, skipped, numTotal: 0, success: true }
  }

  const files = Array.isArray(results.testResults) ? results.testResults : []
  for (const file of files) {
    const fileName = relSrc(file.name || file.file || '')
    const assertions = file.assertionResults || []
    for (const a of assertions) {
      const title = (a.fullName || a.title || a.name || '').trim() || '(unnamed)'
      const status = a.status || file.status
      const dur = Number(a.duration || 0)
      if (status === 'failed' || status === 'fail') {
        failed.push({
          title,
          file: fileName,
          message: (a.failureMessages || []).join('\n').slice(0, 4000),
        })
      } else if (status === 'pending' || status === 'skipped' || status === 'todo') {
        skipped += 1
      } else {
        passed += 1
      }
      if (dur) slow.push({ dur, title, file: fileName })
    }
  }
  slow.sort((a, b) => b.dur - a.dur)
  return {
    failed,
    slow: slow.slice(0, 15),
    passed,
    skipped,
    numTotal: Number(results.numTotalTests || passed + skipped + failed.length),
    success: results.success !== false && failed.length === 0,
  }
}

function collectCoverage(summary) {
  const files = []
  let total = null
  if (!summary || typeof summary !== 'object') return { files, total }
  for (const [key, val] of Object.entries(summary)) {
    if (!val || typeof val !== 'object') continue
    if (key === 'total') {
      total = val
      continue
    }
    files.push({
      file: relSrc(key),
      lines: val.lines || { total: 0, covered: 0, pct: 0 },
      statements: val.statements || { total: 0, covered: 0, pct: 0 },
      functions: val.functions || { total: 0, covered: 0, pct: 0 },
      branches: val.branches || { total: 0, covered: 0, pct: 0 },
    })
  }
  return { files, total }
}

function render({ tests, coverage }) {
  const lines = []
  lines.push('## Frontend tests')
  lines.push('')

  if (tests.failed.length) {
    lines.push('### Failures — start here')
    lines.push('')
    lines.push(
      `**${tests.failed.length} test(s)** failed. New red specs show up in this section on the next run.`,
    )
    lines.push('')
    lines.push(
      ...mdTable(
        ['Test', 'File'],
        tests.failed.slice(0, 80).map((f) => [`\`${f.title.replaceAll('|', '\\|')}\``, `\`${f.file}\``]),
      ),
    )
    lines.push('')
    let shown = 0
    for (const f of tests.failed) {
      if (!f.message) continue
      lines.push(`<details><summary>Log: \`${f.title.replaceAll('`', "'")}\`</summary>`)
      lines.push('')
      lines.push('```')
      lines.push(f.message)
      lines.push('```')
      lines.push('</details>')
      lines.push('')
      shown += 1
      if (shown >= 12) break
    }
  } else {
    lines.push(
      `**All reported tests passed** (${tests.passed} pass, ${tests.skipped} skip).`,
    )
    lines.push('')
  }

  lines.push('| Result | Count |')
  lines.push('| --- | ---: |')
  lines.push(`| Fail | ${tests.failed.length} |`)
  lines.push(`| Pass | ${tests.passed} |`)
  lines.push(`| Skip | ${tests.skipped} |`)
  lines.push(`| Total | ${tests.numTotal || tests.passed + tests.skipped + tests.failed.length} |`)
  lines.push('')

  if (tests.slow.length) {
    lines.push('<details><summary>Slowest tests</summary>')
    lines.push('')
    lines.push(
      ...mdTable(
        ['ms', 'Test', 'File'],
        tests.slow.map((s) => [
          String(Math.round(s.dur)),
          `\`${s.title.replaceAll('|', '\\|')}\``,
          `\`${s.file}\``,
        ]),
      ),
    )
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  const { files, total } = coverage
  lines.push('## Frontend coverage')
  lines.push('')
  if (!total && files.length === 0) {
    lines.push('_No coverage summary was produced for this run._')
    lines.push('')
    return `${lines.join('\n').replace(/\n+$/, '')}\n`
  }
  if (total) {
    lines.push('| Metric | Covered | Total | % |')
    lines.push('| --- | ---: | ---: | ---: |')
    for (const k of ['statements', 'branches', 'functions', 'lines']) {
      const m = total[k] || { covered: 0, total: 0, pct: 0 }
      lines.push(`| ${k} | ${m.covered} | ${m.total} | ${fmtPct(m.pct)} |`)
    }
    lines.push('')
  }
  lines.push(
    'Lowest files first. Browsable HTML is on the **frontend-coverage** artifact (`coverage/index.html`).',
  )
  lines.push('')

  const bandCounts = new Map()
  const areas = new Map()
  for (const f of files) {
    const p = Number(f.lines.pct) || pct(f.lines.covered, f.lines.total)
    const b = band(p)
    const cur = bandCounts.get(b) || { files: 0, lines: 0 }
    cur.files += 1
    cur.lines += f.lines.total || 0
    bandCounts.set(b, cur)
    const area = areaOf(f.file)
    const a = areas.get(area) || { covered: 0, total: 0 }
    a.covered += f.lines.covered || 0
    a.total += f.lines.total || 0
    areas.set(area, a)
  }

  const bandOrder = ['0%', '1–49%', '50–79%', '80–99%', '100%']
  const bandRows = bandOrder
    .filter((b) => bandCounts.has(b))
    .map((b) => [b, String(bandCounts.get(b).files), String(bandCounts.get(b).lines)])
  if (bandRows.length) {
    lines.push('### File coverage bands')
    lines.push('')
    lines.push(...mdTable(['Band', 'Files', 'Lines'], bandRows))
    lines.push('')
  }

  const areaRows = [...areas.entries()]
    .map(([name, v]) => ({
      name,
      pct: pct(v.covered, v.total),
      covered: v.covered,
      total: v.total,
      missed: v.total - v.covered,
    }))
    .sort((a, b) => a.pct - b.pct || b.missed - a.missed)
  if (areaRows.length) {
    lines.push('### Coverage by area')
    lines.push('')
    lines.push(
      ...mdTable(
        ['Area', 'Covered', 'Hit', 'Lines', 'Missed'],
        areaRows.map((a) => [
          `\`${a.name}\``,
          fmtPct(a.pct),
          String(a.covered),
          String(a.total),
          String(a.missed),
        ]),
      ),
    )
    lines.push('')
  }

  const lowest = [...files]
    .filter((f) => (f.lines.total || 0) > 0 && Number(f.lines.pct) < 100)
    .sort((a, b) => {
      const pa = Number(a.lines.pct)
      const pb = Number(b.lines.pct)
      const ma = (a.lines.total || 0) - (a.lines.covered || 0)
      const mb = (b.lines.total || 0) - (b.lines.covered || 0)
      return pa - pb || mb - ma
    })
    .slice(0, 40)
  if (lowest.length) {
    lines.push('### Lowest files (actionable)')
    lines.push('')
    lines.push(
      ...mdTable(
        ['Lines', 'Branches', 'Missed', 'File'],
        lowest.map((f) => [
          fmtPct(f.lines.pct),
          fmtPct(f.branches.pct),
          String((f.lines.total || 0) - (f.lines.covered || 0)),
          `\`${f.file}\``,
        ]),
      ),
    )
    lines.push('')
  }

  const zero = files.filter((f) => (f.lines.total || 0) > 0 && (f.lines.covered || 0) === 0)
  if (zero.length) {
    lines.push(`<details><summary>Zero-coverage files (${zero.length})</summary>`)
    lines.push('')
    for (const f of zero.slice(0, 80)) lines.push(`- \`${f.file}\``)
    if (zero.length > 80) lines.push(`- …and ${zero.length - 80} more`)
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

function selfTest() {
  const tests = collectVitest({
    numTotalTests: 3,
    success: false,
    testResults: [
      {
        name: '/repo/web/src/components/ai/Foo.test.tsx',
        assertionResults: [
          {
            fullName: 'Foo fails loudly',
            status: 'failed',
            duration: 12,
            failureMessages: ['expected true to be false'],
          },
          { fullName: 'Foo ok', status: 'passed', duration: 4 },
        ],
      },
    ],
  })
  const coverage = collectCoverage({
    total: {
      statements: { covered: 8, total: 10, pct: 80 },
      branches: { covered: 3, total: 5, pct: 60 },
      functions: { covered: 2, total: 2, pct: 100 },
      lines: { covered: 8, total: 10, pct: 80 },
    },
    '/repo/web/src/features/driving/pages/DrivePage.tsx': {
      lines: { covered: 1, total: 10, pct: 10 },
      statements: { covered: 1, total: 10, pct: 10 },
      functions: { covered: 0, total: 2, pct: 0 },
      branches: { covered: 0, total: 4, pct: 0 },
    },
    '/repo/web/src/lib/cn.ts': {
      lines: { covered: 7, total: 7, pct: 100 },
      statements: { covered: 7, total: 7, pct: 100 },
      functions: { covered: 1, total: 1, pct: 100 },
      branches: { covered: 2, total: 2, pct: 100 },
    },
  })
  const md = render({ tests, coverage })
  if (!md.includes('Failures — start here')) throw new Error('missing failures heading')
  if (!md.includes('Foo fails loudly')) throw new Error('missing failed test')
  if (!md.includes('features/driving')) throw new Error('missing area rollup')
  if (!md.includes('Lowest files')) throw new Error('missing lowest files')
  console.log('frontend_coverage_summary self-test OK')
}

function parseArgs(argv) {
  const out = {
    summaryJson: '',
    vitestJson: '',
    stepSummary: '',
    markdownOut: '',
    selfTest: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--self-test') out.selfTest = true
    else if (a === '--summary-json' && next) {
      out.summaryJson = next
      i += 1
    } else if (a === '--vitest-json' && next) {
      out.vitestJson = next
      i += 1
    } else if (a === '--step-summary' && next) {
      out.stepSummary = next
      i += 1
    } else if (a === '--markdown-out' && next) {
      out.markdownOut = next
      i += 1
    }
  }
  return out
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.selfTest) {
    selfTest()
    return 0
  }
  const tests = collectVitest(readJson(args.vitestJson))
  const coverage = collectCoverage(readJson(args.summaryJson))
  const md = render({ tests, coverage })
  if (args.markdownOut) fs.writeFileSync(args.markdownOut, md)
  if (args.stepSummary) fs.appendFileSync(args.stepSummary, md)
  if (!args.markdownOut && !args.stepSummary) process.stdout.write(md)
  return 0
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  process.exit(main(process.argv.slice(2)))
}
