import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  useActionCenter,
  useApplyActionCenterAction,
} from '@/api/hooks/useActionCenter';
import { useToast } from '@/components/feedback';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button, Pagination } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { Icons } from '@/lib/icons';
import type {
  ActionCenterFilter,
  ActionCenterRecommendation,
  ActionCenterStateAction,
} from '@/types/actionCenter';
import {
  ActionCenterFilters,
  ActionCenterSummary,
  ActionConfirmation,
  ProviderStatusPanel,
  RecommendationList,
  type PendingAction,
} from '../components';

const initialFilter: ActionCenterFilter = { state: 'open', limit: 50, offset: 0 };

export default function ActionCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const [filter, setFilter] = useState<ActionCenterFilter>(() => ({
    ...initialFilter,
    vehicle_id: vehicleId ?? undefined,
  }));
  const [pending, setPending] = useState<PendingAction | null>(null);
  const query = useActionCenter(filter);
  const applyAction = useApplyActionCenterAction();
  usePageTitle(t('actionCenter.page.title', 'Action Center'));

  useEffect(() => {
    setFilter((current) =>
      current.vehicle_id === (vehicleId ?? undefined)
        ? current
        : { ...current, vehicle_id: vehicleId ?? undefined, offset: 0 },
    );
  }, [vehicleId]);

  const handleFilterChange = useCallback(
    (next: ActionCenterFilter) => {
      setFilter(next);
      if (next.vehicle_id != null && next.vehicle_id !== vehicleId) {
        setVehicleId(next.vehicle_id);
      }
    },
    [setVehicleId, vehicleId],
  );

  const handleAction = useCallback(
    (
      recommendation: ActionCenterRecommendation,
      action: ActionCenterStateAction | 'navigate',
    ) => {
      if (action === 'navigate') {
        if (recommendation.navigation_path) navigate(recommendation.navigation_path);
        return;
      }
      setPending({ recommendation, action });
    },
    [navigate],
  );

  const confirmAction = useCallback(async () => {
    if (!pending) return;
    const snoozedUntil =
      pending.action === 'snooze'
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null;
    try {
      await applyAction.mutateAsync({
        recommendation_id: pending.recommendation.id,
        fingerprint: pending.recommendation.fingerprint,
        action: pending.action,
        expected_version: pending.recommendation.current_state.version,
        confirmed: true,
        snoozed_until: snoozedUntil,
      });
      toast.success(
        t('actionCenter.toast.success', 'Action applied'),
        t('actionCenter.toast.successMessage', 'Your decision inbox state was updated.'),
      );
      setPending(null);
    } catch (error) {
      toast.error(
        t('actionCenter.toast.error', 'Action not applied'),
        error instanceof Error
          ? error.message
          : t('actionCenter.toast.errorMessage', 'Refresh and try again.'),
      );
      setPending(null);
    }
  }, [applyAction, pending, t, toast]);

  const pageSize = filter.limit ?? 50;
  const page = Math.floor((filter.offset ?? 0) / pageSize) + 1;
  const RefreshIcon = Icons.refresh;
  const actions = (
    <Button
      type="button"
      variant="secondary"
      icon={<RefreshIcon className="h-4 w-4" aria-hidden="true" />}
      onClick={() => void query.refetch()}
      loading={query.isFetching}
    >
      {t('actionCenter.actions.refresh', 'Refresh evidence')}
    </Button>
  );

  return (
    <PageContainer
      title={t('actionCenter.page.title', 'Action Center')}
      subtitle={t(
        'actionCenter.page.subtitle',
        'A prioritized decision inbox built from existing TeslaSync evidence—not another analytics dashboard.',
      )}
      actions={actions}
      query={query}
      copyLink
    >
      <FadeIn>
        <ActionCenterSummary
          summary={query.data?.summary ?? null}
          loading={query.isLoading}
        />
      </FadeIn>
      <FadeIn delay={0.04}>
        <ActionCenterFilters
          filter={filter}
          vehicles={vehicles}
          onChange={handleFilterChange}
        />
      </FadeIn>
      <FadeIn delay={0.08}>
        <ProviderStatusPanel
          providers={query.data?.provider_status ?? []}
          loading={query.isLoading}
        />
      </FadeIn>
      <FadeIn delay={0.12}>
        <RecommendationList
          items={query.data?.items ?? []}
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          onAction={handleAction}
          onClearFilters={() => setFilter(initialFilter)}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={query.data?.total ?? 0}
          onPageChange={(nextPage) =>
            setFilter((current) => ({
              ...current,
              offset: (nextPage - 1) * pageSize,
            }))
          }
          onPageSizeChange={(size) =>
            setFilter((current) => ({ ...current, limit: size, offset: 0 }))
          }
          pageSizeOptions={[25, 50, 100]}
        />
      </FadeIn>
      <ActionConfirmation
        pending={pending}
        loading={applyAction.isPending}
        onConfirm={() => void confirmAction()}
        onCancel={() => setPending(null)}
      />
    </PageContainer>
  );
}
