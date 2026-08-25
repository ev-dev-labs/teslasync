import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAsOfDate } from './useAsOfDate';
import { useOnlineStatus } from './useOnlineStatus';
import {
  deriveOperationalMode,
  type OperationalMode,
} from '@/lib/operationalMode';
import { formatDateTime } from '@/lib/dateFormat';

export interface OperationalModeContextValue {
  mode: OperationalMode;
  asOf: string | null;
  online: boolean;
  isReadOnly: boolean;
  label: string;
  description: string;
  writeBlockReason: string | null;
  canWrite: boolean;
}

const LIVE_DEFAULT: OperationalModeContextValue = {
  mode: 'live',
  asOf: null,
  online: true,
  isReadOnly: false,
  label: 'Live',
  description: 'Current data with live actions available.',
  writeBlockReason: null,
  canWrite: true,
};

const OperationalModeContext =
  createContext<OperationalModeContextValue>(LIVE_DEFAULT);

export function OperationalModeProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { asOf } = useAsOfDate();
  const online = useOnlineStatus();
  const snapshot = useMemo(
    () => deriveOperationalMode(asOf, online),
    [asOf, online],
  );

  const value = useMemo<OperationalModeContextValue>(() => {
    if (snapshot.mode === 'as_of') {
      const when = snapshot.asOf
        ? formatDateTime(snapshot.asOf, { locale: i18n.language })
        : '';
      return {
        ...snapshot,
        label: t('operationalMode.asOf.label', 'As of {{when}}', { when }),
        description: t(
          'operationalMode.asOf.description',
          'Historical state reconstructed at {{when}}. Operational changes are disabled.',
          { when },
        ),
        writeBlockReason: t(
          'operationalMode.asOf.writeBlocked',
          'Return to live mode before making operational changes.',
        ),
        canWrite: false,
      };
    }

    if (snapshot.mode === 'cached') {
      return {
        ...snapshot,
        label: t('operationalMode.cached.label', 'Cached'),
        description: t(
          'operationalMode.cached.description',
          'The connection is offline. Retained data remains available, but it may be stale.',
        ),
        writeBlockReason: t(
          'operationalMode.cached.writeBlocked',
          'Reconnect before making operational changes.',
        ),
        canWrite: false,
      };
    }

    return {
      ...snapshot,
      label: t('operationalMode.live.label', 'Live'),
      description: t(
        'operationalMode.live.description',
        'Current data with live actions available.',
      ),
      writeBlockReason: null,
      canWrite: true,
    };
  }, [i18n.language, snapshot, t]);

  useEffect(() => {
    document.body.dataset.operationalMode = value.mode;
    return () => {
      delete document.body.dataset.operationalMode;
    };
  }, [value.mode]);

  return (
    <OperationalModeContext.Provider value={value}>
      {children}
    </OperationalModeContext.Provider>
  );
}

export function useOperationalMode(): OperationalModeContextValue {
  return useContext(OperationalModeContext);
}
