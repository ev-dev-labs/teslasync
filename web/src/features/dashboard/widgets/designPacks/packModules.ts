import type { ComponentType } from 'react';
import { batteryGaugePresentations, vehicleHeroPresentations } from './presentationLoaders';
import type { PackId } from './types';

type Loader<P extends object> = () => Promise<{ default: ComponentType<P> }>;
const loaded = new WeakMap<object, unknown>();

export const loadInstrument = () => import('./families/InstrumentLayout');
export const loadStatus = () => import('./families/SecurityStatusLayout');
export const loadTimeline = () => import('./families/TimelineLayout');
export const loadClimatePresentation = () => import('./families/ClimateStatusLayout');
export const loadActionsPresentation = () => import('./families/CommandActionsLayout');
export const loadLinePresentation = () => import('./families/LineTelemetryLayout');
export const loadTirePresentation = () => import('./families/TirePressureLayout');

export function cachedPackModule<P extends object>(load: Loader<P>): ComponentType<P> | null {
  return (loaded.get(load) as ComponentType<P> | undefined) ?? null;
}

export async function resolvePackModule<P extends object>(load: Loader<P>): Promise<ComponentType<P>> {
  const cached = cachedPackModule(load);
  if (cached) return cached;
  const presentation = (await load()).default;
  loaded.set(load, presentation);
  return presentation;
}

export async function preloadPackModules(packId: PackId): Promise<void> {
  if (packId === 'classic') return;
  await Promise.all([
    resolvePackModule(loadInstrument),
    resolvePackModule(loadStatus),
    resolvePackModule(loadTimeline),
    resolvePackModule(loadClimatePresentation),
    resolvePackModule(loadActionsPresentation),
    resolvePackModule(loadLinePresentation),
    resolvePackModule(loadTirePresentation),
    resolvePackModule(batteryGaugePresentations[packId]),
    resolvePackModule(vehicleHeroPresentations[packId]),
  ]);
}
