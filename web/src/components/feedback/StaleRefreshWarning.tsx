import { type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { Button, Text } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import { DataStateNotice } from './DataStateNotice';

export interface StaleRefreshWarningProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  /** The panel's data state. Render this ABOVE the retained content. */
  state: DataState<unknown>;
  /** Human label for the source, used in the default message. */
  label?: string;
  title?: string;
  message?: string;
  /** Hide the retry control (e.g. the page already offers a global refresh). */
  hideRetry?: boolean;
}

/**
 * Non-blocking "the refresh failed, what you see is retained" warning.
 *
 * This is the shared answer to the single most damaging data-trust bug in the
 * SPA: a background refetch fails, the page swaps its populated table for a
 * full-bleed error card, and the operator loses the rows they were reading —
 * rows that are still perfectly valid, just a minute older.
 *
 * Usage contract:
 *
 *   - Mount it **next to** retained content, never instead of it.
 *   - Wire page-level error surfaces to `state.fatalError` (only set when
 *     nothing is retained), never to the raw query `error`.
 *   - It renders `null` for `ok` and for `initial`/`initialFailure`, because
 *     those are handled by the skeleton and the page error surface
 *     respectively. Its whole job is the middle ground everyone forgets.
 *
 * ```tsx
 * const drives = deriveDataState(drivesQuery, { provenance: 'operational' });
 * <PageContainer error={drives.fatalError}>
 *   <StaleRefreshWarning state={drives} label={t('drives.title')} />
 *   <DrivesTable rows={drives.data ?? []} />
 * </PageContainer>
 * ```
 */
export function StaleRefreshWarning({
  state,
  label,
  title,
  message,
  hideRetry = false,
  ...props
}: StaleRefreshWarningProps) {
  const { t } = useTranslation();

  // `initial` and `initialFailure` mean there is nothing retained; those are
  // the skeleton's and the page error surface's job, not this component's.
  if (!state.hasData) return null;
  if (state.status === 'ok') return null;

  const noticeState = state.status === 'partial'
    ? 'partial'
    : state.status === 'unavailable'
      ? 'unavailable'
      : 'stale';

  const defaultMessage = state.isRefreshBlocked
    ? t(
        'dataState.refreshBlocked.message',
        'The device is offline, so this section is showing the last values it received.',
      )
    : state.refreshError != null
      ? t(
          'dataSources.staleMessage',
          'Previously loaded data remains visible while affected sources recover.',
        )
      : t(
          'dataState.stale.message',
          'The latest values are temporarily unavailable. Previously loaded data remains visible.',
        );

  const defaultTitle = label != null
    ? t('dataState.staleNamed.title', '{{label}} may be out of date', { label })
    : t('dataState.stale.title', 'Data may be stale');

  return (
    <DataStateNotice
      {...props}
      state={noticeState}
      title={title ?? defaultTitle}
      role="status"
      aria-live="polite"
      data-testid="stale-refresh-warning"
    >
      <div className="space-y-2">
        <Text as="p" variant="bodySm">{message ?? defaultMessage}</Text>
        {!hideRetry && state.retry != null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.retry}
            disabled={state.isRefreshing}
            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            {state.isRefreshing
              ? t('freshness.updating', 'Updating…')
              : t('common.refresh', 'Refresh')}
          </Button>
        ) : null}
      </div>
    </DataStateNotice>
  );
}
