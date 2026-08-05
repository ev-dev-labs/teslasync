import { useMemo } from 'react';

import { runSandboxPreview, type SandboxRunResult } from '../lib/sandboxRunner';
import type { PackCapabilityId, PackManifest } from '../lib/manifestTypes';

/**
 * Synchronous, deterministic sandbox preview — pure CPU work over a fixed,
 * bundled sample dataset (see `lib/sampleTelemetry.ts`), so this is a plain
 * memoized computation rather than a TanStack Query (there is nothing
 * asynchronous or cacheable-across-reloads about it).
 */
export function useSandboxPreview(
  manifest: PackManifest | null | undefined,
  grantedCapabilities: ReadonlySet<PackCapabilityId>,
): SandboxRunResult | null {
  const grantedKey = Array.from(grantedCapabilities).sort().join(',');
  return useMemo(() => {
    if (!manifest) return null;
    return runSandboxPreview(manifest, grantedCapabilities);
  }, [manifest, grantedKey]);
}
