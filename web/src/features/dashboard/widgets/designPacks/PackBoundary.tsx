import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertBanner } from '@/components/feedback';
import { Button } from '@/components/ui';
import { reportFrontendError } from '@/lib/errorReporter';
import { resolveAvailablePackId } from './manifest';
import type { PackId } from './types';
import './experimental.css';

const PackPresentationContext = createContext<PackId>('classic');
const PackLoadingContext = createContext<{
  revision: number;
  onFailure: (packId: PackId, error: unknown) => void;
}>({ revision: 0, onFailure: () => undefined });

export function usePackPresentation(): PackId {
  return useContext(PackPresentationContext);
}

export function usePackModule<P extends object>(
  packId: PackId,
  load: (() => Promise<{ default: ComponentType<P> }>) | null,
): ComponentType<P> | null {
  const { revision, onFailure } = useContext(PackLoadingContext);
  const [loaded, setLoaded] = useState<{ load: typeof load; Presentation: ComponentType<P> } | null>(null);
  useEffect(() => {
    if (packId === 'classic' || !load) return;
    let active = true;
    void load().then(module => {
      if (active) setLoaded(current => current?.load === load && current.Presentation === module.default
        ? current : { load, Presentation: module.default });
    }).catch(error => {
      if (active) onFailure(packId, error);
    });
    return () => { active = false; };
  }, [packId, load, revision, onFailure]);
  return packId !== 'classic' && loaded?.load === load ? loaded.Presentation : null;
}

interface PackBoundaryProps {
  requestedPackId?: unknown;
  children: ReactNode;
}

export function PackBoundary({ requestedPackId, children }: PackBoundaryProps) {
  const { t } = useTranslation();
  const packId = resolveAvailablePackId(requestedPackId);
  const [failedPack, setFailedPack] = useState<PackId | null>(null);
  const [revision, setRevision] = useState(0);
  const onFailure = useCallback((failed: PackId, error: unknown) => {
    setFailedPack(failed);
    reportFrontendError(error instanceof Error ? error : new Error('Widget presentation failed to load'), 'react');
  }, []);
  const loading = useMemo(() => ({ revision, onFailure }), [revision, onFailure]);
  return (
    <PackPresentationContext.Provider value={packId}>
      <PackLoadingContext.Provider value={loading}>
        {failedPack === packId && (
          <AlertBanner variant="warning" role="alert">
            {t('errorBoundary.inlineTitle', 'Component failed to load')}
            <Button className="ms-3" size="sm" onClick={() => { setFailedPack(null); setRevision(value => value + 1); }}>
              {t('errorBoundary.retry', 'Retry')}
            </Button>
          </AlertBanner>
        )}
        {children}
      </PackLoadingContext.Provider>
    </PackPresentationContext.Provider>
  );
}
