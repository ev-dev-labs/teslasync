import { Binary } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeSectionProps } from './types';

export function ArchetypeExactAccounting({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const source = summary.source;
  const clusterMembers = summary.clusters.reduce(
    (total, cluster) => total + cluster.size,
    0,
  );
  const selectedCandidates = summary.candidates.filter(
    (candidate) => candidate.selected,
  ).length;
  const directoryDriveIds = new Set(
    summary.directory.items.map((assignment) => assignment.driveId),
  );
  const outsideDirectory = summary.assignments.filter(
    (assignment) => !directoryDriveIds.has(assignment.driveId),
  ).length;
  const identities = [
    {
      label: t('archetypes.accounting.source', 'Returned-row identity'),
      equation: t(
        'archetypes.accounting.sourceEquation',
        '{{returned}} returned = {{invalidRow}} invalid row + {{invalidId}} invalid ID + {{duplicate}} duplicate + {{missingStart}} missing start + {{invalidStart}} invalid start + {{invalidDistance}} invalid distance + {{short}} short distance + {{missingEnergy}} missing energy + {{invalidEnergy}} invalid energy + {{missingSpeed}} missing speed + {{invalidSpeed}} invalid speed + {{observed}} eligible measured-temperature + {{imputed}} eligible imputed-temperature.',
        {
          returned: fmtInt(source.returnedRows),
          invalidRow: fmtInt(source.invalidRowRows),
          invalidId: fmtInt(source.invalidIdRows),
          duplicate: fmtInt(source.duplicateDriveRows),
          missingStart: fmtInt(source.missingStartRows),
          invalidStart: fmtInt(source.invalidStartRows),
          invalidDistance: fmtInt(source.invalidDistanceRows),
          short: fmtInt(source.shortDistanceRows),
          missingEnergy: fmtInt(source.missingEnergyRows),
          invalidEnergy: fmtInt(source.invalidEnergyRows),
          missingSpeed: fmtInt(source.missingSpeedRows),
          invalidSpeed: fmtInt(source.invalidSpeedRows),
          observed: fmtInt(source.eligibleObservedTempRows),
          imputed: fmtInt(source.eligibleImputedTempRows),
        },
      ),
      balanced: summary.identities.sourceRowsBalanced,
    },
    {
      label: t('archetypes.accounting.eligible', 'Eligible-row identity'),
      equation: t(
        'archetypes.accounting.eligibleEquation',
        '{{eligible}} eligible = {{observed}} measured-temperature + {{imputed}} imputed-temperature.',
        {
          eligible: fmtInt(summary.analyzedDrives),
          observed: fmtInt(source.eligibleObservedTempRows),
          imputed: fmtInt(source.eligibleImputedTempRows),
        },
      ),
      balanced: summary.identities.eligibleRowsBalanced,
    },
    {
      label: t('archetypes.accounting.membership', 'Cluster-membership identity'),
      equation: summary.status === 'clustered'
        ? t(
            'archetypes.accounting.membershipEquation',
            '{{members}} cluster members = {{eligible}} eligible drives.',
            {
              members: fmtInt(clusterMembers),
              eligible: fmtInt(summary.analyzedDrives),
            },
          )
        : t(
            'archetypes.accounting.membershipWithheld',
            'No partition is published in the current model status; membership accounting is not applicable.',
          ),
      balanced: summary.identities.clusterMembershipBalanced,
    },
    {
      label: t('archetypes.accounting.assignments', 'Assignment identity'),
      equation: summary.status === 'clustered'
        ? t(
            'archetypes.accounting.assignmentEquation',
            '{{assignments}} assignments = {{eligible}} eligible drives.',
            {
              assignments: fmtInt(summary.assignments.length),
              eligible: fmtInt(summary.analyzedDrives),
            },
          )
        : t(
            'archetypes.accounting.assignmentsWithheld',
            'Assignments remain empty until a partition is published.',
          ),
      balanced: summary.identities.assignmentsBalanced,
    },
    {
      label: t('archetypes.accounting.directory', 'Directory identity'),
      equation: t(
        'archetypes.accounting.directoryEquation',
        '{{assignments}} independently counted assignment IDs = {{displayed}} displayed directory IDs + {{outside}} assignment IDs outside the directory.',
        {
          assignments: fmtInt(summary.assignments.length),
          displayed: fmtInt(directoryDriveIds.size),
          outside: fmtInt(outsideDirectory),
        },
      ),
      balanced: summary.identities.directoryBalanced,
    },
    {
      label: t('archetypes.accounting.candidate', 'Selected-candidate identity'),
      equation: summary.status === 'clustered'
        ? t(
            'archetypes.accounting.candidateEquation',
            '{{selected}} of {{candidates}} feasible candidates is selected.',
            {
              selected: fmtInt(selectedCandidates),
              candidates: fmtInt(summary.candidates.length),
            },
          )
        : t(
            'archetypes.accounting.candidateWithheld',
            'No candidate is selected while clustering is withheld.',
          ),
      balanced: summary.identities.selectedCandidateBalanced,
    },
  ];

  return (
    <section data-testid="drive-archetypes-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('archetypes.accounting.title', 'Exact accounting identities')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'archetypes.accounting.subtitle',
            'Independent identities reconcile source outcomes, eligibility, memberships, assignments, the directory, and model selection.',
          )}
        </Text>
        <ArchetypeSectionBody summary={summary} state={state} requirement="resolved">
          <Grid cols={{ default: 1, xl: 2 }} gap={3}>
            {identities.map((identity) => (
              <div
                key={identity.label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <MetricLabel>{identity.label}</MetricLabel>
                  <Badge variant={identity.balanced ? 'success' : 'danger'}>
                    {identity.balanced
                      ? t('archetypes.common.balanced', 'Balances')
                      : t('archetypes.common.mismatch', 'Mismatch')}
                  </Badge>
                </div>
                <Text as="p" variant="bodySm" className="mt-2">
                  {identity.equation}
                </Text>
              </div>
            ))}
          </Grid>
        </ArchetypeSectionBody>
      </GlassPanel>
    </section>
  );
}
