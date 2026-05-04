import { useTranslation } from 'react-i18next';
import { RefreshCw, User, ImageOff } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { KVList } from '@/components/data-display';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useTeslaUserProfile, useRefreshTeslaProfile } from '@/api/hooks/useUser';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';

export default function TeslaAccountPage() {
  const { t } = useTranslation();
  usePageTitle(t('teslaAccount.title', 'Tesla Account'));

  const { data, isLoading, error } = useTeslaUserProfile();
  const refreshMutation = useRefreshTeslaProfile();

  const profile = data?.profile ?? null;
  const fetchedAt = data?.fetched_at ?? null;

  return (
    <PageContainer
      title={t('teslaAccount.title', 'Tesla Account')}
      subtitle={t('teslaAccount.subtitle', 'Your Tesla account profile synced from the Fleet API')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
    >
      {/* Sync bar */}
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-[var(--text-secondary)]">
            {fetchedAt
              ? t('teslaAccount.lastSynced', 'Last synced: {{time}}', { time: formatRelative(fetchedAt) })
              : t('teslaAccount.neverSynced', 'Never synced — click Refresh to fetch from Tesla')}
          </p>
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            aria-label={t('teslaAccount.refresh', 'Refresh from Tesla')}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            {t('teslaAccount.refresh', 'Refresh from Tesla')}
          </Button>
        </div>
      </FadeIn>

      {/* Profile card */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
            {t('teslaAccount.profile', 'Profile')}
          </h2>
          {profile ? (
            <div className="flex items-start gap-6">
              {/* Avatar */}
              <div className="flex-shrink-0">
                {profile.profile_image_url ? (
                  <img
                    src={profile.profile_image_url}
                    alt={t('teslaAccount.avatar', 'Profile picture')}
                    className="h-20 w-20 rounded-full border-2 border-[var(--border-subtle)] object-cover"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full border-2 border-[var(--border-subtle)] bg-white/[0.04] flex items-center justify-center">
                    <ImageOff className="h-8 w-8 text-[var(--text-muted)]" />
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <KVList
                  items={[
                    {
                      label: t('teslaAccount.name', 'Name'),
                      value: profile.full_name || '—',
                    },
                    {
                      label: t('teslaAccount.email', 'Email'),
                      value: profile.email || '—',
                    },
                    {
                      label: t('teslaAccount.fetchedAt', 'Fetched At'),
                      value: formatDateTime(profile.fetched_at),
                    },
                  ]}
                />
              </div>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<User className="h-10 w-10" />}
              message={t('teslaAccount.noProfile', 'No profile data yet. Click "Refresh from Tesla" to sync your account.')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
