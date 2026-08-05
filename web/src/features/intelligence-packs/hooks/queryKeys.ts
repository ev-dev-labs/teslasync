/** Centralized TanStack Query key builders for this feature (local-only data, never a network request). */
export const intelPackQueryKeys = {
  installed: ['intelligence-packs', 'installed'] as const,
  trust: (packId: string) => ['intelligence-packs', 'trust', packId] as const,
  audit: (limit?: number) => ['intelligence-packs', 'audit', limit ?? 'all'] as const,
  verify: (digestOrId: string) => ['intelligence-packs', 'verify', digestOrId] as const,
};
