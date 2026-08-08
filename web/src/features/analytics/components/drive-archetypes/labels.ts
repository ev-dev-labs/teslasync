import type { TFunction } from 'i18next';

import type {
  ArchetypeLabel,
  ArchetypeQuality,
  ArchetypeStatus,
} from '../../lib/driveArchetypes';

export function archetypeLabel(t: TFunction, label: ArchetypeLabel): string {
  switch (label) {
    case 'highwayRun':
      return t('archetypes.labels.highwayRun', 'Highway pattern');
    case 'roadTrip':
      return t('archetypes.labels.roadTrip', 'Long-distance pattern');
    case 'morningCommute':
      return t('archetypes.labels.morningCommute', 'Morning pattern');
    case 'eveningCommute':
      return t('archetypes.labels.eveningCommute', 'Evening pattern');
    case 'shortHop':
      return t('archetypes.labels.shortHop', 'Short-hop pattern');
    case 'coldWeather':
      return t('archetypes.labels.coldWeather', 'Cold-weather pattern');
    case 'everyday':
      return t('archetypes.labels.everyday', 'Everyday pattern');
  }
}

export function archetypeIdentity(
  t: TFunction,
  clusterIndex: number,
  label: ArchetypeLabel,
): string {
  return t(
    'archetypes.common.clusterIdentity',
    'Cluster {{number}} · {{label}}',
    {
      number: clusterIndex + 1,
      label: archetypeLabel(t, label),
    },
  );
}

export function archetypeStatusLabel(
  t: TFunction,
  status: ArchetypeStatus,
): string {
  switch (status) {
    case 'insufficient_drives':
      return t('archetypes.status.insufficientDrives', 'More eligible drives needed');
    case 'insufficient_variation':
      return t('archetypes.status.insufficientVariation', 'Variation is insufficient');
    case 'insufficient_partition':
      return t('archetypes.status.insufficientPartition', 'Stable partition unavailable');
    case 'clustered':
      return t('archetypes.status.clustered', 'Clusters published');
  }
}

export function archetypeQualityLabel(
  t: TFunction,
  quality: ArchetypeQuality,
): string {
  switch (quality) {
    case 'none':
      return t('archetypes.quality.none', 'Not rated');
    case 'limited':
      return t('archetypes.quality.limited', 'Limited separation');
    case 'moderate':
      return t('archetypes.quality.moderate', 'Moderate separation');
    case 'strong':
      return t('archetypes.quality.strong', 'Strong separation');
  }
}
