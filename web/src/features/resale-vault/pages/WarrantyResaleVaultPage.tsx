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
import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout, LayoutCard } from '@/components/layout';
import { Tabs, HelperText, Icon, type TabItem } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { InlineCallout } from '@/components/feedback';
import { ShieldCheck } from 'lucide-react';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { typography } from '@/lib/tokens';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useVaultEvidence } from '../hooks/useVaultEvidence';
import { useDisclosureSelection } from '../hooks/useDisclosureSelection';
import { useSigningVault } from '../hooks/useSigningVault';
import { buildVaultReport } from '../lib/reportBuilder';
import type { ExportReportPanelProps } from '../components/ExportReportPanel';
import { getReportSourcePolicy } from '../components/ExportReportPanel';
import { getSigningKeyCapabilitySnapshot, getSigningKeysSnapshot, subscribeSigningKeys } from '../lib/signingKeyRepository';

import {
  DisclosureProfileBuilder,
  EvidenceInventoryPanel,
  BatterySummaryPanel,
  BatteryCertificatePanel,
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
  const pageTitle = t('resaleVault.page.title', 'Warranty & resale vault');
  usePageTitle(pageTitle);

  const { vehicleId: numericVehicleId } = useSelectedVehicle();
  const vehicleId = numericVehicleId != null ? String(numericVehicleId) : null;
  const vehicleScope = useRef({ vehicleId });
  if (vehicleScope.current.vehicleId !== vehicleId) vehicleScope.current = { vehicleId };
  const scope = vehicleScope.current;
  const [retainedExport, setRetainedExport] = useState<{
    scope: object;
    snapshot: NonNullable<ExportReportPanelProps['retainedExport']>;
  } | null>(null);

  const disclosure = useDisclosureSelection();
  const { evidence, isLoading, hasPartialErrors, sources } = useVaultEvidence(vehicleId, disclosure.selection.sensitive);
  const vault = useSigningVault();
  const registry = useSyncExternalStore(subscribeSigningKeys, getSigningKeysSnapshot);
  const keys = useMemo(
    () => [...registry].reverse().sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [registry],
  );
  const [signingOperation, setSigningOperation] = useState<object | null>(null);
  const signingOperationRef = useRef<object | null>(null);
  const reconciledVault = {
    ...vault,
    capability: getSigningKeyCapabilitySnapshot() ?? vault.capability,
    keys,
    activeKey: keys.find((key) => key.revoked_at === null) ?? null,
    isMutating: vault.isMutating || signingOperation !== null,
  };

  const assembledReport = useMemo(
    () => buildVaultReport({ disclosure: disclosure.selection, evidence }),
    [disclosure.selection, evidence],
  );
  const sourceLimitations = getReportSourcePolicy(assembledReport, sources).limitations.join('\n');
  const report = useMemo(
    () => ({
      ...assembledReport,
      time_bounds: { ...assembledReport.time_bounds, generated_at: new Date().toISOString() },
      limitations: [...assembledReport.limitations, ...sourceLimitations.split('\n').filter(Boolean)],
    }),
    [assembledReport, sourceLimitations],
  );

  const [activeTab, setActiveTab] = useState<VaultTabKey>('evidence');
  const tabIdBase = useId();

  const tabs: TabItem[] = [
    { key: 'evidence', label: t('resaleVault.tabs.evidence', 'Evidence') },
    { key: 'disclosure', label: t('resaleVault.tabs.disclosure', 'Disclosure profile') },
    { key: 'preview', label: t('resaleVault.tabs.preview', 'Preview & sign') },
    { key: 'import', label: t('resaleVault.tabs.import', 'Import & verify') },
    { key: 'audit', label: t('resaleVault.tabs.audit', 'Audit trail') },
  ];

  if (numericVehicleId == null) {
    return <NoVehicleSelected pageTitle={pageTitle} />;
  }

  return (
    <PageLayout
      title={pageTitle}
      subtitle={t(
        'resaleVault.page.localReportSubtitle',
        'Assemble and sign a selectively disclosed vehicle-history report in this browser using evidence fetched from the server.',
      )}
    >
      <FadeIn>
        <LayoutCard title={t('resaleVault.intro.title', 'Local-first, selectively disclosed')}
          actions={<Icon icon={ShieldCheck} className={typography.color.muted} />}>
          <HelperText>
            {t(
              'resaleVault.intro.localReportBody',
              'Vault report assembly, report signing, imported report verification, signing keys, and the audit trail stay in this browser. You choose when to export or copy the vault report. The report excludes VIN unless you opt in, and always excludes precise locations, coordinates, tokens, raw trip paths, and driver identity.',
            )}
          </HelperText>
          <HelperText>
            {t(
              'resaleVault.intro.serverCertificateBody',
              'The battery certificate is a separate server-signed attestation: opening Evidence fetches it from the server for the selected vehicle and automatically sends its certificate payload and signature to the server for verification. These requests do not wait for a report export and are not controlled by the vault disclosure profile.',
            )}
          </HelperText>
        </LayoutCard>
      </FadeIn>

      <Tabs
        idBase={tabIdBase}
        tabs={tabs}
        activeTab={activeTab}
        onChange={(key) => setActiveTab(key as VaultTabKey)}
        ariaLabel={t('resaleVault.tabs.ariaLabel', 'Warranty & resale vault sections')}
        className="mt-4"
      />

      <div
        role="tabpanel"
        id={`${tabIdBase}-panel-${activeTab}`}
        aria-labelledby={`${tabIdBase}-tab-${activeTab}`}
        tabIndex={0}
        className="mt-4 min-w-0 space-y-4 rounded-shape-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {activeTab === 'evidence' && (
          <FadeIn>
            <div className="space-y-4">
              <InlineCallout variant="info" icon={<Icon icon={ShieldCheck} />}>
                {t(
                  'resaleVault.evidence.reportScopeNote',
                  'This tab shows all evidence currently available for this vehicle, regardless of your disclosure selection. Use the disclosure profile tab to control what is included in the local vault report, not the separate server certificate requests.',
                )}
              </InlineCallout>
              <EvidenceInventoryPanel
                evidence={evidence}
                selection={disclosure.selection}
                isLoading={isLoading}
                hasPartialErrors={hasPartialErrors}
                sources={sources}
              />
              <BatterySummaryPanel battery={evidence.battery} sources={sources.filter((source) => source.section === 'battery')} />
              <BatteryCertificatePanel vehicleId={vehicleId} />
              <MaintenanceSummaryPanel maintenance={evidence.maintenance} sources={sources.filter((source) => source.section === 'maintenance')} />
              <SoftwareUpdateSummaryPanel softwareUpdates={evidence.software_updates} sources={sources.filter((source) => source.section === 'software_updates')} />
              <WarrantySummaryPanel warranty={evidence.warranty} />
              <DrivingChargingSummaryPanel driving={evidence.driving_history} charging={evidence.charging_history} sources={sources} />
              <IncidentSummaryPanel incidents={evidence.security_incidents} sources={sources.filter((source) => source.section === 'security_incidents')} />
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
              <SignatureKeyPanel vault={reconciledVault} />
              <ExportReportPanel
                key={vehicleId}
                report={report}
                sources={sources}
                retainedExport={retainedExport?.scope === scope ? retainedExport.snapshot : null}
                onSigned={(signed, readinessKey) => {
                  if (vehicleScope.current === scope) {
                    setRetainedExport({ scope, snapshot: { signed: structuredClone(signed), readinessKey } });
                  }
                }}
                blocked={vault.isLoading || vault.isMutating || signingOperation !== null}
                onSigningChange={(pending, operation) => {
                  if (pending) {
                    signingOperationRef.current = operation;
                    setSigningOperation(operation);
                  } else if (signingOperationRef.current === operation) {
                    signingOperationRef.current = null;
                    setSigningOperation(null);
                  }
                }}
              />
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
    </PageLayout>
  );
}
