import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Skeleton } from '@/components/feedback';
import type { PhysicsPage, PhysicsSlug } from './PhysicsPageShell';

const sections: Record<PhysicsSlug, LazyExoticComponent<ComponentType<{ physics: PhysicsPage }>>> = {
  clocks: lazy(() => import('./PhysicsClocksSection')),
  'life-tape': lazy(() => import('./PhysicsLifeTapeSection')),
  contradictions: lazy(() => import('./PhysicsContradictionsSection')),
  meters: lazy(() => import('./PhysicsMetersSection')),
  unknown: lazy(() => import('./PhysicsUnknownSection')),
  'car-kept-living': lazy(() => import('./PhysicsCarKeptLivingSection')),
  logbook: lazy(() => import('./PhysicsLogbookSection')),
  'firmware-epochs': lazy(() => import('./PhysicsFirmwareEpochsSection')),
  'charge-port': lazy(() => import('./PhysicsChargePortSection')),
  'black-box': lazy(() => import('./PhysicsBlackBoxSection')),
  dictionary: lazy(() => import('./PhysicsDictionarySection')),
  vault: lazy(() => import('./PhysicsVaultSection')),
  modes: lazy(() => import('./PhysicsModesSection')),
  'nervous-system': lazy(() => import('./PhysicsNervousSystemSection')),
  range: lazy(() => import('./PhysicsRangeSection')),
};

export function PhysicsInvestigation({ slug, physics }: { slug: PhysicsSlug; physics: PhysicsPage }) {
  const Section = sections[slug];
  return <Suspense fallback={<Skeleton className="h-40 w-full" />}>
    <Section physics={physics} />
  </Suspense>;
}
