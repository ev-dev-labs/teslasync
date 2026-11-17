import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFileSync, createWriteStream, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { finished, pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../web/', import.meta.url));
const cli = join(web, 'node_modules', 'playwright', 'cli.js');
const designPattern = String.raw`widget-design-packs\.(app|energy|native)\.spec\.ts`;
const successMetadataSuffix = ' [successful binary metadata]';
const measuredDurations = JSON.parse(readFileSync(new URL('./playwright-test-durations.json', import.meta.url), 'utf8'));
assert.equal(measuredDurations.version, 1);
assert.equal(measuredDurations.unit, 'seconds');

// Merge Windows blobs on Linux without retaining the source runner's root.
export default { testDir: join(web, 'e2e') };

// Median seconds in the three CI-PERF samples, across themes. Column order:
// Chromium desktop/phone, Firefox desktop/phone, WebKit desktop/phone.
const phases = {
  'real-route /': [143.2, 39.9, 90.4, 44.9, 192.3, 59.3],
  'real-route /drives': [89.5, 41.9, 57.5, 43.6, 120.8, 61.5],
  'real-route /battery-cells': [145, 146.9, 151.1, 117.7, 348.4, 237.5],
  'real-route /charging-heatmap?from=2026-11-10&to=2026-11-10': [190.4, 317.4, 135.5, 114, 571.1, 466.1],
  'real-route /signal-mutual-information': [81.8, 75.2, 77.2, 57.2, 220.4, 117],
  'real-route /energy-flow?from=2025-03-01&to=2025-03-07': [149, 121.5, 153.7, 127.7, 354.9, 215.3],
  'real-route /drives/412': [182.4, 124.7, 145.5, 97.7, 288.4, 172],
  'real-route /drives/412/replay': [100.9, 87.4, 101.8, 74.5, 259.5, 152.2],
  'real-route /live': [107, 89.4, 97.1, 73.7, 221.9, 109.1],
  'real-route /chatbot': [86.4, 100.5, 90.2, 84, 182.1, 145.8],
  'real-route /statistics': [66.4, 60.3, 62.9, 51.7, 128.6, 78.8],
  'real-route /geofences': [78.6, 72.1, 68.7, 58.3, 156.2, 91.7],
  'real-route /settings': [38, 36.4, 39.7, 34, 72.7, 48.2],
  'core interactions': [395.9, 471, 278.6, 248.5, 906.9, 717.7],
  'core native-retained-quantitative': [274.1, 297, 231.9, 196.5, 286.9, 214.9],
  'core accessibility-media-screens': [534.8, 614.7, 296.8, 249.9, 698.1, 541],
  'responsive 320px': [0, 460.9, 0, 233.3, 0, 573.7],
  'responsive 375px': [0, 448.7, 0, 234.8, 0, 579.6],
  'responsive 390px': [0, 432.8, 0, 238.7, 0, 586.3],
  'responsive 430px': [0, 422.4, 0, 252.9, 0, 631.3],
  'responsive 768px': [424.7, 0, 296.8, 0, 765.4, 0],
  'responsive 1024px': [434.5, 0, 283, 0, 768.7, 0],
  'responsive 1280px': [409.9, 0, 273.7, 0, 713.9, 0],
  'responsive 1440px': [462.8, 0, 277.5, 0, 761.3, 0],
  'responsive 1920px': [422, 0, 288.4, 0, 836, 0],
  'responsive 2560px': [486.8, 0, 291.1, 0, 871.2, 0],
  'mixed-pack isolation': [49.7, 50.2, 43.9, 41.5, 153.3, 72.9],
};

export function estimate(test) {
  const measured = measuredDurations.durations[test.key];
  if (measured) return measured[0];
  const phase = test.title.split(' — phase ')[1];
  const column = (test.project === 'app-design-webkit' ? 4 : test.project === 'app-design-firefox' ? 2 : 0)
    + (test.title.includes('at 390px in') ? 1 : 0);
  if (phases[phase]?.[column]) return phases[phase][column];
  if (!phase && test.file.endsWith('widget-design-packs.app.spec.ts')) {
    if (test.project === 'app-design-firefox') return 12;
    if (test.project === 'app-design-webkit') return 27.4;
  }
  if (test.title.startsWith('Native record-states real routes')) return 1099.3;
  if (test.title.startsWith('Native progress-states real routes')) return 767.3;
  if (test.title.startsWith('Native records real routes')) return 547.8;
  if (test.title.startsWith('Native progress real routes')) return 376.9;
  if (test.title.startsWith('Energy flow real source states')) return 847.1;
  if (test.title.startsWith('Native compact signal coverage')) return 335.7;
  return /widget-design-packs\.(app|energy|native)\.spec\.ts$/.test(test.file) ? 120 : 10;
}

export function inventory(report) {
  const tests = [];
  function visit(suites, parents = []) {
    for (const suite of suites ?? []) {
      const path = suite.file && !parents.length && suite.title.replaceAll('\\', '/') === suite.file.replaceAll('\\', '/')
        ? parents : [...parents, suite.title];
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const item = { project: test.projectName, file: spec.file.replaceAll('\\', '/'), path, title: spec.title };
          item.key = JSON.stringify([item.project, item.file, ...path, item.title]);
          tests.push(item);
        }
      }
      visit(suite.suites, path);
    }
  }
  visit(report.suites);
  assert.ok(tests.length, 'Empty Playwright discovery/report');
  assert.equal(new Set(tests.map(test => test.key)).size, tests.length, 'Duplicate fully-qualified tests');
  return tests;
}

export function resultInventory(report) {
  function visit(suites) {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          assert.ok(Array.isArray(test.results) && test.results.length > 0,
            `Missing actual test outcomes: ${test.projectName} / ${spec.title}`);
          for (const result of test.results) {
            assert.ok(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(result.status),
              `Invalid actual test outcome: ${test.projectName} / ${spec.title}`);
          }
        }
      }
      visit(suite.suites);
    }
  }
  visit(report.suites);
  return inventory(report);
}

export function balance(tests, count) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= tests.length, 'Invalid/nonempty shard count');
  const shards = Array.from({ length: count }, () => ({ seconds: 0, tests: [] }));
  for (const test of [...tests].sort((a, b) => estimate(b) - estimate(a) || a.key.localeCompare(b.key))) {
    const target = shards.reduce((best, shard) => shard.seconds < best.seconds
      || (shard.seconds === best.seconds && shard.tests.length < best.tests.length) ? shard : best);
    target.tests.push(test);
    target.seconds += estimate(test);
  }
  assertUnion(tests, shards.flatMap(shard => shard.tests));
  return shards;
}

export function assertUnion(full, pieces) {
  assert.deepEqual(pieces.map(test => test.key).sort(), full.map(test => test.key).sort(),
    'Lost, duplicated or unexpected tests in shard multiset union');
}

function invoke(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: web, env: { ...process.env, E2E_APP_DESIGN_CROSS_BROWSER: '1' },
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Playwright ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

export function suiteOptions(suite, browser, width, theme) {
  const quality = ['--project=chromium-*-*', '--project=chromium-smoke'];
  if (suite === 'ordinary') return { script: 'e2e:quality', args: [...quality, `--grep-invert=${designPattern}`], workers: 2 };
  if (suite === 'design') return { script: 'e2e:quality', args: [...quality, `--grep=${designPattern}`], workers: 4 };
  if (suite === 'a11y') return { script: 'e2e:a11y', args: ['--project=chromium-a11y', '--fully-parallel'], workers: 1 };
  if (suite === 'performance') return { script: 'e2e:performance', args: ['--project=chromium-performance'], workers: 1 };
  if (suite === 'visual') return { script: 'e2e:visual', args: ['--config=playwright.visual.config.ts'], workers: 2 };
  assert.ok(['firefox', 'webkit', 'edge'].includes(browser), 'Unknown browser');
  if (suite === 'engine') return { script: 'e2e', args: [`--project=${browser}-smoke`], workers: 2 };
  assert.ok(['firefox', 'webkit'].includes(browser), 'Unknown design engine');
  const args = ['widget-design-packs.app.spec.ts', `--project=app-design-${browser}`];
  if (suite === 'replay') return { script: 'e2e', args: [...args, '--grep-invert=Application design languages at'], workers: browser === 'webkit' ? 1 : 4 };
  assert.equal(suite, 'profile');
  assert.ok([1440, 390].includes(Number(width)) && ['dark', 'light', 'custom'].includes(theme), 'Unknown profile');
  return {
    script: 'e2e', args: [...args, `--grep=Application design languages at ${width}px in ${theme}`],
    workers: browser === 'webkit' ? Number(width) === 1440 ? 1 : 2 : 4,
  };
}

function discover(args) {
  return JSON.parse(invoke(['test', ...args, '--list', '--reporter=json'], {
    env: { ...process.env, CI: '1', E2E_APP_DESIGN_CROSS_BROWSER: '1', E2E_SKIP_WEBSERVER: '1' },
  }));
}

function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
}

function compact(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const attachment of value.attachments ?? []) {
      if (attachment.body) {
        const bytes = Buffer.from(attachment.body, 'base64');
        if (attachment.name.endsWith(successMetadataSuffix) && attachment.contentType === 'application/json') {
          attachment.successEvidence = JSON.parse(bytes.toString('utf8'));
        }
        attachment.bodySHA256 = createHash('sha256').update(bytes).digest('hex');
        attachment.bodyBytes = bytes.length;
        delete attachment.body;
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(report);
  save(path, report);
  return report;
}

export function groupName(suite, browser, width, theme) {
  return [suite, ...(['profile', 'engine', 'replay'].includes(suite) ? [browser] : []),
    ...(suite === 'profile' ? [width, theme] : [])].join('-');
}

function plan(options) {
  const { suite, browser, width, theme } = options;
  const [index, count] = (options.shard ?? '1/1').split('/').map(Number);
  const settings = suiteOptions(suite, browser, width, theme);
  const full = inventory(discover(settings.args));
  if (suite === 'profile') {
    assert.equal(full.length, Number(width) === 1440 ? 23 : 21, 'Incomplete full profile registration');
    assert.ok(full.every(test => test.project === `app-design-${browser}`
      && test.title.startsWith(`Application design languages at ${width}px in ${theme} — phase `)));
  }
  const shards = balance(full, count);
  assert.ok(index >= 1 && index <= count, 'Invalid shard index');
  const out = resolve(options.out ?? 'ci-evidence');
  const selected = shards[index - 1].tests;
  const list = join(out, 'tests.txt');
  for (const test of selected) assert.ok(![test.project, test.file, ...test.path, test.title].some(value => /[›\r\n]/.test(value)), 'Ambiguous test-list title');
  save(list, selected.map(test => `[${test.project}] › ${test.file} › ${[...test.path, test.title].join(' › ')}`).join('\n') + '\n');
  const actual = inventory(discover([...settings.args, `--test-list=${list}`]));
  assertUnion(selected, actual);
  const data = {
    group: groupName(suite, browser, width, theme), index, count, full, selected,
    seconds: shards[index - 1].seconds, settings, sourceSHA: process.env.GITHUB_SHA ?? null,
    measuredCases: full.filter(test => Object.hasOwn(measuredDurations.durations, test.key)).length,
    unmeasured: full.filter(test => !Object.hasOwn(measuredDurations.durations, test.key))
      .map(test => ({ key: test.key, fallbackSeconds: estimate(test) })),
  };
  save(join(out, 'plan.json'), data);
  console.log(`${data.group} ${index}/${count}: ${selected.length}/${full.length} tests; estimated serial work ${data.seconds.toFixed(1)}s; workers ${settings.workers}; measured ${data.measuredCases}; unmeasured ${data.unmeasured.length}; actual --list matches`);
  return { data, out, list };
}

export async function compactBlob(path) {
  const { yauzl, yazl } = createRequire(join(web, 'package.json'))('playwright-core/lib/utilsBundle');
  const archive = await new Promise((accept, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, zip) => error ? reject(error) : accept(zip));
  });
  const jsonlPath = `${path}.compact.jsonl`;
  const zipPath = `${path}.compact.zip`;
  const close = async () => {
    if (!archive.isOpen) return;
    const closed = once(archive, 'close');
    archive.close();
    await closed;
  };
  try {
    const entries = new Map();
    const indexed = once(archive, 'end');
    archive.on('entry', entry => {
      entries.set(entry.fileName, entry);
      archive.readEntry();
    });
    archive.readEntry();
    await indexed;
    assert.ok(entries.has('report.jsonl'), 'Missing native blob report.jsonl');
    const stream = entry => new Promise((accept, reject) => {
      archive.openReadStream(entry, (error, input) => error ? reject(error) : accept(input));
    });
    const lines = async () => createInterface({ input: await stream(entries.get('report.jsonl')), crlfDelay: Infinity });
    const eligible = new Map();
    let ended = false;
    for await (const line of await lines()) {
      const event = JSON.parse(line);
      if (event.method === 'onEnd') ended = true;
      if (event.method !== 'onTestEnd') continue;
      const { test, result } = event.params;
      const passed = test.expectedStatus === 'passed' && result.status === 'passed' && !result.errors.length;
      eligible.set(test.testId, (eligible.get(test.testId) ?? true) && passed);
    }
    assert.ok(ended, 'Incomplete native blob stream');
    const candidates = new Set();
    const referenced = new Set();
    let compacted = 0;
    let originalBytes = 0;
    const output = createWriteStream(jsonlPath);
    const written = finished(output);
    function references(value) {
      if (typeof value === 'string' && entries.has(value)) referenced.add(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(references);
    }
    try {
      for await (const line of await lines()) {
        const event = JSON.parse(line);
        let changed = false;
        if (event.method === 'onAttach' && eligible.get(event.params.testId)) {
          for (const attachment of event.params.attachments) {
            if (!/^(image\/|video\/|application\/(?:zip|octet-stream)$|text\/html$)/.test(attachment.contentType)) continue;
            const hash = createHash('sha256');
            let bytes = 0;
            if (typeof attachment.base64 === 'string') {
              const buffer = Buffer.from(attachment.base64, 'base64');
              hash.update(buffer);
              bytes = buffer.length;
            } else if (attachment.path) {
              assert.ok(entries.has(attachment.path), `Missing blob resource: ${attachment.path}`);
              for await (const chunk of await stream(entries.get(attachment.path))) {
                hash.update(chunk);
                bytes += chunk.length;
              }
            } else {
              continue;
            }
            const metadata = {
              retained: 'successful binary attachment metadata; failed/flaky resources remain original',
              originalName: attachment.name, originalContentType: attachment.contentType,
              originalPath: attachment.path, bytes, sha256: hash.digest('hex'),
            };
            if (attachment.path) candidates.add(attachment.path);
            delete attachment.path;
            attachment.name += successMetadataSuffix;
            attachment.contentType = 'application/json';
            attachment.base64 = Buffer.from(JSON.stringify(metadata)).toString('base64');
            originalBytes += bytes;
            compacted++;
            changed = true;
          }
        }
        references(event);
        if (!output.write(`${changed ? JSON.stringify(event) : line}\n`)) await once(output, 'drain');
      }
      output.end();
      await written;
    } catch (error) {
      output.destroy(error);
      await written;
      throw error;
    }
    const zip = new yazl.ZipFile();
    zip.on('error', error => zip.outputStream.destroy(error));
    const saved = pipeline(zip.outputStream, createWriteStream(zipPath));
    try {
      zip.addFile(jsonlPath, 'report.jsonl');
      for (const [name, entry] of entries) {
        if (name === 'report.jsonl' || (candidates.has(name) && !referenced.has(name))) continue;
        if (name.endsWith('/')) zip.addEmptyDirectory(name);
        else zip.addReadStreamLazy(name, { size: entry.uncompressedSize }, callback => archive.openReadStream(entry, callback));
      }
      zip.end();
    } catch (error) {
      zip.outputStream.destroy(error);
      await saved;
      throw error;
    }
    await saved;
    await close();
    renameSync(zipPath, path);
    console.log(`Blob compacted: ${compacted} successful binary attachments / ${originalBytes} original bytes; failed/flaky resources unchanged`);
  } finally {
    await close();
    rmSync(jsonlPath, { force: true });
    rmSync(zipPath, { force: true });
  }
}

async function run(options) {
  const { data, out, list } = plan(options);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', data.settings.script, '--', ...data.settings.args, `--test-list=${list}`,
      `--workers=${data.settings.workers}`, '--reporter=line,json,blob'], {
      cwd: web, stdio: 'inherit', shell: process.platform === 'win32',
      env: {
        ...process.env, E2E_APP_DESIGN_CROSS_BROWSER: '1',
        PLAYWRIGHT_JSON_OUTPUT_NAME: join(out, 'results.json'),
        PLAYWRIGHT_BLOB_OUTPUT_DIR: join(out, 'blob'),
        PLAYWRIGHT_BLOB_OUTPUT_NAME: `report-${data.group}-${data.index}.zip`,
      },
    });
  if (result.error) throw result.error;
  const report = compact(join(out, 'results.json'));
  assertUnion(data.selected, resultInventory(report));
  await compactBlob(join(out, 'blob', `report-${data.group}-${data.index}.zip`));
  process.exitCode = result.status ?? 1;
}

function files(directory, name) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(directory, entry.name), name) : entry.name === name ? [join(directory, entry.name)] : []);
}

export function familyGroups(family) {
  if (family === 'chromium') return [['ordinary', 4], ['design', 12], ['a11y', 1], ['performance', 1]];
  if (family === 'visual') return [['visual', 4]];
  assert.ok(['firefox', 'webkit', 'edge'].includes(family), 'Unknown report family');
  if (family === 'edge') return [['engine-edge', 1]];
  return [[`engine-${family}`, 1], ...[1440, 390].flatMap(width => ['dark', 'light', 'custom']
    .map(theme => [`profile-${family}-${width}-${theme}`, family === 'webkit' ? width === 1440 ? 4 : 2 : 1])),
  [`replay-${family}`, 1]];
}

function merge(options) {
  const plans = files(resolve(options.input), 'plan.json').map(path => ({ path, data: JSON.parse(readFileSync(path, 'utf8')) }));
  const errors = [];
  for (const [group, count] of familyGroups(options.family)) {
    try {
      const parts = plans.filter(plan => plan.data.group === group);
      assert.equal(parts.length, count, `${group}: missing/duplicate shard evidence`);
      assert.deepEqual(parts.map(part => part.data.index).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i + 1));
      for (const part of parts) {
        assert.equal(part.data.count, count);
        assertUnion(parts[0].data.full, part.data.full);
        assertUnion(part.data.selected, resultInventory(JSON.parse(readFileSync(join(dirname(part.path), 'results.json'), 'utf8'))));
      }
      assertUnion(parts[0].data.full, parts.flatMap(part => part.data.selected));
      const out = resolve('ci-merged', group);
      const blobs = join(out, 'blobs');
      mkdirSync(blobs, { recursive: true });
      for (const part of parts) {
        const blob = join(dirname(part.path), 'blob', `report-${group}-${part.data.index}.zip`);
        copyFileSync(blob, join(blobs, `report-${part.data.index}.zip`));
      }
      const resultPath = join(out, 'results.json');
      invoke(['merge-reports', '--reporter=json,github', `--config=${fileURLToPath(import.meta.url)}`, blobs], {
        stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: resultPath },
      });
      const report = compact(resultPath);
      assertUnion(parts[0].data.full, resultInventory(report));
      if (report.stats.unexpected || report.errors.length || process.env.REPORT_FAILURE === 'true') {
        invoke(['merge-reports', '--reporter=html', `--config=${fileURLToPath(import.meta.url)}`, blobs], {
          stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: join(out, 'html'), PLAYWRIGHT_HTML_OPEN: 'never' },
        });
      }
      console.log(`${group}: merged ${count} blob(s), exact union ${parts[0].data.full.length} tests`);
      assert.equal(report.stats.unexpected, 0, `${group}: unexpected test results`);
      assert.equal(report.errors.length, 0, `${group}: report errors`);
    } catch (error) {
      errors.push(error);
      console.error(`${group}: ${error.message}`);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Required suite report merge failed');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = Object.fromEntries(process.argv.slice(3).map(arg => {
    const equals = arg.indexOf('=');
    assert.ok(arg.startsWith('--') && equals > 2, `Expected --name=value: ${arg}`);
    return [arg.slice(2, equals), arg.slice(equals + 1)];
  }));
  const command = process.argv[2];
  if (command === 'plan') plan(options);
  else if (command === 'run') await run(options);
  else if (command === 'compact-blob') await compactBlob(resolve(options.input));
  else {
    assert.equal(command, 'merge', 'Expected plan, run or merge');
    merge(options);
  }
}
