/**
 * Curated local catalog: a responsive grid of `CatalogCard`s sourced
 * entirely from the bundled `CATALOG_ENTRIES` fixture (never fetched over
 * a network — see `lib/catalogFixtures.ts`), with a detail/install modal.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { PackageSearch } from 'lucide-react';
import { useCatalog, type CatalogEntryWithStatus } from '../hooks/useCatalog';
import { CatalogCard } from './CatalogCard';
import { PackDetailModal } from './PackDetailModal';

export function CatalogPanel() {
  const { t } = useTranslation();
  const { entries } = useCatalog();
  const [selected, setSelected] = useState<CatalogEntryWithStatus | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        {t(
          'intelPacks.catalog.intro',
          'A small, curated, locally-bundled catalog — nothing here is ever fetched from a network. Each entry demonstrates a distinct trust state: signed & recognized, unsigned draft, and a deliberately tampered demo.',
        )}
      </p>

      {entries.length === 0 ? (
        // no-action: entries come from the bundled CATALOG_ENTRIES fixture (lib/catalogFixtures.ts), which always ships at least one demo entry — this branch is effectively unreachable.
        <EmptyState
          icon={<PackageSearch className="h-10 w-10" />}
          message={t('intelPacks.catalog.empty', 'No catalog entries are bundled with this build.')}
        />
      ) : (
        <Grid cols={{ default: 1, md: 2, xl: 3 }} gap={4}>
          {entries.map((entry) => (
            <CatalogCard key={entry.envelope.manifest.id} entry={entry} onOpenDetail={setSelected} />
          ))}
        </Grid>
      )}

      <PackDetailModal entry={selected} open={selected != null} onClose={() => setSelected(null)} />
    </div>
  );
}
