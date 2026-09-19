import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const releaseTag = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const normalize = (tag) => tag.replace(/^v/, '');

export function planRetention(policy, inventory, now = Date.now(), protectedVersions = []) {
  if (!Array.isArray(policy.packages) || policy.packages.length === 0 ||
      new Set(policy.packages).size !== policy.packages.length) {
    throw new Error('Policy must contain unique package names');
  }
  for (const tier of ['stable', 'prerelease']) {
    if (!Number.isInteger(policy[tier]?.keep) || policy[tier].keep < 1 ||
        !Number.isInteger(policy[tier]?.days) || policy[tier].days < 1) {
      throw new Error(`Invalid ${tier} retention policy`);
    }
  }
  const protectedTags = [...policy.protectedVersions, ...protectedVersions];
  if (protectedTags.some((tag) => !releaseTag.test(tag))) {
    throw new Error('Protected versions must be release version tags');
  }
  const keep = new Set(protectedTags.map(normalize));
  const releases = new Map();
  const rows = [];
  for (const pkg of policy.packages) {
    if (!Array.isArray(inventory[pkg]) || inventory[pkg].length === 0) {
      throw new Error(`Missing or empty package inventory: ${pkg}`);
    }
    for (const version of inventory[pkg]) {
      const tags = version.metadata?.container?.tags;
      const created = Date.parse(version.created_at);
      const updated = Date.parse(version.updated_at ?? version.created_at);
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string') ||
          !Number.isSafeInteger(version.id) || !Number.isFinite(created) || !Number.isFinite(updated)) {
        throw new Error(`Invalid version metadata in ${pkg}`);
      }
      const names = tags.filter((tag) => releaseTag.test(tag)).map(normalize);
      const row = { package: pkg, id: version.id, digest: version.name, tags, releases: names };
      rows.push(row);
      for (const name of names) {
        // A recently republished component protects the entire release.
        releases.set(name, Math.max(releases.get(name) ?? 0, created, updated));
        if (tags.some((tag) => !releaseTag.test(tag))) keep.add(name);
      }
    }
  }
  for (const tier of ['stable', 'prerelease']) {
    const ordered = [...releases].filter(([name]) => name.includes('-') === (tier === 'prerelease'))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    ordered.forEach(([name, date], index) => {
      if (index < policy[tier].keep || now - date <= policy[tier].days * 86400000) keep.add(name);
    });
    // Older or less frequently published packages still need rollback coverage.
    for (const pkg of policy.packages) {
      const available = new Set(rows.filter((row) => row.package === pkg).flatMap((row) => row.releases));
      ordered.filter(([name]) => available.has(name)).slice(0, policy[tier].keep)
        .forEach(([name]) => keep.add(name));
    }
  }
  // Shared digests cannot be removed without removing every tag on them.
  let changed;
  do {
    changed = false;
    for (const row of rows) {
      if (row.releases.some((name) => keep.has(name))) {
        for (const name of row.releases) {
          if (!keep.has(name)) { keep.add(name); changed = true; }
        }
      }
    }
  } while (changed);
  return rows.map((row) => ({
    ...row,
    action: row.releases.length > 0 && row.tags.every((tag) => releaseTag.test(tag)) &&
      row.releases.every((name) => !keep.has(name)) ? 'delete' : 'keep',
    reason: row.releases.length === 0 ? 'untagged or auxiliary artifact: preserved' :
      row.tags.some((tag) => !releaseTag.test(tag)) ? 'alias or auxiliary tag: preserved' :
      row.releases.some((name) => keep.has(name)) ? 'retention window, pin, or shared digest' :
      'outside both count and age protections',
  }));
}

export async function inventoryPackages(policy, request, owner) {
  const inventory = {};
  for (const pkg of policy.packages) {
    const versions = [];
    for (let page = 1; ; page++) {
      const batch = await request(`/orgs/${owner}/packages/container/${encodeURIComponent(pkg)}/versions?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error(`Invalid inventory response: ${pkg}`);
      versions.push(...batch);
      if (batch.length < 100) break;
    }
    inventory[pkg] = versions;
  }
  return inventory;
}

export async function deletePlanned(plan, request, owner, report) {
  // Preflight ALL candidates before the first DELETE.
  for (const row of plan.filter((entry) => entry.action === 'delete')) {
    const path = `/orgs/${owner}/packages/container/${encodeURIComponent(row.package)}/versions/${row.id}`;
    const current = await request(path);
    if (current.name !== row.digest ||
        JSON.stringify([...current.metadata.container.tags].sort()) !== JSON.stringify([...row.tags].sort())) {
      throw new Error(`Version changed since inventory: ${row.package}/${row.id}`);
    }
  }
  for (const row of plan.filter((entry) => entry.action === 'delete')) {
    try {
      await request(`/orgs/${owner}/packages/container/${encodeURIComponent(row.package)}/versions/${row.id}`, 'DELETE');
      await report({ package: row.package, id: row.id, status: 'deleted' });
    } catch (error) {
      await report({ package: row.package, id: row.id, status: 'failed', error: error.message });
      throw error;
    }
  }
}

async function main() {
  const policy = JSON.parse(await readFile(new URL('../ops/release/package-retention.json', import.meta.url), 'utf8'));
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const token = process.env.GH_TOKEN;
  if (!owner || !token) throw new Error('GITHUB_REPOSITORY_OWNER and GH_TOKEN are required');
  const request = async (path, method = 'GET') => {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const pins = (process.env.PROTECTED_VERSIONS ?? '').split(/[\s,]+/).filter(Boolean);
  const now = Date.now();
  const inventory = await inventoryPackages(policy, request, owner);
  const plan = planRetention(policy, inventory, now, pins);
  await writeFile('package-retention-plan.json', JSON.stringify({ generatedAt: new Date(now), plan }, null, 2));
  const deleting = process.env.DELETE_PACKAGES === 'true';
  const summary = [
    `## Package retention (${deleting ? 'DELETE ENABLED' : 'dry-run'})`,
    '',
    '| Package | Keep | Delete candidates |',
    '| --- | ---: | ---: |',
    ...policy.packages.map((pkg) =>
      `| ${pkg} | ${plan.filter((r) => r.package === pkg && r.action === 'keep').length} | ${plan.filter((r) => r.package === pkg && r.action === 'delete').length} |`),
    '',
    'Full version IDs, tags, and reasons are in package-retention-plan.json.',
    'Untagged manifests and auxiliary artifacts are deliberately preserved.',
    '',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  if (deleting) {
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Deletion requires a manual workflow dispatch');
    const refreshed = planRetention(policy, await inventoryPackages(policy, request, owner), now, pins);
    if (JSON.stringify(refreshed) !== JSON.stringify(plan)) throw new Error('Inventory changed; rerun dry-run before deleting');
    await deletePlanned(plan, request, owner, async (entry) => {
      console.log(JSON.stringify(entry));
      await appendFile('package-retention-results.jsonl', `${JSON.stringify(entry)}\n`);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
