---
description: "Fix DevToolsPage — 6 hidden-section violations where mutation/query results are gated behind {data && ...}"
---

# Fix: DevToolsPage — Hidden Section Violations

## Problem

6 instances of `{mutationResult.data && <ResultPanel>}` which hide panels entirely
when no result exists. Per engineering guidelines, panels must always render — show
an empty/idle state instead of hiding.

## Violations

```
Line 312: {hasData && <CopyButton text={stringifiedData} />}
Line 608: {generateMut.data && <ResultPanel title="Generate Keypair" ...>}
Line 609: {deleteMut.data && <ResultPanel title="Delete Keypair" ...>}
Line 622: {uploadMut.data && <ResultPanel title="Upload Key" ...>}
Line 824: {configQuery.data && <ResultPanel title="Telemetry Config" ...>}
Line 825: {deleteMut.data && <ResultPanel title="Delete Config" ...>}
```

## Fix Pattern

Replace conditional rendering with always-visible panels:

```typescript
// ❌ BEFORE — panel hidden until mutation fires
{generateMut.data && <ResultPanel title={t('Generate Keypair')} data={...} error={...} />}

// ✅ AFTER — panel always visible with idle state
<ResultPanel
  title={t('Generate Keypair')}
  data={generateMut.data?.error ? undefined : generateMut.data}
  error={typeof generateMut.data?.error === 'string' ? generateMut.data.error : undefined}
  idle={!generateMut.data}
  idleMessage={t('devtools.generateIdle', 'Run the action above to see results')}
/>
```

## Steps

### Step 1 — Update ResultPanel to support idle state

Check if `ResultPanel` already has an `idle` prop. If not, add it:

```typescript
interface ResultPanelProps {
  title: string;
  data?: unknown;
  error?: string;
  idle?: boolean;
  idleMessage?: string;
}

function ResultPanel({ title, data, error, idle, idleMessage }: ResultPanelProps) {
  return (
    <GlassPanel className="p-4">
      <h3 className="text-sm font-semibold text-white/70 mb-2">{title}</h3>
      {error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : idle || !data ? (
        <p className="text-white/30 text-sm italic">{idleMessage ?? 'No result yet'}</p>
      ) : (
        <pre className="text-xs text-white/60 overflow-auto max-h-48">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </GlassPanel>
  );
}
```

### Step 2 — Fix line 312 (CopyButton)

```typescript
// ❌ BEFORE
{hasData && <CopyButton text={stringifiedData} />}

// ✅ AFTER — show disabled button when no data
<CopyButton text={stringifiedData} disabled={!hasData} />
```

If CopyButton doesn't support `disabled`, wrap it:
```typescript
{hasData ? (
  <CopyButton text={stringifiedData} />
) : (
  <span className="text-white/30 text-xs italic">{t('devtools.noData', 'No data to copy')}</span>
)}
```

### Step 3 — Fix lines 608-609, 622 (Keypair section)

Replace all 3 conditional ResultPanels with always-visible ones:

```typescript
<ResultPanel
  title={t('devtools.generateResult', 'Generate Keypair')}
  data={generateMut.data?.error ? undefined : generateMut.data}
  error={typeof generateMut.data?.error === 'string' ? generateMut.data.error : undefined}
  idle={!generateMut.data}
  idleMessage={t('devtools.keypairIdle', 'Generate or delete a keypair to see results')}
/>
<ResultPanel
  title={t('devtools.deleteResult', 'Delete Keypair')}
  data={deleteMut.data?.error ? undefined : deleteMut.data}
  error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined}
  idle={!deleteMut.data}
/>
<ResultPanel
  title={t('devtools.uploadResult', 'Upload Key')}
  data={uploadMut.data?.error ? undefined : uploadMut.data}
  error={typeof uploadMut.data?.error === 'string' ? uploadMut.data.error : undefined}
  idle={!uploadMut.data}
/>
```

### Step 4 — Fix lines 824-825 (Telemetry Config section)

```typescript
<ResultPanel
  title={t('devtools.telemetryConfig', 'Telemetry Config')}
  data={configQuery.data?.error ? undefined : configQuery.data}
  error={typeof configQuery.data?.error === 'string' ? configQuery.data.error : undefined}
  idle={!configQuery.data}
  idleMessage={t('devtools.configIdle', 'Fetch config to see results')}
/>
<ResultPanel
  title={t('devtools.deleteConfig', 'Delete Config')}
  data={deleteMut.data?.error ? undefined : deleteMut.data}
  error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined}
  idle={!deleteMut.data}
/>
```

## Verification

```bash
cd web
npx tsc --noEmit

# Must be 0
grep -n '{.*data && <' src/features/admin/pages/DevToolsPage.tsx | wc -l
grep -n 'hasData && <' src/features/admin/pages/DevToolsPage.tsx | wc -l
```

**COMPLETION DEFINITION:**
- [ ] All 6 `{data && <Panel>}` patterns replaced with always-visible panels
- [ ] ResultPanel supports idle state with message
- [ ] CopyButton handles no-data state
- [ ] All strings use useTranslation()
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code — fix using new architecture only
