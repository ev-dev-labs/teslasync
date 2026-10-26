import {
  Award,
  Download,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AlertBanner,
  EmptyState,
  QueryError,
  Skeleton,
} from '@/components/feedback';
import {
  Badge,
  Button,
  Caption,
  CopyButton,
  GlassPanel,
  PanelTitle,
  Text, IconButton } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type {
  BatteryPassportQueryState,
  BatteryPassportVerificationState,
} from './types';

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

interface BatteryPassportMastheadProps {
  state: BatteryPassportQueryState;
  verification: BatteryPassportVerificationState;
  locale: string;
  timeZone: string;
  onExport: () => void;
}

function gradeClass(grade: string): string {
  switch (grade.trim().toUpperCase()) {
    case 'A':
      return 'text-[var(--semantic-success)]';
    case 'B':
    case 'C':
      return 'text-[var(--semantic-info)]';
    case 'D':
    case 'E':
      return 'text-[var(--semantic-warning)]';
    case 'F':
      return 'text-[var(--semantic-danger)]';
    default:
      return 'text-[var(--text-muted)]';
  }
}

export function BatteryPassportMasthead({
  state,
  verification,
  locale,
  timeZone,
  onExport,
}: BatteryPassportMastheadProps) {
  const { t } = useTranslation();
  const passport = state.passport;
  const verificationView: {
    variant: BadgeVariant;
    label: string;
    Icon: typeof ShieldCheck;
  } = (() => {
    switch (verification.status) {
      case 'loading':
        return {
          variant: 'neutral',
          label: t(
            'batteryPassport.verification.loading',
            'Verification in progress',
          ),
          Icon: ShieldQuestion,
        };
      case 'refreshing':
        return {
          variant: 'info',
          label: verification.data?.valid === true
            ? t(
                'batteryPassport.verification.refreshingMatch',
                'Refreshing verification — previous result matched',
              )
            : t(
                'batteryPassport.verification.refreshingMismatch',
                'Refreshing verification — previous result did not match',
              ),
          Icon: RefreshCw,
        };
      case 'error':
        return {
          variant: 'warning',
          label: t(
            'batteryPassport.verification.error',
            'Verification unavailable',
          ),
          Icon: ShieldQuestion,
        };
      case 'mismatch':
        return {
          variant: 'danger',
          label: t(
            'batteryPassport.verification.mismatch',
            'Digest mismatch',
          ),
          Icon: ShieldAlert,
        };
      case 'valid':
        return {
          variant: 'success',
          label: t(
            'batteryPassport.verification.valid',
            'Current digest match',
          ),
          Icon: ShieldCheck,
        };
      default:
        return {
          variant: 'neutral',
          label: t(
            'batteryPassport.verification.unavailable',
            'Not checked',
          ),
          Icon: ShieldQuestion,
        };
    }
  })();

  return (
    <section
      data-testid="battery-passport-masthead"
      aria-label={t(
        'batteryPassport.masthead.aria',
        'Certificate identity and controls',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <FileCheck2
                className="h-4 w-4 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              {t(
                'batteryPassport.masthead.title',
                'Certificate identity',
              )}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'batteryPassport.masthead.subtitle',
                'Current server-issued certificate facts, digest status, vehicle selection, and canonical JSON export.',
              )}
            </Text>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            <IconButton icon={<Download className="h-4 w-4" />} label={t(
                'batteryPassport.actions.export',
                'Export certificate',
              )} onClick={onExport} disabled={!passport} />
          </div>
        </div>

        {!state.vehicleSelected ? (
          <EmptyState /* no-action: certificate evidence appears only when the selected vehicle has source data */
            className="py-7"
            icon={<FileCheck2 className="h-7 w-7" aria-hidden="true" />}
            title={t(
              'batteryPassport.states.noVehicleTitle',
              'No vehicle selected',
            )}
            message={t(
              'batteryPassport.states.noVehicle',
              'Select a vehicle above to request its current certificate.',
            )}
          />
        ) : state.isLoading ? (
          <div
            role="status"
            aria-label={t(
              'batteryPassport.states.loadingAria',
              'Loading battery passport evidence',
            )}
          >
            <Skeleton height={128} />
          </div>
        ) : state.initialError ? (
          <div data-testid="battery-passport-initial-error">
            <QueryError
              error={state.initialError}
              onRetry={state.onRetry}
            />
          </div>
        ) : passport ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <Award className="h-4 w-4" aria-hidden="true" />
                  <Caption>
                    {t(
                      'batteryPassport.masthead.eyebrow',
                      'Battery evidence certificate',
                    )}
                  </Caption>
                </div>
                <Text
                  as="p"
                  size="xl"
                  weight="bold"
                  color="primary"
                  mono
                  className="mt-1 truncate"
                >
                  {passport.vin_masked
                    || t(
                      'batteryPassport.masthead.unknownVin',
                      'VIN mask unavailable',
                    )}
                </Text>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <Caption>
                      {t(
                        'batteryPassport.masthead.vehicleId',
                        'Vehicle ID',
                      )}
                    </Caption>
                    <Text as="p" size="sm" color="secondary" mono>
                      {Number.isFinite(passport.vehicle_id)
                        ? passport.vehicle_id
                        : '—'}
                    </Text>
                  </div>
                  <div>
                    <Caption>
                      {t(
                        'batteryPassport.masthead.issued',
                        'Issued',
                      )}
                    </Caption>
                    <Text as="p" size="sm" color="secondary">
                      {formatDateTime(passport.issued_at, {
                        locale,
                        tz: timeZone,
                      })}
                    </Text>
                  </div>
                  <div>
                    <Caption>
                      {t(
                        'batteryPassport.masthead.firstObserved',
                        'First observed date',
                      )}
                    </Caption>
                    <Text as="p" size="sm" color="secondary">
                      {formatDate(passport.first_observed_at, {
                        locale,
                        tz: timeZone,
                      })}
                    </Text>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <Badge
                  variant={verificationView.variant}
                  size="lg"
                  className="gap-1.5"
                >
                  <verificationView.Icon
                    className={cn(
                      'h-4 w-4',
                      verification.status === 'refreshing'
                        && 'animate-spin',
                    )}
                    aria-hidden="true"
                  />
                  {verificationView.label}
                </Badge>
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      'text-5xl font-bold leading-none',
                      gradeClass(passport.health_grade ?? ''),
                    )}
                    aria-hidden="true"
                  >
                    {passport.health_grade || '—'}
                  </span>
                  <Caption className="mt-1">
                    {t(
                      'batteryPassport.masthead.reportedGrade',
                      'Certificate-reported grade',
                    )}
                  </Caption>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <Text
                as="code"
                mono
                size="xs"
                color="secondary"
                className="break-all"
              >
                {passport.provenance_hash || '—'}
              </Text>
              <CopyButton
                text={passport.provenance_hash ?? ''}
                withToast
                label={t(
                  'batteryPassport.actions.copyHash',
                  'Copy certificate hash',
                )}
                className="shrink-0"
              />
            </div>
            {state.refreshError ? (
              <AlertBanner
                variant="warning"
                role="alert"
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Text as="p" variant="caption">
                    {t(
                      'batteryPassport.states.refreshError',
                      'Certificate refresh failed. Showing the most recently loaded certificate without changing its facts.',
                    )}
                  </Text>
                  <Button type="button" variant="ghost" size="sm" onClick={state.onRetry}>
                    {t('common.retry', 'Retry')}
                  </Button>
                </div>
              </AlertBanner>
            ) : null}
          </div>
        ) : state.refreshError ? (
          <div data-testid="battery-passport-empty-refresh-error">
            <QueryError
              error={state.refreshError}
              onRetry={state.onRetry}
            />
          </div>
        ) : state.isResolved ? (
          <EmptyState /* no-action: certificate evidence appears only when the selected vehicle has source data */
            className="py-7"
            icon={<FileCheck2 className="h-7 w-7" aria-hidden="true" />}
            message={t(
              'batteryPassport.states.empty',
              'The endpoint returned no certificate for this vehicle.',
            )}
          />
        ) : (
          <EmptyState /* no-action: certificate evidence appears only when the selected vehicle has source data */
            className="py-7"
            message={t(
              'batteryPassport.states.pending',
              'Certificate availability has not resolved.',
            )}
          />
        )}
      </GlassPanel>
    </section>
  );
}
