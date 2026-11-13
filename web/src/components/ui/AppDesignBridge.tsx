import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLoadSkeleton } from '@/components/feedback/PageLoadSkeleton';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import { useWidgetDesignPack } from '@/hooks/useWidgetDesignPack';
import { Button } from './Button';
import { Text } from './Typography';
import { getAppDesignAttributes, observeAppDesignScopes } from './app-designs/designs';
import './appDesignPacks.css';

/** Layout routes only; the root attribute also reaches body-portaled overlays. */
export function AppDesignBridge({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { packId, appWide, isReady, error, retry } = useWidgetDesignPack();
  const [released, setReleased] = useState(false);
  const [preparedPack, setPreparedPack] = useState<PackId | null>(null);
  const [moduleError, setModuleError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [appliedProfile, setAppliedProfile] = useState<string | null>(null);
  const profile = `${packId}:${appWide ? 'app' : 'widgets'}`;

  useEffect(() => {
    if (!isReady || packId === 'classic' || preparedPack === packId) return;
    let active = true;
    setModuleError(false);
    void import('@/features/dashboard/widgets/designPacks/packModules').then(({ preloadPackModules }) =>
      preloadPackModules(packId)).then(() => {
      if (active) setPreparedPack(packId);
    }).catch(() => {
      if (active) setModuleError(true);
    });
    return () => { active = false; };
  }, [isReady, packId, preparedPack, attempt]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const attributes = getAppDesignAttributes(packId);
    const clear = () => {
      for (const name of Object.keys(attributes)) root.removeAttribute(name);
      root.removeAttribute('data-app-design-owner');
    };
    clear();
    if (!isReady || !appWide) {
      setAppliedProfile(isReady ? profile : null);
      return clear;
    }
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
    const releaseScopes = observeAppDesignScopes(root);
    setAppliedProfile(profile);
    return () => { clear(); releaseScopes(); };
  }, [packId, appWide, isReady, profile]);

  const readyToShow = isReady && appliedProfile === profile && (packId === 'classic' || preparedPack === packId);
  useLayoutEffect(() => {
    if (readyToShow) setReleased(true);
  }, [readyToShow]);

  if (!children || released || readyToShow) return <>{children}</>;
  const failed = !!error || moduleError;
  return <main className="mx-auto w-full max-w-4xl space-y-4 p-4">
    {failed
      ? <Text role="alert">{t('common.designProfileUnavailable', 'Could not finish loading your saved appearance. Retry or continue without waiting.')}</Text>
      : <PageLoadSkeleton panels={1} label={t('common.designProfileLoading', 'Loading your saved appearance...')} />}
    <div className="flex flex-wrap gap-3">
      {failed && <Button className="min-h-11" variant="secondary" onClick={() => {
        if (error) retry();
        if (moduleError) setAttempt(value => value + 1);
      }}>{t('common.retry', 'Retry')}</Button>}
      <Button className="min-h-11" variant="secondary" onClick={() => setReleased(true)}>
        {isReady ? t('common.designProfileContinueLoading', 'Continue without waiting')
          : t('common.designProfileContinue', 'Continue with default appearance')}
      </Button>
    </div>
  </main>;
}
