import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, RefreshCw, ArrowRight, BookOpen, ExternalLink, SkipForward } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOnboardingStatus } from '@/api/hooks/useOnboarding';

import { Stepper, type OnboardingStep } from '../components/Stepper';
import { useOnboardingSkip } from '../hooks/useOnboardingSkip';

/**
 * OnboardingPage — Phase 40 / Prompt 18.
 *
 * Dedicated first-run experience shown when any of the three setup
 * anchors are missing. Walks the user through:
 *
 *   1. Connecting their Tesla account (Settings → Tesla account).
 *   2. Waiting for vehicles to sync from the Fleet API.
 *   3. Waiting for the first telemetry batch to arrive.
 *
 * The page is intentionally self-contained — it does NOT pull in the
 * vehicle picker context — so it works on a fresh install where no
 * vehicles or signals exist yet.
 */
export default function OnboardingPage() {
  const { t } = useTranslation();
  usePageTitle(t('onboarding.pageTitle', 'Welcome to TeslaSync'));
  const navigate = useNavigate();
  const { data, isLoading, refetch, isFetching } = useOnboardingStatus();
  const { skip } = useOnboardingSkip();

  const teslaConnected = data?.tesla_connected ?? false;
  const vehicleCount = data?.vehicle_count ?? 0;
  const dataFlowing = data?.data_flowing ?? false;
  const isComplete = data?.is_complete ?? false;

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

  return (
    <PageContainer
      title={t('onboarding.welcome', 'Welcome to TeslaSync')}
      subtitle={t(
        'onboarding.subtitle',
        'Three quick steps before your dashboard is ready.',
      )}
      loading={isLoading}
    >
      <FadeIn>
        <GlassPanel className="p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300"
            >
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {t('onboarding.intro.title', 'Setup checklist')}
              </h2>
              <p className="mt-1 text-sm text-white/60">
                {t(
                  'onboarding.intro.desc',
                  'TeslaSync runs entirely on your hardware. No data leaves your install, and you can revisit this page from Settings any time.',
                )}
              </p>
            </div>
          </div>

          <Stepper
            steps={steps}
            renderCta={(step) => {
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
                    <Button
                      variant="outline"
                      size="sm"
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
                  onClick={step.cta.onClick}
                  disabled={step.cta.disabled}
                  icon={
                    <RefreshCw
                      className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                    />
                  }
                >
                  {step.cta.label}
                </Button>
              );
            }}
          />

          <div className="mt-8 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/60">
              {isComplete
                ? t('onboarding.ready', 'You are all set — your dashboard is ready.')
                : t(
                    'onboarding.polling',
                    'This page refreshes automatically every 30 seconds.',
                  )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void refetch();
                }}
                disabled={isFetching}
                icon={
                  <RefreshCw
                    className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                  />
                }
              >
                {t('onboarding.checkAgain', 'Check again')}
              </Button>
              {!isComplete && (
                <Button
                  variant="outline"
                  size="sm"
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
                  size="sm"
                  onClick={() => navigate('/')}
                  icon={<ArrowRight className="h-4 w-4" />}
                >
                  {t('onboarding.continue', 'Continue to dashboard')}
                </Button>
              )}
            </div>
          </div>

          <p className="mt-6 text-xs text-white/40">
            {t('onboarding.footer.help', 'Need help? See the')}{' '}
            <Link
              to="/tesla-account"
              className="text-cyan-300 underline-offset-2 hover:underline"
            >
              {t('onboarding.footer.account', 'Tesla account page')}
            </Link>
            {t('onboarding.footer.or', ' or the ')}
            <a
              href="/docs/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-cyan-300 underline-offset-2 hover:underline"
            >
              {t('onboarding.footer.docs', 'documentation')}
            </a>
            .
          </p>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
