/**
 * Warranty & Resale Vault — top-level page.
 *
 * Composes the feature's pure library (canonicalizer / redaction /
 * signer / verifier / report builder) and hooks (evidence composition,
 * disclosure selection, signing-key vault) into five tabs:
 *
 *   1. Evidence        — what data exists for this vehicle (unfiltered).
 *   2. Disclosure       — what the user has chosen to include/exclude.
 *   3. Preview & Sign    — the redacted report + local signing.
 *   4. Import & Verify   — independent verification of any signed report.
 *   5. Audit Trail       — local-only log of vault activity.
 *
 * The `VaultReport` shown in tabs 3-5 is recomputed live via `useMemo`
 * from the current disclosure selection — there is no separate "build"
 * step since `buildVaultReport()` is pure and cheap to recompute on every
 * toggle.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Tabs, type TabItem } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { InlineCallout } from '@/components/feedback';
import { ShieldCheck } from 'lucide-react';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useVaultEvidence } from '../hooks/useVaultEvidence';
import { useDisclosureSelection } from '../hooks/useDisclosureSelection';
import { useSigningVault } from '../hooks/useSigningVault';
import { buildVaultReport } from '../lib/reportBuilder';

import {
  DisclosureProfileBuilder,
  EvidenceInventoryPanel,
  BatterySummaryPanel,
  MaintenanceSummaryPanel,
  SoftwareUpdateSummaryPanel,
  WarrantySummaryPanel,
  IncidentSummaryPanel,
  DrivingChargingSummaryPanel,
  PrivacyPreviewPanel,
  SignatureKeyPanel,
  ExportReportPanel,
  ImportVerifyPanel,
  AuditTrailPanel,
} from '../components';

type VaultTabKey = 'evidence' | 'disclosure' | 'preview' | 'import' | 'audit';

export default function WarrantyResaleVaultPage() {
  const { t } = useTranslation();
  const pageTitle = t('resaleVault.page.title', 'Warranty & Resale Vault');
  usePageTitle(pageTitle);

  const { vehicleId: numericVehicleId } = useSelectedVehicle();
  const vehicleId = numericVehicleId != null ? String(numericVehicleId) : null;

  const disclosure = useDisclosureSelection();
  const { evidence, isLoading, hasPartialErrors } = useVaultEvidence(vehicleId, disclosure.selection.sensitive);
  const vault = useSigningVault();

  const report = useMemo(
    () => buildVaultReport({ disclosure: disclosure.selection, evidence }),
    [disclosure.selection, evidence],
  );

  const [activeTab, setActiveTab] = useState<VaultTabKey>('evidence');

  const tabs: TabItem[] = [
    { key: 'evidence', label: t('resaleVault.tabs.evidence', 'Evidence') },
    { key: 'disclosure', label: t('resaleVault.tabs.disclosure', 'Disclosure Profile') },
    { key: 'preview', label: t('resaleVault.tabs.preview', 'Preview & Sign') },
    { key: 'import', label: t('resaleVault.tabs.import', 'Import & Verify') },
    { key: 'audit', label: t('resaleVault.tabs.audit', 'Audit Trail') },
  ];

  if (numericVehicleId == null) {
    return <NoVehicleSelected pageTitle={pageTitle} />;
  }

  return (
    <PageContainer
      title={pageTitle}
      subtitle={t(
        'resaleVault.page.subtitle',
        'Build a selectively-disclosed, cryptographically signed vehicle-history report — entirely in this browser.',
      )}
    >
      <FadeIn>
        <GlassPanel padding="lg" className="space-y-2">
          <PanelTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
            {t('resaleVault.intro.title', 'Local-first, selectively disclosed')}
          </PanelTitle>
          <HelperText>
            {t(
              'resaleVault.intro.body',
              'Nothing leaves your browser until you explicitly export it. The VIN, precise locations, coordinates, tokens, raw trip paths, and driver identity are never included unless you opt in (VIN) or are always excluded (everything else).',
            )}
          </HelperText>
        </GlassPanel>
      </FadeIn>

      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(key) => setActiveTab(key as VaultTabKey)}
        ariaLabel={t('resaleVault.tabs.ariaLabel', 'Warranty & Resale Vault sections')}
        className="mt-4"
      />

      <div role="tabpanel" className="mt-4 space-y-4">
        {activeTab === 'evidence' && (
          <FadeIn>
            <div className="space-y-4">
              <InlineCallout variant="info" icon={<ShieldCheck />}>
                {t(
                  'resaleVault.evidence.scopeNote',
                  'This tab shows all evidence currently available for this vehicle, regardless of your disclosure selection. Use the Disclosure Profile tab to control what actually leaves your browser.',
                )}
              </InlineCallout>
              <EvidenceInventoryPanel
                evidence={evidence}
                selection={disclosure.selection}
                isLoading={isLoading}
                hasPartialErrors={hasPartialErrors}
              />
              <BatterySummaryPanel battery={evidence.battery} />
              <MaintenanceSummaryPanel maintenance={evidence.maintenance} />
              <SoftwareUpdateSummaryPanel softwareUpdates={evidence.software_updates} />
              <WarrantySummaryPanel warranty={evidence.warranty} />
              <DrivingChargingSummaryPanel driving={evidence.driving_history} charging={evidence.charging_history} />
              <IncidentSummaryPanel incidents={evidence.security_incidents} />
            </div>
          </FadeIn>
        )}

        {activeTab === 'disclosure' && (
          <FadeIn>
            <DisclosureProfileBuilder
              selection={disclosure.selection}
              allSections={disclosure.allSections}
              onProfileChange={disclosure.setProfile}
              onToggleSection={disclosure.toggleSection}
              onVinDisclosureChange={disclosure.setVinDisclosure}
              onExactTimestampsChange={disclosure.setExactTimestamps}
            />
          </FadeIn>
        )}

        {activeTab === 'preview' && (
          <FadeIn>
            <div className="space-y-4">
              <PrivacyPreviewPanel report={report} />
              <SignatureKeyPanel vault={vault} />
              <ExportReportPanel report={report} />
            </div>
          </FadeIn>
        )}

        {activeTab === 'import' && (
          <FadeIn>
            <ImportVerifyPanel />
          </FadeIn>
        )}

        {activeTab === 'audit' && (
          <FadeIn>
            <AuditTrailPanel />
          </FadeIn>
        )}
      </div>
    </PageContainer>
  );
}
