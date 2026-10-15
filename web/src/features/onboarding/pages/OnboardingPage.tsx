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
  SlidersHorizontal,
} from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { PersonaSelect } from '@/components/forms';
import { GlassPanel, Button, BUTTON_BASE, BUTTON_VARIANTS, IconBox, SectionTitle, Text } from '@/components/ui';
import { AnnouncerRegion, VisuallyHidden } from '@/components/a11y';
import { FadeIn } from '@/components/motion';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { deriveDataState } from '@/api/dataState';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDocumentHidden } from '@/hooks/useRefreshPolicy';
import { useLoadAnnouncement } from '@/hooks/useStatusAnnouncer';
import { useProductPreferences } from '@/hooks/useProductPreferences';
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
 * Laid out as a full-width bento: a compact setup-status OperationalBrief, a hero row
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
  const onboardingQuery = useOnboardingStatus();
  const { data, isLoading, refetch, isFetching } = onboardingQuery;
  const onboardingState = deriveDataState(onboardingQuery);
  useLoadAnnouncement({
    label: t('onboarding.status.sectionLabel', 'Setup status'),
    isLoading: !onboardingState.hasData && !onboardingState.fatalError,
    isError: Boolean(onboardingState.fatalError),
  });
  const { skip } = useOnboardingSkip();
  const { preferences, updatePreferences } = useProductPreferences();
  const { reduce } = useMotionPreference();
  const documentHidden = useDocumentHidden();
  const refreshIconClassName = cn(
    'h-4 w-4 motion-reduce:animate-none',
    isFetching && !reduce && 'animate-spin',
  );

  const teslaConnected = data?.tesla_connected ?? false;
  const vehicleCount = data?.vehicle_count ?? 0;
  const dataFlowing = data?.data_flowing ?? false;
  const telemetryHealth = data?.telemetry_health ?? 'unknown';
  const setupComplete = data?.setup_complete ?? data?.is_complete ?? false;
  const isComplete = setupComplete;
  const pausedTitle = t('dataSources.status.paused', 'Refresh paused');
  const pausedRetainedMessage = t(
    'maintenance.sources.refreshBlocked',
    'Refresh is paused. Retained data remains available.',
  );

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: 'tesla',
        title: t('onboarding.tesla.title', 'Connect your Tesla account'),
        description: t(
          'onboarding.tesla.desc',
          'TeslaSync needs Fleet API access to read vehicle data. Sign in with your Tesla account to authorize the connection.',
        ),
        done: onboardingState.hasData ? setupComplete || teslaConnected : null,
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
        done: onboardingState.hasData ? setupComplete || vehicleCount > 0 : null,
        busy: isFetching,
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
        done: onboardingState.hasData ? setupComplete || dataFlowing : null,
        cta: {
          label: t('onboarding.telemetry.docs', 'Setup guide'),
          href: '/docs/fleet-telemetry-setup',
        },
      },
    ],
    [onboardingState.hasData, setupComplete, teslaConnected, vehicleCount, dataFlowing, refetch, isFetching, t],
  );

  const renderCta = (step: OnboardingStep): ReactNode => {
    if (!step.cta) return null;
    if (step.cta.to) {
      return (
        <Button
          variant="primary"
          wrapLabel
          size="sm"
          className="min-h-11 md:min-h-9"
          onClick={() => navigate(step.cta!.to!)}
          icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
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
          aria-labelledby={`onboarding-step-${step.key}-cta-label onboarding-step-${step.key}-cta-new-tab`}
          className={cn(
            BUTTON_BASE,
            BUTTON_VARIANTS.outline,
            'h-auto min-h-11 w-full min-w-0 max-w-full whitespace-normal px-3 py-1.5 md:min-h-9 sm:w-auto',
            reduce && 'transition-none',
          )}
        >
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          <Text
            id={`onboarding-step-${step.key}-cta-label`}
            as="span"
            size="sm"
            weight="medium"
            color="primary"
            className="min-w-0 break-words"
          >
            {step.cta.label}
          </Text>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          <VisuallyHidden id={`onboarding-step-${step.key}-cta-new-tab`}>
            {t('onboarding.resources.newTab', '(opens in a new tab)')}
          </VisuallyHidden>
        </a>
      );
    }
    return (
      <Button
        variant="outline"
        wrapLabel
        size="sm"
        className="min-h-11 w-full md:min-h-9 sm:w-auto"
        onClick={step.cta.onClick}
        disabled={step.cta.disabled}
        icon={<RefreshCw className={refreshIconClassName} aria-hidden="true" />}
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
      {/* This standalone route does not mount Layout's announcer. */}
      <AnnouncerRegion />
      <PageLayout
        title={t('onboarding.welcome', 'Welcome to TeslaSync')}
        subtitle={
          setupComplete
            ? t(
                'onboarding.subtitleComplete',
                'Your setup stays complete even when a live service is temporarily unavailable.',
              )
            : t('onboarding.subtitle', 'Three quick steps before your dashboard is ready.')
        }
        className="w-full min-w-0 pb-8 sm:pb-10"
        busy={isLoading || isFetching}
        announce={false}
      >
        <StaleRefreshWarning
          state={onboardingState}
          title={onboardingState.isRefreshBlocked ? pausedTitle : undefined}
          message={onboardingState.isRefreshBlocked ? pausedRetainedMessage : undefined}
          hideRetry
        />
        {/* 1 — Existing setup-status summary; the checklist remains interactive below. */}
        <FadeIn>
          <OnboardingSetupStatusBand
            teslaConnected={teslaConnected}
            vehicleCount={vehicleCount}
            telemetryHealth={telemetryHealth}
            setupComplete={setupComplete}
            isLoading={isLoading}
            hasData={Boolean(data)}
            retained={onboardingState.status === 'stale'}
            lastTelemetryAt={data?.last_telemetry_at ?? null}
            error={onboardingState.fatalError}
            onRetry={() => void refetch()}
          />
        </FadeIn>

        <OnboardingRuntimeHealthNotice
          setupComplete={setupComplete}
          teslaConnected={teslaConnected}
          telemetryHealth={telemetryHealth}
          lastTelemetryAt={data?.last_telemetry_at ?? null}
        />

        <FadeIn delay={0.08}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <IconBox color="neutral" size="md">
                  <SlidersHorizontal className="h-5 w-5" aria-hidden />
                </IconBox>
                <div className="min-w-0">
                  <SectionTitle>
                    {t(
                      'onboarding.workspaceProfile.title',
                      'Tailor your workspace',
                    )}
                  </SectionTitle>
                  <Text variant="bodySm" as="p" className="mt-1 max-w-3xl">
                    {t(
                      'onboarding.workspaceProfile.description',
                      'Choose the perspective that best matches your work. TeslaSync will prioritize navigation and discovery without hiding features or changing permissions.',
                    )}
                  </Text>
                </div>
              </div>
              <PersonaSelect
                id="onboarding-workspace-profile"
                value={preferences.persona}
                onChange={(persona) => updatePreferences({ persona })}
                label={t(
                  'onboarding.workspaceProfile.label',
                  'Primary use',
                )}
              />
            </div>
          </GlassPanel>
        </FadeIn>

        {/* 2 — Hero bento: setup checklist (primary) + resources (context) */}
        <FadeIn delay={0.15}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <GlassPanel className="p-4 sm:p-6 xl:col-span-2">
              <div className="mb-5 flex items-start gap-3">
                <IconBox color="neutral" size="md">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
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

              {!onboardingState.hasData && (
                <AlertBanner
                  variant="info"
                  title={onboardingState.isRefreshBlocked
                    ? pausedTitle
                    : t('onboarding.brief.notReceived', 'Setup status not yet received')}
                  className="mb-5"
                  data-testid="onboarding-status-pending"
                  data-refresh-blocked={onboardingState.isRefreshBlocked || undefined}
                >
                  {t(
                    'onboarding.brief.missing',
                    'Setup status has not been received; no completed-step or vehicle count is known.',
                  )}
                </AlertBanner>
              )}
              <Stepper steps={steps} renderCta={renderCta} />
            </GlassPanel>

            <OnboardingResources className="xl:col-span-1" />
          </section>
        </FadeIn>

        {/* 3 — What you'll unlock once setup completes (full-width band) */}
        <FadeIn delay={0.25}>
          <section className="space-y-3 sm:space-y-4">
            <SectionTitle>{t('onboarding.unlock.title', "What you'll unlock")}</SectionTitle>
            <OnboardingFeaturePreview />
          </section>
        </FadeIn>

        {/* 4 — Footer action band: status + refresh + skip / continue */}
        <FadeIn delay={0.35}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Text variant="bodySm" as="p">
                {isComplete
                  ? t('onboarding.ready', 'You are all set — your dashboard is ready.')
                  : onboardingState.isRefreshBlocked || documentHidden
                    ? pausedTitle
                    : t('onboarding.polling', 'This page refreshes automatically every 30 seconds.')}
              </Text>
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button
                  variant="ghost"
                  wrapLabel
                  className="min-h-11 w-full md:min-h-10 sm:w-auto"
                  onClick={() => {
                    void refetch();
                  }}
                  disabled={isFetching}
                  icon={<RefreshCw className={refreshIconClassName} aria-hidden="true" />}
                >
                  {t('onboarding.checkAgain', 'Check again')}
                </Button>
                {!isComplete && (
                  <Button
                    variant="outline"
                    wrapLabel
                    className="min-h-11 w-full md:min-h-10 sm:w-auto"
                    onClick={() => {
                      skip();
                      navigate('/');
                    }}
                    title={t(
                      'onboarding.skipHint',
                      'Explore the app — you can finish setup later from this page.',
                    )}
                    icon={<SkipForward className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('onboarding.skip', 'Skip for now')}
                  </Button>
                )}
                {isComplete && (
                  <Button
                    variant="primary"
                    wrapLabel
                    className="min-h-11 w-full md:min-h-10 sm:w-auto"
                    onClick={() => navigate('/')}
                    icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('onboarding.continue', 'Continue to dashboard')}
                  </Button>
                )}
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      </PageLayout>
    </main>
  );
}
