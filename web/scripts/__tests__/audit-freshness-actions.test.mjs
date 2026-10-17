/**
 * Tests for the freshness / icon-action guard. Each case writes a tiny
 * fixture tree and runs the real script against it with `--root`, so the
 * guard is exercised exactly as `npm run lint` runs it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../audit-freshness-actions.mjs', import.meta.url));

function scan(source, name = 'Example.tsx') {
  const root = mkdtempSync(join(tmpdir(), 'freshness-actions-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', name), source);
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--report'], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('passes clean code: FreshnessDot plus an icon-only IconButton', () => {
  const r = scan(`import { RefreshCw } from 'lucide-react';
export const A = () => <>
  <FreshnessDotAuto query={q} />
  <IconButton icon={<RefreshCw />} label={t('common.refresh', 'Refresh')} onClick={go} />
</>;`);
  assert.equal(r.status, 0, r.output);
});

test('fails on the Wi-Fi icon from lucide or the registry', () => {
  assert.equal(scan(`import { Wifi } from 'lucide-react';\nexport const A = () => <Wifi />;`).status, 1);
  assert.equal(scan(`import { Icons } from '@/lib/icons';\nexport const A = Icons.wifiOff;`).status, 1);
});

test('fails on the old chip indicator and the removed FreshnessIndicator', () => {
  assert.match(scan(`export const A = () => <DataFreshnessAuto query={q} />;`).output, /old indicator/);
  assert.match(scan(`export const A = () => <FreshnessIndicator timestamp={null} />;`).output, /old indicator/);
});

test('fails on visible "just now" freshness text unless documented as relative time', () => {
  assert.equal(scan(`export const age = () => 'just now';`).status, 1);
  assert.equal(scan(`// relative-time: when the event happened\nexport const age = () => 'just now';`).status, 0);
});

test('fails on an icon + visible text repeated action', () => {
  const r = scan(`import { RefreshCw } from 'lucide-react';
export const A = () => <Button icon={<RefreshCw />} onClick={go}>{t('common.refresh', 'Refresh')}</Button>;`);
  assert.equal(r.status, 1);
  assert.match(r.output, /icon \+ "t\('common\.refresh'\)"/);
  const literal = scan(`import { History } from 'lucide-react';
export const A = () => <Button onClick={go}><History />View history</Button>;`);
  assert.equal(literal.status, 1);
});

test('keeps flow CTAs and overflow-menu items as text', () => {
  assert.equal(scan(`import { Download } from 'lucide-react';
export const A = () => <>
  {/* flow-cta: downloading is this dialog's task */}
  <Button icon={<Download />} onClick={save}>{t('x.download', 'Download')}</Button>
</>;`).status, 0);
  assert.equal(scan(`import { Download } from 'lucide-react';
export const A = () => <DropdownMenu><Button icon={<Download />}>{t('x.export', 'Export')}</Button></DropdownMenu>;`).status, 0);
  // Save is a form CTA, not a repeated action.
  assert.equal(scan(`import { Check } from 'lucide-react';
export const A = () => <Button icon={<Check />}>{t('common.save', 'Save')}</Button>;`).status, 0);
});

test('fails on a filled icon-only repeated action; only Customize may be filled', () => {
  assert.equal(scan(`export const A = () => <IconButton icon={i} label={t('common.refresh', 'Refresh')} variant="secondary" />;`).status, 1);
  assert.equal(scan(`export const A = () => <IconButton icon={i} label={t('dashboard.customize', 'Customize')} variant="primary" />;`).status, 0);
});

test('fails on a destructive icon-only action without a confirmation step', () => {
  const bare = scan(`export const A = () => <IconButton icon={i} label={t('x.remove', 'Remove')} onClick={go} />;`);
  assert.equal(bare.status, 1);
  assert.match(bare.output, /destructive without a confirmation step/);
  assert.equal(scan(`export const A = () => <IconButton icon={i} label="Delete" onClick={go} />;`).status, 1);
  assert.equal(scan(`export const A = () => <IconButton icon={i} label={t('x.remove', 'Remove')} onClick={go} confirm={{ title: t, message: m }} />;`).status, 0);
  assert.equal(scan(`export const A = () => <>
  {/* confirm-step: the handler asks in the shared ConfirmDialog first */}
  <IconButton icon={i} label={t('x.delete', 'Delete')} onClick={go} />
</>;`).status, 0);
  assert.equal(scan(`export const A = () => <>
  {/* not-destructive: clears the selection only; nothing is lost */}
  <IconButton icon={i} label={t('x.clear', 'Clear')} onClick={go} />
</>;`).status, 0);
});
