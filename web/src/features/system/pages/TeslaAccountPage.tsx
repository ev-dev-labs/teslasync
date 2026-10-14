import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, User, Mail, Hash, Clock, CheckCircle2,
  ContactRound, Activity, Link2,
} from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, Button, Badge, StatusPill, Heading, Text, Label, Caption, HelperText, Icon } from '@/components/ui';
import { KVList, Avatar, Timeline } from '@/components/data-display';
import { QueryError, EmptyState, Skeleton, StaleRefreshWarning, OperationalWriteNotice } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useTeslaUserProfile, useRefreshTeslaProfile } from '@/api/hooks/useUser';
import { getTeslaAccountSyncStatus, TeslaAccountStatStrip } from '../components/statstrip-tesla-account/TeslaAccountStatStrip';

export default function TeslaAccountPage() {
  const { t } = useTranslation();
  const { formatDateTime, formatRelative } = useDateFormat();
  const { canWrite, writeBlockReason } = useOperationalMode();
  const refreshInFlight = useRef(false);
  usePageTitle(t('teslaAccount.title', 'Tesla account'));

  const profileQuery = useTeslaUserProfile();
  const { data, isLoading: queryLoading, refetch } = profileQuery;
  const profileState = useDataState(profileQuery);
  const isLoading = profileState.status === 'initial' && !profileState.isRefreshBlocked
    && (queryLoading || profileQuery.isFetching);
  const error = profileState.fatalError;
  const isError = !!error;
  const isUnresolved = profileState.status === 'initial';
  const refreshMutation = useRefreshTeslaProfile();

  const profile = data?.profile ?? null;
  const hasProfile = profile != null;
  const fetchedAt = profile?.fetched_at ?? data?.fetched_at ?? null;
  const syncStatus = getTeslaAccountSyncStatus(profile, fetchedAt, profileState.hasData);
  const syncLabel = syncStatus === 'synced' ? t('teslaAccount.synced', 'Synced')
    : syncStatus === 'never-synced' ? t('teslaAccount.never', 'Never synced')
      : t('common.unknown', 'Unknown');
  const activityTimes = [profile?.created_at, profile?.updated_at, fetchedAt].flatMap((iso) => {
    const instant = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(instant) ? [instant] : [];
  });
  const activityBounds = {
    start: activityTimes.length > 0 ? formatDateTime(new Date(Math.min(...activityTimes))) : null,
    end: activityTimes.length > 0 ? formatDateTime(new Date(Math.max(...activityTimes))) : null,
  };

  const accountId = profile?.id != null ? `#${profile.id}` : '—';

  // The ref closes the same-event gap before the mutation's pending render.
  const refresh = () => {
    if (!canWrite || refreshMutation.isPending || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      refreshMutation.mutate(undefined, {
        onSettled: () => { refreshInFlight.current = false; },
      });
    } catch (cause) {
      refreshInFlight.current = false;
      throw cause;
    }
  };

  const resourceName = t('teslaAccount.resource', 'Tesla profile');
  const retry = () => { void refetch(); };
  const unresolvedContent = (
    <div className="space-y-3">
      <Text as="p" variant="bodySm" color="secondary" role="status">
        {profileState.isRefreshBlocked
          ? t('teslaAccount.source.paused', 'Profile loading is paused. No account snapshot has been received yet.')
          : t('teslaAccount.source.pending', 'Account snapshot availability has not resolved yet.')}
      </Text>
      <Button onClick={retry} variant="secondary" wrapLabel className="min-h-11 md:min-h-10">
        {t('common.retry', 'Retry')}
      </Button>
    </div>
  );

  const actions = (
    <Button
      onClick={refresh}
      wrapLabel
      className="min-h-11 min-w-11 md:min-h-10 md:min-w-0"
      loading={refreshMutation.isPending}
      disabled={!canWrite}
      title={writeBlockReason ?? undefined}
      icon={<Icon icon={RefreshCw} />}
      aria-label={t('teslaAccount.refresh', 'Refresh from Tesla')}
    >
      {t('teslaAccount.refresh', 'Refresh from Tesla')}
    </Button>
  );

  return (
    <PageLayout
      title={t('teslaAccount.title', 'Tesla account')}
      subtitle={t('teslaAccount.subtitle', 'Your Tesla account profile synced from the Fleet API')}
      secondaryActions={actions}
      query={profileQuery}
    >
      <OperationalWriteNotice />
      <StaleRefreshWarning state={profileState} />
      {/* 1 — KPI band */}
      <FadeIn>
        <TeslaAccountStatStrip profile={profile} fetchedAt={fetchedAt} hasData={profileState.hasData}
          loading={isLoading} error={error} onRetry={retry}
          retained={profileState.hasData && (profileState.isRefreshing || profileState.status === 'stale')} />
      </FadeIn>

      {/* 2 — Hero identity + Sync center */}
      <FadeIn delay={0.05}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="min-w-0 p-4 sm:p-5 xl:col-span-2">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <Icon icon={User} className="text-[var(--text-muted)]" />
              {t('teslaAccount.profile', 'Profile')}
            </Heading>
            {isLoading ? (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <Skeleton className="h-16 w-16 shrink-0 rounded-full sm:h-20 sm:w-20" />
                <div className="w-full space-y-3">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-64 max-w-full" />
                  <Skeleton className="h-6 w-40" />
                </div>
              </div>
            ) : isError ? (
              <QueryError error={error} onRetry={retry} resourceName={resourceName} />
            ) : isUnresolved ? (
              unresolvedContent
            ) : hasProfile ? (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <Avatar
                  src={profile.profile_image_url}
                  name={profile.full_name}
                  userId={String(profile.id)}
                  size="lg"
                  className="h-16 w-16 shrink-0 sm:h-20 sm:w-20"
                />
                <div className="min-w-0 space-y-2">
                  <Text as="p" size="xl" weight="bold" color="primary" className="whitespace-normal [overflow-wrap:anywhere]">
                    {profile.full_name || t('teslaAccount.unnamed', 'Tesla driver')}
                  </Text>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <Icon icon={Mail} />
                    <Text as="span" variant="body" className="whitespace-normal [overflow-wrap:anywhere]">
                      {profile.email || '—'}
                    </Text>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Badge variant="neutral">
                      <Icon icon={Hash} size="xs" />
                      {accountId}
                    </Badge>
                    <StatusPill color={syncStatus === 'synced' ? 'bg-[var(--semantic-success)]' : 'bg-[var(--text-secondary)]'}>
                      {syncLabel}
                    </StatusPill>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <EmptyState /* no-action: pending-aware shared Button immediately below */
                icon={<Icon icon={User} size="xl" className="h-10 w-10" />}
                title={t('teslaAccount.noProfileTitle', 'No profile synced yet')}
                message={t('teslaAccount.noProfile', 'No profile data yet. Click "Refresh from Tesla" to sync your account.')}
                />
                <div className="flex justify-center">
                  <Button onClick={refresh} loading={refreshMutation.isPending} wrapLabel
                    disabled={!canWrite} title={writeBlockReason ?? undefined}
                    className="min-h-11 min-w-11 md:min-h-10 md:min-w-0">
                    {t('teslaAccount.refresh', 'Refresh from Tesla')}
                  </Button>
                </div>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="min-w-0 p-4 sm:p-5">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <Icon icon={RefreshCw} className="text-[var(--text-muted)]" />
              {t('teslaAccount.sync.title', 'Sync')}
            </Heading>
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
                <Label>{t('teslaAccount.sync.lastSynced', 'Last synced')}</Label>
                {isLoading ? (
                  <Skeleton className="mt-2 h-10 w-full" />
                ) : (
                <div className="mt-1 flex items-center gap-2">
                  <Icon icon={Clock} className="text-[var(--text-muted)]" />
                  <Text as="span" variant="body">
                    {syncStatus === 'synced' ? formatRelative(fetchedAt)
                      : isError ? t('common.unavailable', 'Unavailable')
                      : syncStatus === 'never-synced' ? t('teslaAccount.neverSyncedShort', 'Not synced yet')
                      : t('common.unknown', 'Unknown')}
                  </Text>
                </div>
                )}
                {syncStatus === 'synced' && <Caption className="mt-1 block">{formatDateTime(fetchedAt)}</Caption>}
              </div>
              <Button
                variant="primary"
                wrapLabel
                className="w-full min-h-11"
                onClick={refresh}
                loading={refreshMutation.isPending}
                disabled={!canWrite}
                title={writeBlockReason ?? undefined}
                icon={<Icon icon={RefreshCw} />}
              >
                {t('teslaAccount.refresh', 'Refresh from Tesla')}
              </Button>
              <HelperText>
                {t('teslaAccount.sync.helper', 'Fetches your latest account profile from the Tesla Fleet API.')}
              </HelperText>
            </div>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Account details + Activity */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GlassPanel className="min-w-0 p-4 sm:p-5">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <Icon icon={ContactRound} className="text-[var(--text-muted)]" />
              {t('teslaAccount.details.title', 'Account details')}
            </Heading>
            {isLoading ? (
              <Skeleton height={180} />
            ) : isError ? (
              <QueryError error={error} onRetry={retry} resourceName={resourceName} />
            ) : isUnresolved ? (
              unresolvedContent
            ) : hasProfile ? (
              <KVList
                layout="responsive"
                items={[
                  { label: t('teslaAccount.name', 'Name'), value: profile.full_name || '—' },
                  { label: t('teslaAccount.email', 'Email'), value: profile.email || '—' },
                  {
                    label: t('teslaAccount.accountId', 'Account ID'),
                    value: <Text as="span" mono>{accountId}</Text>,
                  },
                  {
                    label: t('teslaAccount.image', 'Profile image'),
                    value: profile.profile_image_url
                      ? t('teslaAccount.imageAvailable', 'Available')
                      : t('teslaAccount.imageNone', 'Not set'),
                  },
                  { label: t('teslaAccount.fetchedAt', 'Fetched at'), value: formatDateTime(profile.fetched_at) },
                ]}
              />
            ) : (
              <EmptyState /* no-action: transient empty — recover via header/sync Refresh */
                icon={<Icon icon={ContactRound} size="xl" className="h-10 w-10" />}
                message={t('teslaAccount.detailsEmpty', 'No account details yet. Sync to populate your profile.')}
              />
            )}
          </GlassPanel>

          <GlassPanel className="min-w-0 p-4 sm:p-5">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <Icon icon={Activity} className="text-[var(--text-muted)]" />
              {t('teslaAccount.activity.title', 'Activity')}
            </Heading>
            {isLoading ? (
              <Skeleton height={180} />
            ) : isError ? (
              <QueryError error={error} onRetry={retry} resourceName={resourceName} />
            ) : isUnresolved ? (
              unresolvedContent
            ) : hasProfile ? (
              <Timeline
                label={t('teslaAccount.activity.title', 'Activity')}
                chronology="oldest-first"
                summaryBounds={activityBounds}
                items={[
                  {
                    icon: <Icon icon={Link2} size="xs" />,
                    title: t('teslaAccount.activity.linked', 'Account linked'),
                    subtitle: t('teslaAccount.activity.linkedSub', 'Tesla account connected to TeslaSync'),
                    time: formatDateTime(profile.created_at),
                  },
                  {
                    icon: <Icon icon={RefreshCw} size="xs" />,
                    title: t('teslaAccount.activity.updated', 'Profile updated'),
                    subtitle: t('teslaAccount.activity.updatedSub', 'Most recent change to your profile record'),
                    time: formatDateTime(profile.updated_at),
                  },
                  {
                    icon: <Icon icon={CheckCircle2} size="xs" />,
                    title: t('teslaAccount.activity.synced', 'Last synced from Tesla'),
                    subtitle: t('teslaAccount.activity.syncedSub', 'Latest fetch from the Fleet API'),
                    time: formatDateTime(fetchedAt),
                  },
                ]}
              />
            ) : (
              <EmptyState /* no-action: transient empty — recover via header/sync Refresh */
                icon={<Icon icon={Activity} size="xl" className="h-10 w-10" />}
                message={t('teslaAccount.activity.empty', 'No account activity to show yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
