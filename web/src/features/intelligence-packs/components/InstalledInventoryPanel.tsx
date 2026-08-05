/**
 * Installed-pack lifecycle: enable/disable, upgrade (when a newer catalog
 * version exists), rollback (to the most recently superseded version), and
 * uninstall. Each row expands to show the exact capability grant + trust
 * decision recorded at install time — nothing here re-verifies a signature
 * (that already happened once, at install time; the record is immutable
 * local history) but the ORIGINAL `VerificationResult` snapshot is always
 * shown as-is.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PackageOpen, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button, Caption, Column, ConfirmDialog, DataTable, Toggle } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useInstalledPacks } from '../hooks/useInstalledPacks';
import { useTrustDecision } from '../hooks/useTrustDecision';
import { usePackActions } from '../hooks/usePackActions';
import { useCatalog } from '../hooks/useCatalog';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import { CapabilityRequestList } from './CapabilityRequestList';
import { isEnableAllowed } from '../lib/trust';
import type { InstalledPackRecord } from '../lib/packRepository';

function EnabledToggleCell({ record }: { record: InstalledPackRecord }) {
  const { t } = useTranslation();
  const trustQuery = useTrustDecision(record.packId);
  const { setEnabled } = usePackActions();
  const allowed = isEnableAllowed(trustQuery.data ?? null);

  const interactive = allowed && !setEnabled.isPending;

  return (
    <div className="flex items-center gap-2">
      <Toggle
        checked={record.enabled && allowed}
        onChange={(checked) => {
          if (!interactive) return;
          setEnabled.mutate({ packId: record.packId, enabled: checked });
        }}
        size="sm"
        aria-label={t('intelPacks.installed.toggleEnabled', 'Enable {{name}}', { name: record.envelope.manifest.name })}
        className={!interactive ? 'opacity-50 pointer-events-none' : undefined}
      />
      {!allowed && (
        <Caption className="text-amber-300">
          {t('intelPacks.installed.noTrustDecision', 'No trust decision on record')}
        </Caption>
      )}
    </div>
  );
}

function ExpandedDetail({ record }: { record: InstalledPackRecord }) {
  const { t } = useTranslation();
  const trustQuery = useTrustDecision(record.packId);
  const granted = new Set(trustQuery.data?.approvedCapabilities ?? []);
  return (
    <div className="space-y-3 p-2">
      <div>
        <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">{t('intelPacks.installed.grantedCapabilities', 'Capability grant on record')}</p>
        <CapabilityRequestList capabilityIds={record.envelope.manifest.capabilities} granted={granted} />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {t('intelPacks.installed.trustDecisionKind', 'Trust decision: {{decision}}', { decision: trustQuery.data?.decision ?? t('intelPacks.installed.none', 'none recorded') })}
      </p>
      <p className="text-xs text-[var(--text-muted)]">
        {t('intelPacks.installed.versionHistoryCount', '{{count}} previous version(s) retained for rollback', { count: record.previousVersions.length })}
      </p>
    </div>
  );
}

export function InstalledInventoryPanel() {
  const { t } = useTranslation();
  const installedQuery = useInstalledPacks();
  const { entries: catalogEntries } = useCatalog();
  const { rollback, uninstall } = usePackActions();
  const [expandedKeys, setExpandedKeys] = useState<Array<string | number>>([]);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledPackRecord | null>(null);

  const rows = installedQuery.data ?? [];

  const catalogByPackId = useMemo(
    () => new Map(catalogEntries.map((e) => [e.envelope.manifest.id, e])),
    [catalogEntries],
  );

  const columns: Column<InstalledPackRecord>[] = [
    {
      key: 'name',
      header: t('intelPacks.installed.colName', 'Pack'),
      render: (r) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.envelope.manifest.name}</p>
          <p className="text-xs text-[var(--text-muted)]">v{r.envelope.manifest.version}</p>
        </div>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'verification',
      header: t('intelPacks.installed.colVerification', 'Verification'),
      render: (r) => <VerificationStatusBadge result={r.verification} />,
    },
    {
      key: 'enabled',
      header: t('intelPacks.installed.colEnabled', 'Enabled'),
      render: (r) => <EnabledToggleCell record={r} />,
      visibleOnMobile: true,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => {
        const catalogEntry = catalogByPackId.get(r.packId);
        const canUpgrade = catalogEntry != null && catalogEntry.envelope.manifest.version !== r.envelope.manifest.version;
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {canUpgrade && (
              <Badge variant="warning" size="sm" title={t('intelPacks.installed.upgradeHint', 'Open the Catalog tab to review and upgrade')}>
                {t('intelPacks.installed.upgradeAvailable', 'v{{version}} available — see Catalog', { version: catalogEntry!.envelope.manifest.version })}
              </Badge>
            )}
            {r.previousVersions.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => rollback.mutate(r.packId)}
                loading={rollback.isPending}
              >
                {t('intelPacks.installed.rollback', 'Rollback')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => setUninstallTarget(r)}
            >
              {t('intelPacks.installed.uninstall', 'Uninstall')}
            </Button>
          </div>
        );
      },
    },
  ];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<PackageOpen className="h-10 w-10" />}
        message={t('intelPacks.installed.empty', 'No packs are installed yet. Install one from the Catalog tab.')}
      />
    );
  }

  return (
    <div className="space-y-3">
      <DataTable
        tableId="intelligence-packs:installed"
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.packId}
        expandable
        expandedKeys={expandedKeys}
        onExpandedChange={setExpandedKeys}
        renderExpanded={(r) => <ExpandedDetail record={r} />}
        emptyMessage={t('intelPacks.installed.empty', 'No packs are installed yet. Install one from the Catalog tab.')}
        mobileColumns={['name', 'enabled']}
        name="IntelligencePacksInstalled"
      />

      <ConfirmDialog
        open={uninstallTarget != null}
        title={t('intelPacks.confirm.uninstallTitle', 'Uninstall pack?')}
        message={t('intelPacks.confirm.uninstallMessage', 'This removes "{{name}}" and its version history from this device. This cannot be undone.', {
          name: uninstallTarget?.envelope.manifest.name ?? '',
        })}
        variant="danger"
        confirmLabel={t('intelPacks.installed.uninstall', 'Uninstall')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={uninstall.isPending}
        onConfirm={async () => {
          if (uninstallTarget) await uninstall.mutateAsync(uninstallTarget.packId);
          setUninstallTarget(null);
        }}
        onCancel={() => setUninstallTarget(null)}
      />
    </div>
  );
}
