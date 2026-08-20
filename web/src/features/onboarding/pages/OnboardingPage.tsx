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
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, IconBox, SectionTitle, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOnboardingStatus } from '@/api/hooks/useOnboarding';
import { cn } from '@/lib/cn';

import { Stepper, type OnboardingStep } from '../components/Stepper';
import { OnboardingResources } from '../components/OnboardingResources';
import { OnboardingFeaturePreview } from '../components/OnboardingFeaturePreview';
import { OnboardingRuntimeHealthNotice } from '../components/OnboardingRuntimeHealthNotice';
import { OnboardingSetupStatusBand } from '../components/OnboardingSetupStatusBand';
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

export default function OnboardingPage() {
  const { t } = useTranslation();
  usePageTitle(t('onboarding.pageTitle', 'Welcome to TeslaSync'));
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isFetching } = useOnboardingStatus();
  const { skip } = useOnboardingSkip();

  const teslaConnected = data?.tesla_connected ?? false;
  const vehicleCount = data?.vehicle_count ?? 0;
  const dataFlowing = data?.data_flowing ?? false;
  const telemetryHealth = data?.telemetry_health ?? 'unknown';
  const setupComplete = data?.setup_complete ?? data?.is_complete ?? false;
  const isComplete = setupComplete;

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: 'tesla',
        title: t('onboarding.tesla.title', 'Connect your Tesla account'),
        description: t(
          'onboarding.tesla.desc',
          'TeslaSync needs Fleet API access to read vehicle data. Sign in with your Tesla account to authorize the connection.',
        ),
        done: setupComplete || teslaConnected,
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
        done: setupComplete || vehicleCount > 0,
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
        done: setupComplete || dataFlowing,
        cta: {
          label: t('onboarding.telemetry.docs', 'Setup guide'),
          href: '/docs/fleet-telemetry-setup',
        },
      },
    ],
    [setupComplete, teslaConnected, vehicleCount, dataFlowing, refetch, isFetching, t],
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
          className="block w-full sm:inline-block sm:w-auto"
        >
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            icon={<BookOpen className="h-4 w-4" />}
          >
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
        className="w-full sm:w-auto"
        onClick={step.cta.onClick}
        disabled={step.cta.disabled}
        icon={<RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />}
      >
        {step.cta.label}
      </Button>
    );
  };

  return (
    <main
      data-testid="onboarding-scroll-container"
      className="h-screen h-dvh overflow-y-auto overscroll-y-contain bg-[var(--bg)] px-3 py-4 pb-safe [touch-action:pan-y] sm:px-5 sm:py-6 lg:px-8 lg:py-8"
    >
      <PageContainer
        title={t('onboarding.welcome', 'Welcome to TeslaSync')}
        subtitle={
          setupComplete
            ? t(
                'onboarding.subtitleComplete',
                'Your setup stays complete even when a live service is temporarily unavailable.',
              )
            : t('onboarding.subtitle', 'Three quick steps before your dashboard is ready.')
        }
        className="mx-auto w-full max-w-[1600px] pb-8 sm:pb-10"
      >
        {/* 1 — Setup-status KPI band (full-width responsive grid) */}
        <FadeIn>
          <OnboardingSetupStatusBand
            teslaConnected={teslaConnected}
            vehicleCount={vehicleCount}
            telemetryHealth={telemetryHealth}
            setupComplete={setupComplete}
            isLoading={isLoading}
            hasData={Boolean(data)}
            error={isError ? error : null}
            onRetry={() => void refetch()}
          />
        </FadeIn>

        <OnboardingRuntimeHealthNotice
          setupComplete={setupComplete}
          teslaConnected={teslaConnected}
          telemetryHealth={telemetryHealth}
          lastTelemetryAt={data?.last_telemetry_at ?? null}
        />

        {/* 2 — Hero bento: setup checklist (primary) + resources (context) */}
        <FadeIn delay={0.1}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <GlassPanel className="p-4 sm:p-6 xl:col-span-2">
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
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button
                  variant="ghost"
                  className="w-full sm:w-auto"
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
                    className="w-full sm:w-auto"
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
                    className="w-full sm:w-auto"
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
    </main>
  );
}
