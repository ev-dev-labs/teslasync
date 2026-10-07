import {
  Award,
  CircleCheck,
  Equal,
  Gauge,
  Minus,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { BatteryPassportAnalysis } from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportGradeAuditProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

export function BatteryPassportGradeAudit({
  analysis,
  state,
}: BatteryPassportGradeAuditProps) {
  const { t } = useTranslation();
  const grade = analysis.grade;

  return (
    <section data-testid="battery-passport-grade-audit">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Award className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'batteryPassport.gradeAudit.title',
            'Grade and scoring reconstruction',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.gradeAudit.subtitle',
            'Transparent frontend reconstruction of the documented server rule; not an independent calibration or hash-bound fact.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <Text as="code" mono variant="bodySm" className="break-words">
              {t(
                'batteryPassport.gradeAudit.formula',
                'score = clamp(soh_pct - 8 × fast_charge_ratio - 12 × clamp(equivalent_full_cycles / 1500, 0, 1), 0, 100)',
              )}
            </Text>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label={t(
                'batteryPassport.gradeAudit.base',
                'Clamped SoH term',
              )}
              value={grade.clampedSohPct != null
                ? fmtNumber(grade.clampedSohPct, 2)
                : '—'}
              subtitle={t(
                'batteryPassport.gradeAudit.baseHint',
                'formula input',
              )}
              icon={<Gauge className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'batteryPassport.gradeAudit.fastPenalty',
                'Fast-share deduction',
              )}
              value={grade.fastChargePenalty != null
                ? fmtNumber(grade.fastChargePenalty, 2)
                : '—'}
              subtitle={t(
                'batteryPassport.gradeAudit.fastPenaltyHint',
                '8 × clamped session share',
              )}
              icon={<Minus className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'batteryPassport.gradeAudit.cyclePenalty',
                'EFC deduction',
              )}
              value={grade.cyclePenalty != null
                ? fmtNumber(grade.cyclePenalty, 2)
                : '—'}
              subtitle={t(
                'batteryPassport.gradeAudit.cyclePenaltyHint',
                'up to 12 points at 1,500 EFC',
              )}
              icon={<Minus className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'batteryPassport.gradeAudit.score',
                'Reconstructed score',
              )}
              value={grade.score != null
                ? fmtNumber(grade.score, 2)
                : '—'}
              subtitle={t(
                'batteryPassport.gradeAudit.bands',
                'A≥90, B≥80, C≥70, D≥60, E≥50, F below',
              )}
              icon={<Equal className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'batteryPassport.gradeAudit.reconstructed',
                'Reconstructed grade',
              )}
              value={grade.grade ?? '—'}
              subtitle={t(
                'batteryPassport.gradeAudit.frontend',
                'frontend audit output',
              )}
              icon={<Award className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'batteryPassport.gradeAudit.reported',
                'Certificate-reported grade',
              )}
              value={grade.reportedGrade ?? '—'}
              subtitle={t(
                'batteryPassport.gradeAudit.server',
                'health_grade response field',
              )}
              icon={<Award className="h-5 w-5" />}
              color="red"
            />
          </div>
          {grade.status === 'unavailable' ? (
            <AlertBanner className="mt-4" variant="warning">
              <Text as="p" variant="caption">
                {grade.unavailableReason === 'unknown_soh'
                  ? t(
                      'batteryPassport.gradeAudit.unavailableSoh',
                      'The server marks SoH as unavailable (soh_pct = 0 and health_grade = N/A), so no score or grade is reconstructed.',
                    )
                  : t(
                      'batteryPassport.gradeAudit.unavailable',
                      'The reconstruction is unavailable because at least one numeric formula input is non-finite.',
                    )}
              </Text>
            </AlertBanner>
          ) : grade.matchesReported === false ? (
            <AlertBanner
              className="mt-4"
              variant="danger"
              icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
            >
              <Text as="p" variant="caption">
                {t(
                  'batteryPassport.gradeAudit.mismatch',
                  'Grade mismatch: the certificate-reported grade differs from the transparent reconstruction. The values are shown separately and are not reconciled.',
                )}
              </Text>
            </AlertBanner>
          ) : grade.matchesReported === true ? (
            <AlertBanner
              className="mt-4"
              variant="success"
              icon={<CircleCheck className="h-4 w-4" aria-hidden="true" />}
            >
              <Text as="p" variant="caption">
                {t(
                  'batteryPassport.gradeAudit.match',
                  'The certificate-reported grade matches the transparent reconstruction for these returned inputs.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}
