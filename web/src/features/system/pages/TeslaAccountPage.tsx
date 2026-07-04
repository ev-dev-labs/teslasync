import { useTranslation } from 'react-i18next';
import {
  RefreshCw, User, Mail, Hash, CalendarClock, Clock, CheckCircle2,
  ContactRound, Activity, Link2,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, Badge, StatusPill, Heading, Text, Label, Caption, HelperText } from '@/components/ui';
import { MetricCard, KVList, Avatar, Timeline } from '@/components/data-display';
import { QueryError, EmptyState, Skeleton, StatGridSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useTeslaUserProfile, useRefreshTeslaProfile } from '@/api/hooks/useUser';
import { formatDate, formatDateTime, formatRelative } from '@/lib/dateFormat';

/* Timeline dot hues — toned, CB-safe accents (cyan / purple / emerald). Kept as
 * module-scope data so the Timeline `color` prop receives a stable value. */
const ACTIVITY_COLORS = {
  linked: '#22d3ee',
  updated: '#a78bfa',
  synced: '#34d399',
} as const;

export default function TeslaAccountPage() {
  const { t } = useTranslation();
  usePageTitle(t('teslaAccount.title', 'Tesla Account'));

  const profileQuery = useTeslaUserProfile();
  const { data, isLoading, isError, error, refetch } = profileQuery;
  const refreshMutation = useRefreshTeslaProfile();

  const profile = data?.profile ?? null;
  const hasProfile = profile != null;
  const fetchedAt = profile?.fetched_at ?? data?.fetched_at ?? null;

  const accountId = profile?.id != null ? `#${profile.id}` : '—';
  const memberSince = profile?.created_at ? formatDate(profile.created_at) : '—';
  const lastUpdated = profile?.updated_at ? formatRelative(profile.updated_at) : '—';

  const refresh = () => refreshMutation.mutate();

  const resourceName = t('teslaAccount.resource', 'Tesla profile');
  const retry = () => { void refetch(); };

  const actions = (
    <Button
      onClick={refresh}
      loading={refreshMutation.isPending}
      icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      aria-label={t('teslaAccount.refresh', 'Refresh from Tesla')}
    >
      {t('teslaAccount.refresh', 'Refresh from Tesla')}
    </Button>
  );

  return (
    <PageContainer
      title={t('teslaAccount.title', 'Tesla Account')}
      subtitle={t('teslaAccount.subtitle', 'Your Tesla account profile synced from the Fleet API')}
      actions={actions}
      query={profileQuery}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('teslaAccount.kpis', 'Account summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {isLoading ? (
            <StatGridSkeleton cards={4} className="col-span-2 lg:col-span-4" />
          ) : isError ? (
            <GlassPanel className="col-span-2 p-4 sm:p-5 lg:col-span-4">
              <QueryError error={error} onRetry={retry} resourceName={resourceName} />
            </GlassPanel>
          ) : (
            <>
              <MetricCard
                label={t('teslaAccount.kpi.sync', 'Sync Status')}
                value={fetchedAt ? t('teslaAccount.synced', 'Synced') : t('teslaAccount.never', 'Never synced')}
                color={fetchedAt ? 'green' : 'amber'}
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                subtitle={fetchedAt ? formatRelative(fetchedAt) : t('teslaAccount.neverSyncedShort', 'Not synced yet')}
              />
              <MetricCard
                label={t('teslaAccount.kpi.accountId', 'Account ID')}
                value={accountId}
                color="cyan"
                icon={<Hash className="h-5 w-5" aria-hidden="true" />}
                subtitle={t('teslaAccount.kpi.accountIdSub', 'Fleet API identity')}
              />
              <MetricCard
                label={t('teslaAccount.kpi.memberSince', 'Member Since')}
                value={memberSince}
                color="purple"
                icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
                subtitle={profile?.created_at ? formatRelative(profile.created_at) : '—'}
              />
              <MetricCard
                label={t('teslaAccount.kpi.updated', 'Last Updated')}
                value={lastUpdated}
                color="blue"
                icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                subtitle={profile?.updated_at ? formatDate(profile.updated_at) : '—'}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero identity + Sync center */}
      <FadeIn delay={0.05}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <User className="h-4 w-4 text-cyan-300" aria-hidden="true" />
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
                  <Text as="p" size="xl" weight="bold" color="primary" className="truncate">
                    {profile.full_name || t('teslaAccount.unnamed', 'Tesla Driver')}
                  </Text>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <Text as="span" variant="body" className="truncate">
                      {profile.email || '—'}
                    </Text>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Badge variant="neutral">
                      <Hash className="h-3 w-3" aria-hidden="true" />
                      {accountId}
                    </Badge>
                    <StatusPill color={fetchedAt ? 'bg-emerald-400' : 'bg-amber-400'}>
                      {fetchedAt
                        ? t('teslaAccount.synced', 'Synced')
                        : t('teslaAccount.never', 'Never synced')}
                    </StatusPill>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: EmptyState already renders the Refresh CTA below */
                icon={<User className="h-10 w-10" aria-hidden="true" />}
                title={t('teslaAccount.noProfileTitle', 'No profile synced yet')}
                message={t('teslaAccount.noProfile', 'No profile data yet. Click "Refresh from Tesla" to sync your account.')}
                action={{ label: t('teslaAccount.refresh', 'Refresh from Tesla'), onClick: refresh }}
              />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('teslaAccount.sync.title', 'Sync')}
            </Heading>
            <div className="space-y-4">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-4">
                <Label>{t('teslaAccount.sync.lastSynced', 'Last synced')}</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Clock className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                  <Text as="span" variant="body">
                    {fetchedAt ? formatRelative(fetchedAt) : t('teslaAccount.neverSyncedShort', 'Not synced yet')}
                  </Text>
                </div>
                {fetchedAt && <Caption className="mt-1 block">{formatDateTime(fetchedAt)}</Caption>}
              </div>
              <Button
                variant="primary"
                className="w-full min-h-11"
                onClick={refresh}
                loading={refreshMutation.isPending}
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
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
          <GlassPanel className="p-4 sm:p-5">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <ContactRound className="h-4 w-4 text-indigo-300" aria-hidden="true" />
              {t('teslaAccount.details.title', 'Account Details')}
            </Heading>
            {isLoading ? (
              <Skeleton height={180} />
            ) : isError ? (
              <QueryError error={error} onRetry={retry} resourceName={resourceName} />
            ) : hasProfile ? (
              <KVList
                items={[
                  { label: t('teslaAccount.name', 'Name'), value: profile.full_name || '—' },
                  { label: t('teslaAccount.email', 'Email'), value: profile.email || '—' },
                  {
                    label: t('teslaAccount.accountId', 'Account ID'),
                    value: <Text as="span" mono>{accountId}</Text>,
                  },
                  {
                    label: t('teslaAccount.image', 'Profile Image'),
                    value: profile.profile_image_url
                      ? t('teslaAccount.imageAvailable', 'Available')
                      : t('teslaAccount.imageNone', 'Not set'),
                  },
                  { label: t('teslaAccount.fetchedAt', 'Fetched At'), value: formatDateTime(profile.fetched_at) },
                ]}
              />
            ) : (
              <EmptyState /* no-action: transient empty — recover via header/sync Refresh */
                icon={<ContactRound className="h-10 w-10" aria-hidden="true" />}
                message={t('teslaAccount.detailsEmpty', 'No account details yet. Sync to populate your profile.')}
              />
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <Heading level="panel" as="h2" className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-purple-300" aria-hidden="true" />
              {t('teslaAccount.activity.title', 'Activity')}
            </Heading>
            {isLoading ? (
              <Skeleton height={180} />
            ) : isError ? (
              <QueryError error={error} onRetry={retry} resourceName={resourceName} />
            ) : hasProfile ? (
              <Timeline
                items={[
                  {
                    icon: <Link2 className="h-3 w-3" aria-hidden="true" />,
                    title: t('teslaAccount.activity.linked', 'Account linked'),
                    subtitle: t('teslaAccount.activity.linkedSub', 'Tesla account connected to TeslaSync'),
                    time: formatDateTime(profile.created_at),
                    color: ACTIVITY_COLORS.linked,
                  },
                  {
                    icon: <RefreshCw className="h-3 w-3" aria-hidden="true" />,
                    title: t('teslaAccount.activity.updated', 'Profile updated'),
                    subtitle: t('teslaAccount.activity.updatedSub', 'Most recent change to your profile record'),
                    time: formatDateTime(profile.updated_at),
                    color: ACTIVITY_COLORS.updated,
                  },
                  {
                    icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
                    title: t('teslaAccount.activity.synced', 'Last synced from Tesla'),
                    subtitle: t('teslaAccount.activity.syncedSub', 'Latest fetch from the Fleet API'),
                    time: formatDateTime(fetchedAt),
                    color: ACTIVITY_COLORS.synced,
                  },
                ]}
              />
            ) : (
              <EmptyState /* no-action: transient empty — recover via header/sync Refresh */
                icon={<Activity className="h-10 w-10" aria-hidden="true" />}
                message={t('teslaAccount.activity.empty', 'No account activity to show yet.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
