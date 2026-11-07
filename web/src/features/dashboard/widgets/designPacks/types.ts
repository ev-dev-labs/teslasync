export const PACK_IDS = ['classic', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'] as const;

export type PackId = (typeof PACK_IDS)[number];

export const PACK_AVAILABILITY: Readonly<Record<PackId, boolean>> = {
  classic: true, v1: true, v2: true, v3: true, v4: true, v5: true, v6: true, v7: true,
};

export function resolvePackId(value: unknown): PackId {
  return typeof value === 'string' && PACK_IDS.some(id => id === value)
    ? value as PackId
    : 'classic';
}

export function resolveAvailablePackId(value: unknown): PackId {
  const id = resolvePackId(value);
  return PACK_AVAILABILITY[id] ? id : 'classic';
}

export const PACK_APPEARANCES = {
  v1: 'studio', v2: 'elevated', v3: 'precision', v4: 'owner',
  v5: 'iconic', v6: 'expressive', v7: 'pixel',
} as const;

export type PackAppearance = (typeof PACK_APPEARANCES)[Exclude<PackId, 'classic'>];

export type WidgetFamily =
  | 'access-matrix' | 'actions' | 'axle-map' | 'bars' | 'charge-flow'
  | 'climate' | 'empty' | 'flow' | 'heatmap' | 'line' | 'list' | 'map'
  | 'media' | 'meter' | 'pack-map' | 'ring' | 'segments' | 'siteflow'
  | 'status' | 'timeline' | 'tire' | 'twin' | 'vehicle';

export interface PackManifestEntry {
  id: PackId;
  /** Translation keys; the approved labels are presentation copy, not stored IDs. */
  nameKey: string;
  descriptionKey: string;
  reference: string;
  /** Availability is independent of the stored preference and unknown-ID fallback. */
  available: boolean;
}
