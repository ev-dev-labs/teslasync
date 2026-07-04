import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  RefreshCw,
  ArrowRight,
  BookOpen,
  ExternalLink,
  SkipForward,
  Plug,
  Car,
  Activity,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, IconBox, SectionTitle, Text } from '@/components/ui';
import { ProgressRing } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOnboardingStatus } from '@/api/hooks/useOnboarding';
import { cn } from '@/lib/cn';
import { type NeonColor } from '@/lib/tokens';

import { Stepper, type OnboardingStep } from '../components/Stepper';
import {
  OnboardingStatusCard,
  type OnboardingStatusCardProps,
} from '../components/OnboardingStatusCard';
import { OnboardingResources } from '../components/OnboardingResources';
import { OnboardingFeaturePreview } from '../components/OnboardingFeaturePreview';
import { useOnboardingSkip } from '../hooks/useOnboardingSkip';

/**
 * OnboardingPage.
 *
 * Dedicated first-run experience shown when any of the three setup
 * anchors are missing. Walks the user through:
 *
 *   1. Connecting their Tesla account (Settings → Tesla account).
 *   2. Waiting for vehicles to sync from the Fleet API.
 *   3. Waiting for the first telemetry batch to arrive.
 *
 * Laid out as a full-width bento: a setup-status KPI band, a hero row
 * pairing the setup checklist with a resources panel, a preview of what
 * unlocks once setup completes, and a footer action band. The page is
 * intentionally self-contained — it does NOT pull in the vehicle picker
 * context — so it works on a fresh install where no vehicles or signals
 * exist yet.
 */

/** Status-card view model — omits the presentational-only `loading` flag. */
type StatusCard = Omit<OnboardingStatusCardProps, 'loading'> & { id: string };

export default function OnboardingPage() {
  const { t } = useTranslation();
  usePageTitle(t('onboarding.pageTitle', 'Welcome to TeslaSync'));
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isFetching } = useOnboardingStatus();
  const { skip } = useOnboardingSkip();

  const teslaConnected = data?.tesla_connected ?? false;
  const vehicleCount = data?.vehicle_count ?? 0;
  const dataFlowing = data?.data_flowing ?? false;
  const isComplete = data?.is_complete ?? false;

  const completedCount = [teslaConnected, vehicleCount > 0, dataFlowing].filter(Boolean).length;

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: 'tesla',
        title: t('onboarding.tesla.title', 'Connect your Tesla account'),
        description: t(
          'onboarding.tesla.desc',
          'TeslaSync needs Fleet API access to read vehicle data. Sign in with your Tesla account to authorize the connection.',
        ),
        done: teslaConnected,
        cta: {
          label: t('onboarding.tesla.cta', 'Connect Tesla account'),
          to: '/tesla-account',
        },
      },
      {
        key: 'vehicle',
        title: t('onboarding.vehicle.title', 'Wait for vehicles to appear'),
        description: t(
          'onboarding.vehicle.desc',
          'Vehicles linked to your Tesla account will sync automatically. This usually takes less than a minute after connecting.',
        ),
        done: vehicleCount > 0,
        cta: {
          label: isFetching
            ? t('onboarding.vehicle.checking', 'Checking…')
            : t('onboarding.vehicle.cta', 'Refresh'),
          onClick: () => {
            void refetch();
          },
          disabled: isFetching,
        },
      },
      {
        key: 'telemetry',
        title: t('onboarding.telemetry.title', 'Wait for telemetry data'),
        description: t(
          'onboarding.telemetry.desc',
          'Once your vehicle uploads its first signal batch (usually within 5 minutes of driving), live data will appear across the app. See the Fleet Telemetry setup guide if it does not arrive.',
        ),
        done: dataFlowing,
        cta: {
          label: t('onboarding.telemetry.docs', 'Setup guide'),
          href: '/docs/fleet-telemetry-setup',
        },
      },
    ],
    [teslaConnected, vehicleCount, dataFlowing, refetch, isFetching, t],
  );

  const statusCards = useMemo<StatusCard[]>(
    () => [
      {
        id: 'tesla',
        icon: <Plug className="h-5 w-5" />,
        color: 'cyan' as NeonColor,
        label: t('onboarding.status.tesla.label', 'Tesla account'),
        value: teslaConnected
          ? t('onboarding.status.tesla.connected', 'Connected')
          : t('onboarding.status.tesla.pending', 'Not connected'),
        done: teslaConnected,
        hint: teslaConnected
          ? t('onboarding.status.tesla.hintDone', 'Fleet API access authorized')
          : t('onboarding.status.tesla.hint', 'Sign in to authorize access'),
      },
      {
        id: 'vehicles',
        icon: <Car className="h-5 w-5" />,
        color: 'purple' as NeonColor,
        label: t('onboarding.status.vehicles.label', 'Vehicles synced'),
        value: String(vehicleCount),
        done: vehicleCount > 0,
        hint:
          vehicleCount > 0
            ? t('onboarding.status.vehicles.hintDone', 'Synced from the Fleet API')
            : t('onboarding.status.vehicles.hint', 'Waiting for the first sync'),
      },
      {
        id: 'telemetry',
        icon: <Activity className="h-5 w-5" />,
        color: 'green' as NeonColor,
        label: t('onboarding.status.telemetry.label', 'Telemetry'),
        value: dataFlowing
          ? t('onboarding.status.telemetry.flowing', 'Flowing')
          : t('onboarding.status.telemetry.waiting', 'Waiting'),
        done: dataFlowing,
        hint: dataFlowing
          ? t('onboarding.status.telemetry.hintDone', 'Live signals arriving')
          : t('onboarding.status.telemetry.hint', 'No signals received yet'),
      },
    ],
    [teslaConnected, vehicleCount, dataFlowing, t],
  );

  const renderCta = (step: OnboardingStep): ReactNode => {
    if (!step.cta) return null;
    if (step.cta.to) {
      return (
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate(step.cta!.to!)}
          icon={<ArrowRight className="h-4 w-4" />}
        >
          {step.cta.label}
        </Button>
      );
    }
    if (step.cta.href) {
      return (
        <a
          href={step.cta.href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-block"
        >
          <Button variant="outline" size="sm" icon={<BookOpen className="h-4 w-4" />}>
            <span className="inline-flex items-center gap-1.5">
              {step.cta.label}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </span>
          </Button>
        </a>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={step.cta.onClick}
        disabled={step.cta.disabled}
        icon={<RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />}
      >
        {step.cta.label}
      </Button>
    );
  };

  return (
    <PageContainer
      title={t('onboarding.welcome', 'Welcome to TeslaSync')}
      subtitle={t('onboarding.subtitle', 'Three quick steps before your dashboard is ready.')}
    >
      {/* 1 — Setup-status KPI band (full-width responsive grid) */}
      <FadeIn>
        <section
          aria-label={t('onboarding.status.sectionLabel', 'Setup status')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={error} onRetry={() => void refetch()} />
            </GlassPanel>
          ) : (
            <>
              <GlassPanel className="p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Text variant="metricLabel" as="p">
                      {t('onboarding.progress.label', 'Setup progress')}
                    </Text>
                    <Text as="p" size="lg" weight="semibold" color="primary" className="mt-1.5">
                      {t('onboarding.progress.value', '{{done}}/{{total}}', {
                        done: completedCount,
                        total: 3,
                      })}
                    </Text>
                    <Text variant="caption" as="p" className="mt-1">
                      {isComplete
                        ? t('onboarding.progress.allDone', 'All steps complete')
                        : t('onboarding.progress.hint', 'Steps complete')}
                    </Text>
                  </div>
                  <ProgressRing
                    value={completedCount}
                    max={3}
                    size={60}
                    strokeWidth={6}
                    color={isComplete ? '#10b981' : '#22d3ee'}
                    centerLabel={`${completedCount}/3`}
                  />
                </div>
              </GlassPanel>

              {statusCards.map((card) => (
                <OnboardingStatusCard
                  key={card.id}
                  icon={card.icon}
                  color={card.color}
                  label={card.label}
                  value={card.value}
                  done={card.done}
                  hint={card.hint}
                  loading={isLoading && !data}
                />
              ))}
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero bento: setup checklist (primary) + resources (context) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-5 sm:p-6 xl:col-span-2">
            <div className="mb-5 flex items-start gap-3">
              <IconBox color="cyan" size="md">
                <Sparkles className="h-5 w-5" />
              </IconBox>
              <div className="min-w-0">
                <SectionTitle>{t('onboarding.intro.title', 'Setup checklist')}</SectionTitle>
                <Text variant="bodySm" as="p" className="mt-1 max-w-2xl">
                  {t(
                    'onboarding.intro.desc',
                    'TeslaSync runs entirely on your hardware. No data leaves your install, and you can revisit this page from Settings any time.',
                  )}
                </Text>
              </div>
            </div>

            <Stepper steps={steps} renderCta={renderCta} />
          </GlassPanel>

          <OnboardingResources className="xl:col-span-1" />
        </section>
      </FadeIn>

      {/* 3 — What you'll unlock once setup completes (full-width band) */}
      <FadeIn delay={0.2}>
        <section className="space-y-3 sm:space-y-4">
          <SectionTitle>{t('onboarding.unlock.title', "What you'll unlock")}</SectionTitle>
          <OnboardingFeaturePreview />
        </section>
      </FadeIn>

      {/* 4 — Footer action band: status + refresh + skip / continue */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Text variant="bodySm" as="p">
              {isComplete
                ? t('onboarding.ready', 'You are all set — your dashboard is ready.')
                : t('onboarding.polling', 'This page refreshes automatically every 30 seconds.')}
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  void refetch();
                }}
                disabled={isFetching}
                icon={<RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />}
              >
                {t('onboarding.checkAgain', 'Check again')}
              </Button>
              {!isComplete && (
                <Button
                  variant="outline"
                  onClick={() => {
                    skip();
                    navigate('/');
                  }}
                  title={t(
                    'onboarding.skipHint',
                    'Explore the app — you can finish setup later from this page.',
                  )}
                  icon={<SkipForward className="h-4 w-4" />}
                >
                  {t('onboarding.skip', 'Skip for now')}
                </Button>
              )}
              {isComplete && (
                <Button
                  variant="primary"
                  onClick={() => navigate('/')}
                  icon={<ArrowRight className="h-4 w-4" />}
                >
                  {t('onboarding.continue', 'Continue to dashboard')}
                </Button>
              )}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
