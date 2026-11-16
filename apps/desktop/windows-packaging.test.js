'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = path.join(__dirname, 'package-msix.ps1');
const windows = process.platform === 'win32';

function layout(root, name, arch, options = {}) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  const machine = options.machine ?? (arch === 'arm64' ? 0xaa64 : 0x8664);
  const executable = Buffer.alloc(128);
  executable.writeUInt16LE(0x5a4d, 0);
  executable.writeUInt32LE(64, 60);
  executable.writeUInt32LE(0x00004550, 64);
  executable.writeUInt16LE(machine, 68);
  fs.writeFileSync(path.join(directory, 'app.exe'), executable);
  fs.writeFileSync(path.join(directory, 'AppxManifest.xml'), `<Package>
    <Identity Name="${options.name ?? 'TeslaSync.Test'}" Publisher="CN=Test" Version="${options.version ?? '1.2.3.0'}" ProcessorArchitecture="${arch}" />
    <Dependencies><TargetDeviceFamily MinVersion="${options.minVersion ?? '10.0.17763.0'}" /></Dependencies>
    <Applications><Application Executable="app.exe" /></Applications>
  </Package>`);
  return directory;
}

function run(args, scriptPath = script, env = process.env) {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const parameters = args[0] === '-Layouts'
    ? `-Layouts @(${args.slice(1).map(quote).join(',')})`
    : args.map(value => value.startsWith('-') ? value : quote(value)).join(' ');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `& ${quote(scriptPath)} ${parameters}`], {
    encoding: 'utf8',
    env,
    // Cold PowerShell startup can be slow on shared Windows/ARM64 hosts.
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teslasync-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

for (const arch of ['x64', 'arm64']) {
  test(`accepts a ${arch} PE machine matching its package manifest`, { skip: !windows }, (t) => {
    const directory = layout(fixture(t), arch, arch);
    const result = run(['-Layout', directory, '-Architecture', arch]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, new RegExp(`Validated ${arch} package layout`));
  });
}

test('rejects an emulated x64 executable disguised as an ARM64 package', { skip: !windows }, (t) => {
  const directory = layout(fixture(t), 'emulated', 'arm64', { machine: 0x8664 });
  const result = run(['-Layout', directory, '-Architecture', 'arm64']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Native executable architecture 'x64' does not match manifest 'arm64'/);
});

test('rejects a package built for the wrong requested architecture', { skip: !windows }, (t) => {
  const directory = layout(fixture(t), 'wrong-target', 'x64');
  const result = run(['-Layout', directory, '-Architecture', 'arm64']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /does not match expected 'arm64'/);
});

test('preserves the Store minimum-Windows-version gate', { skip: !windows }, (t) => {
  const directory = layout(fixture(t), 'old-windows', 'arm64', { minVersion: '10.0.17134.0' });
  const result = run(['-Layout', directory, '-Architecture', 'arm64']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Partner Center rejects MSIX packages/);
});

test('accepts matching x64 and ARM64 identities for one Store product', { skip: !windows }, (t) => {
  const root = fixture(t);
  const directories = [layout(root, 'x64', 'x64'), layout(root, 'arm64', 'arm64')];
  const result = run(['-Layouts', ...directories]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Validated native x64 \+ arm64 package identities/);
});

test('rejects duplicate architecture packages instead of silently losing ARM64', { skip: !windows }, (t) => {
  const root = fixture(t);
  const result = run(['-Layouts', layout(root, 'first', 'x64'), layout(root, 'second', 'x64')]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /exactly one native x64 and one native arm64 package/);
});

for (const [field, option] of [['Name', 'name'], ['Version', 'version']]) {
  test(`rejects bundle packages with different ${field}`, { skip: !windows }, (t) => {
    const root = fixture(t);
    const changed = option === 'name' ? 'Another.Product' : '1.2.4.0';
    const result = run(['-Layouts', layout(root, 'x64', 'x64'), layout(root, 'arm64', 'arm64', { [option]: changed })]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, new RegExp(`Bundle packages must share the same ${field}`));
  });
}

test('the build helper isolates its web payload and preserves its project path through the npm shim', { skip: !windows }, async (t) => {
  const root = fixture(t);
  const bin = path.join(root, 'bin');
  const web = path.join(root, 'web');
  fs.mkdirSync(bin);
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<html></html>');
  const capture = path.join(root, 'arguments.json');
  fs.writeFileSync(path.join(bin, 'npm.ps1'), `$configPath = $args[[array]::IndexOf($args, '--config') + 1]
@{ arguments = $args; configuration = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json) } |
  ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $env:TESLASYNC_TEST_NPM_ARGS -Encoding utf8NoBOM
exit 1
`);
  const env = { ...process.env, TESLASYNC_TEST_NPM_ARGS: capture };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path';
  env[pathKey] = `${bin}${path.delimiter}${env[pathKey]}`;
  const result = run([
    '-Version', '1.2.3', '-WebDist', web,
    '-OutputDirectory', path.join(root, 'output'), '-AssetsDirectory', path.join(root, 'assets'),
  ], path.join(__dirname, 'build-windows.ps1'), env);
  assert.notEqual(result.status, 0);
  const { arguments: args, configuration } = JSON.parse(fs.readFileSync(capture, 'utf8'));
  assert.equal(args[args.indexOf('--prefix') + 1], __dirname);
  assert.match(result.output, /Building Windows packages failed/);
  const configPath = path.join(root, 'captured-builder.json');
  fs.writeFileSync(configPath, JSON.stringify(configuration));
  const { getConfig } = require(path.join(__dirname, 'node_modules', 'app-builder-lib', 'out', 'util', 'config', 'config.js'));
  const effectiveConfig = await getConfig(__dirname, configPath);
  assert.deepEqual(effectiveConfig.extraResources.map(({ from, to }) => ({ from, to })), [{ from: web, to: 'web/dist' }]);
  assert.equal(effectiveConfig.extraMetadata.version, '1.2.3');
});
