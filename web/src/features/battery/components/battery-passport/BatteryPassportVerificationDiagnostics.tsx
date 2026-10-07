import {
  Fingerprint,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  Badge,
  Code,
  GlassPanel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type {
  BatteryPassportQueryState,
  BatteryPassportVerificationState,
} from './types';

interface BatteryPassportVerificationDiagnosticsProps {
  state: BatteryPassportQueryState;
  verification: BatteryPassportVerificationState;
}

function hashPrefix(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '—';
  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}

export function BatteryPassportVerificationDiagnostics({
  state,
  verification,
}: BatteryPassportVerificationDiagnosticsProps) {
  const { t } = useTranslation();
  const statusView = (() => {
    switch (verification.status) {
      case 'loading':
        return {
          variant: 'info' as const,
          label: t(
            'batteryPassport.verification.loading',
            'Verification in progress',
          ),
          Icon: LoaderCircle,
          iconClass: 'animate-spin text-cyan-300',
        };
      case 'refreshing':
        return {
          variant: 'info' as const,
          label: verification.data?.valid === true
            ? t(
                'batteryPassport.verification.refreshingMatch',
                'Refreshing verification — previous result matched',
              )
            : t(
                'batteryPassport.verification.refreshingMismatch',
                'Refreshing verification — previous result did not match',
              ),
          Icon: LoaderCircle,
          iconClass: 'animate-spin text-cyan-300',
        };
      case 'valid':
        return {
          variant: 'success' as const,
          label: t(
            'batteryPassport.verification.valid',
            'Current digest match',
          ),
          Icon: ShieldCheck,
          iconClass: 'text-emerald-300',
        };
      case 'mismatch':
        return {
          variant: 'danger' as const,
          label: t(
            'batteryPassport.verification.mismatch',
            'Digest mismatch',
          ),
          Icon: ShieldAlert,
          iconClass: 'text-rose-300',
        };
      case 'error':
        return {
          variant: 'warning' as const,
          label: t(
            'batteryPassport.verification.error',
            'Verification unavailable',
          ),
          Icon: ShieldQuestion,
          iconClass: 'text-amber-300',
        };
      default:
        return {
          variant: 'neutral' as const,
          label: t(
            'batteryPassport.verification.unavailable',
            'Not checked',
          ),
          Icon: ShieldQuestion,
          iconClass: 'text-[var(--text-muted)]',
        };
    }
  })();
  const expected = verification.data?.expected_hash;
  const provided = verification.data?.provided_hash
    ?? state.passport?.provenance_hash;

  return (
    <section data-testid="battery-passport-verification-diagnostics">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Fingerprint
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.verification.title',
            'Verification diagnostics',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.verification.subtitle',
            'Current server recomputation compared with the supplied certificate digest.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="flex flex-wrap items-center gap-3">
            <statusView.Icon
              className={cn('h-5 w-5', statusView.iconClass)}
              aria-hidden="true"
            />
            <Badge variant={statusView.variant} size="lg">
              {statusView.label}
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="caption">
                {t(
                  'batteryPassport.verification.expectedPrefix',
                  'Expected hash prefix',
                )}
              </Text>
              <Code className="mt-1 break-all">
                {hashPrefix(expected)}
              </Code>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="caption">
                {t(
                  'batteryPassport.verification.providedPrefix',
                  'Provided hash prefix',
                )}
              </Text>
              <Code className="mt-1 break-all">
                {hashPrefix(provided)}
              </Code>
            </div>
          </div>
          <AlertBanner
            className="mt-4"
            variant={
              verification.status === 'mismatch'
                ? 'warning'
                : 'info'
            }
          >
            <Text as="p" variant="caption">
              {verification.status === 'refreshing'
                ? t(
                    'batteryPassport.verification.refreshingNotice',
                    'A verification refetch is in progress. The displayed hashes and result are from the previous response, not a current digest comparison.',
                  )
                : verification.status === 'mismatch'
                ? t(
                    'batteryPassport.verification.mismatchNotice',
                    'The freshly recomputed digest does not match the supplied digest. Current evidence or the UTC issue day may have changed; this result alone does not identify why.',
                  )
                : t(
                    'batteryPassport.verification.notice',
                    'A match means current recomputation produced the supplied digest. It does not establish that upstream telemetry, aggregates, reference capacity, or server methodology are correct.',
                  )}
            </Text>
          </AlertBanner>
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
