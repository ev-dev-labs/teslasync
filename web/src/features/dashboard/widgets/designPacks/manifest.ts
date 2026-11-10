import { PACK_AVAILABILITY, EXPERIMENTAL_PACK_IDS, type PackManifestEntry } from './types';
import { EXPERIMENTAL_LAYOUTS } from './experimentalLayouts';

export { resolvePackId, resolveAvailablePackId } from './types';

export const PACK_MANIFEST: readonly PackManifestEntry[] = [
  { id: 'classic', nameKey: 'dashboard.designPacks.classic.name', descriptionKey: 'dashboard.designPacks.classic.description', reference: 'Current production', available: PACK_AVAILABILITY.classic, style: 'minimal', intensity: 'mild' },
  { id: 'v1', nameKey: 'dashboard.designPacks.v1.name', descriptionKey: 'dashboard.designPacks.v1.description', reference: 'Frozen V1', available: PACK_AVAILABILITY.v1, style: 'technical', intensity: 'balanced' },
  { id: 'v2', nameKey: 'dashboard.designPacks.v2.name', descriptionKey: 'dashboard.designPacks.v2.description', reference: 'Frozen V2', available: PACK_AVAILABILITY.v2, style: 'soft', intensity: 'balanced' },
  { id: 'v3', nameKey: 'dashboard.designPacks.v3.name', descriptionKey: 'dashboard.designPacks.v3.description', reference: 'Corrected V3', available: PACK_AVAILABILITY.v3, style: 'minimal', intensity: 'mild' },
  { id: 'v4', nameKey: 'dashboard.designPacks.v4.name', descriptionKey: 'dashboard.designPacks.v4.description', reference: 'V4', available: PACK_AVAILABILITY.v4, style: 'minimal', intensity: 'mild' },
  { id: 'v5', nameKey: 'dashboard.designPacks.v5.name', descriptionKey: 'dashboard.designPacks.v5.description', reference: 'V5', available: PACK_AVAILABILITY.v5, style: 'soft', intensity: 'balanced' },
  { id: 'v6', nameKey: 'dashboard.designPacks.v6.name', descriptionKey: 'dashboard.designPacks.v6.description', reference: 'V6', available: PACK_AVAILABILITY.v6, style: 'geometric', intensity: 'bold' },
  { id: 'v7', nameKey: 'dashboard.designPacks.v7.name', descriptionKey: 'dashboard.designPacks.v7.description', reference: 'V7', available: PACK_AVAILABILITY.v7, style: 'technical', intensity: 'bold' },
  ...EXPERIMENTAL_PACK_IDS.map(id => ({
    id,
    nameKey: `dashboard.designPacks.${id}.name`,
    descriptionKey: `dashboard.designPacks.${id}.description`,
    reference: 'Experimental design lab',
    available: PACK_AVAILABILITY[id],
    experimental: true,
    style: EXPERIMENTAL_LAYOUTS[id].style,
    intensity: EXPERIMENTAL_LAYOUTS[id].intensity,
  })),
];
