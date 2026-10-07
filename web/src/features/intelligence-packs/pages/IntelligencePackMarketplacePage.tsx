/**
 * Signed Intelligence-Pack Marketplace — main page.
 *
 * Local-first, security-first analytics-pack marketplace: packs are
 * declarative data only (never eval'd, never dynamically imported, never
 * rendered in an iframe), verified via Ed25519 over a documented canonical
 * JSON form, gated by a closed capability allowlist, and executed only
 * inside a bounded, deterministic sandbox against bundled synthetic sample
 * data. See `../docs/THREAT_MODEL.md` for the full guarantee list (also
 * summarized live in the "Security & Methodology" tab below).
 *
 * Mounts `PackRepositoryProvider` at the root so every tab/panel shares one
 * repository instance (IndexedDB, with a documented localStorage
 * fallback — never a server round-trip).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Tabs, type TabItem } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PackRepositoryProvider } from '../hooks/packRepositoryContext';
import { CatalogPanel } from '../components/CatalogPanel';
import { InstalledInventoryPanel } from '../components/InstalledInventoryPanel';
import { SandboxPreviewPanel } from '../components/SandboxPreviewPanel';
import { AuditLogPanel } from '../components/AuditLogPanel';
import { ImportExportPanel } from '../components/ImportExportPanel';
import { SecurityMethodologyPanel } from '../components/SecurityMethodologyPanel';

type TabKey = 'catalog' | 'installed' | 'sandbox' | 'audit' | 'importExport' | 'security';

function MarketplaceTabs() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('catalog');

  const tabs: TabItem[] = [
    { key: 'catalog', label: t('intelPacks.tabs.catalog', 'Catalog') },
    { key: 'installed', label: t('intelPacks.tabs.installed', 'Installed') },
    { key: 'sandbox', label: t('intelPacks.tabs.sandbox', 'Sandbox Preview') },
    { key: 'audit', label: t('intelPacks.tabs.audit', 'Audit Log') },
    { key: 'importExport', label: t('intelPacks.tabs.importExport', 'Import / Export') },
    { key: 'security', label: t('intelPacks.tabs.security', 'Security & Methodology') },
  ];

  return (
    <div className="space-y-4">
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        ariaLabel={t('intelPacks.tabs.ariaLabel', 'Intelligence-Pack Marketplace sections')}
      />
      <FadeIn key={activeTab}>
        <GlassPanel padding="lg">
          {activeTab === 'catalog' && <CatalogPanel />}
          {activeTab === 'installed' && <InstalledInventoryPanel />}
          {activeTab === 'sandbox' && <SandboxPreviewPanel />}
          {activeTab === 'audit' && <AuditLogPanel />}
          {activeTab === 'importExport' && <ImportExportPanel />}
          {activeTab === 'security' && <SecurityMethodologyPanel />}
        </GlassPanel>
      </FadeIn>
    </div>
  );
}

export default function IntelligencePackMarketplacePage() {
  const { t } = useTranslation();
  usePageTitle(t('intelPacks.page.title', 'Intelligence-Pack Marketplace'));

  return (
    <PageContainer
      title={t('intelPacks.page.title', 'Intelligence-Pack Marketplace')}
      subtitle={t(
        'intelPacks.page.subtitle',
        'Signed, sandboxed, local-first analytics packs — declarative data only, never executable code, never a network request.',
      )}
    >
      <PackRepositoryProvider>
        <MarketplaceTabs />
      </PackRepositoryProvider>
    </PageContainer>
  );
}
