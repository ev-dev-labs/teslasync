import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planRetention, inventoryPackages, deletePlanned } from './package-retention.mjs';

const policy = JSON.parse(await readFile(new URL('../ops/release/package-retention.json', import.meta.url)));
const now = Date.parse('2026-09-19T00:00:00Z');
const ago = (days) => new Date(now - days * 86400000).toISOString();
const version = (id, tags, days = 200) => ({
  id, name: `sha256:${id}`, created_at: ago(days), updated_at: ago(days),
  metadata: { container: { tags } },
});
const fixture = () => Object.fromEntries(policy.packages.map((pkg) => [
  pkg, Array.from({ length: 12 }, (_, i) => version(i + 1, [`1.0.${i}`], 200 - i)),
]));
const deleted = (plan) => plan.filter((row) => row.action === 'delete');

test('covers exactly the seven published packages and deletes existing old releases together', () => {
  assert.equal(policy.packages.length, 7);
  assert.ok(policy.packages.includes('charts/teslasync'));
  const plan = planRetention(policy, fixture(), now);
  assert.equal(deleted(plan).length, 14);
  assert.deepEqual([...new Set(deleted(plan).flatMap((r) => r.tags))], ['1.0.0', '1.0.1']);
});

test('age protection is OR count protection and uses the newest component timestamp', () => {
  const inventory = fixture();
  inventory['teslasync-api'][0].updated_at = ago(1);
  const plan = planRetention(policy, inventory, now);
  assert.equal(deleted(plan).some((r) => r.tags.includes('1.0.0')), false);
});

test('a sparsely published package retains its rollback versions across all packages', () => {
  const inventory = fixture();
  inventory['teslasync-fleet-telemetry'] = inventory['teslasync-fleet-telemetry'].slice(0, 2);
  assert.equal(deleted(planRetention(policy, inventory, now)).length, 0);
});

test('recent releases are all retained even beyond the count', () => {
  const inventory = Object.fromEntries(policy.packages.map((pkg) => [
    pkg, Array.from({ length: 20 }, (_, i) => version(i + 1, [`1.0.${i}`], 10)),
  ]));
  assert.equal(deleted(planRetention(policy, inventory, now)).length, 0);
});

test('RC policy keeps five old RCs and every recent RC independently of stable releases', () => {
  const inventory = fixture();
  for (const versions of Object.values(inventory)) {
    versions.push(...Array.from({ length: 7 }, (_, i) => version(100 + i, [`2.0.0-rc.${i}`], 40 - i)));
    versions.push(version(200, ['2.0.0-rc.new'], 1));
  }
  const plan = planRetention(policy, inventory, now);
  assert.equal(deleted(plan).filter((r) => r.tags[0].includes('-rc')).length, 21);
  assert.equal(deleted(plan).some((r) => r.tags.includes('2.0.0-rc.new')), false);
});

test('exact age boundary is retained', () => {
  const inventory = fixture();
  inventory['teslasync-api'][0].updated_at = ago(90);
  assert.equal(deleted(planRetention(policy, inventory, now)).some((r) => r.tags.includes('1.0.0')), false);
});

test('policy pins and manual v-prefixed pins protect all components', () => {
  const plan = planRetention({ ...policy, protectedVersions: ['1.0.0'] }, fixture(), now, ['v1.0.1']);
  assert.equal(deleted(plan).length, 0);
});

test('aliases and transitive shared digests protect whole releases', () => {
  const inventory = fixture();
  inventory['teslasync-api'][0].metadata.container.tags.push('latest');
  inventory['teslasync-web'][0].metadata.container.tags.push('1.0.1');
  assert.equal(deleted(planRetention(policy, inventory, now)).length, 0);
});

test('untagged manifests and signing artifacts are preserved', () => {
  const inventory = fixture();
  inventory['teslasync-api'].push(version(30, []), version(31, ['sha256-abc.sig']),
    version(32, ['sha256-abc.att']), version(33, ['unknown']));
  const plan = planRetention(policy, inventory, now);
  assert.ok(plan.filter((r) => r.id >= 30).every((r) => r.action === 'keep'));
});

test('missing inventory, malformed metadata, invalid policy and invalid pins fail closed', () => {
  const inventory = fixture();
  delete inventory['teslasync-api'];
  assert.throws(() => planRetention(policy, inventory, now), /Missing/);
  const malformed = fixture();
  malformed['teslasync-api'][0].created_at = 'invalid';
  assert.throws(() => planRetention(policy, malformed, now), /Invalid version/);
  assert.throws(() => planRetention({ ...policy, stable: { keep: 0, days: 90 } }, fixture(), now), /Invalid stable/);
  assert.throws(() => planRetention(policy, fixture(), now, ['latest']), /Protected versions/);
});

test('inventory paginates and encodes the Helm package name', async () => {
  const paths = [];
  const inventory = await inventoryPackages({ packages: ['charts/teslasync'] }, async (path) => {
    paths.push(path);
    return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => version(i, ['1.0.0'])) : [];
  }, 'ev-dev-labs');
  assert.equal(inventory['charts/teslasync'].length, 100);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((path) => path.includes('charts%2Fteslasync')));
});

test('inventory permission failures propagate', async () => {
  await assert.rejects(inventoryPackages(policy, async () => { throw new Error('HTTP 403'); }, 'owner'), /403/);
});

test('changed candidate aborts preflight before any delete', async () => {
  const plan = planRetention(policy, fixture(), now);
  const methods = [];
  await assert.rejects(deletePlanned(plan, async (path, method = 'GET') => {
    methods.push(method);
    return version(1, ['latest']);
  }, 'owner', async () => {}), /changed/);
  assert.deepEqual(methods, ['GET']);
});

test('partial deletion failures record outcomes and stop', async () => {
  const inventory = fixture();
  const plan = planRetention(policy, inventory, now);
  const outcomes = [];
  let deletes = 0;
  await assert.rejects(deletePlanned(plan, async (path, method) => {
    if (method === 'DELETE') {
      if (++deletes === 2) throw new Error('HTTP 403');
      return null;
    }
    const id = Number(path.split('/').at(-1));
    return inventory['teslasync-api'].find((v) => v.id === id);
  }, 'owner', async (entry) => outcomes.push(entry)), /403/);
  assert.equal(deletes, 2);
  assert.deepEqual(outcomes.map((entry) => entry.status), ['deleted', 'failed']);
});
