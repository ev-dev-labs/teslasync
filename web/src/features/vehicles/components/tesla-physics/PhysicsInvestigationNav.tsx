import { Link } from 'react-router-dom';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { features, type PhysicsSlug, type Translate } from './PhysicsPageShell';

const groups: ReadonlyArray<{ key: string; title: string; slugs: readonly PhysicsSlug[] }> = [
  { key: 'time', title: 'Time & coverage', slugs: ['clocks', 'life-tape', 'unknown', 'car-kept-living'] },
  { key: 'motion', title: 'Motion & states', slugs: ['contradictions', 'logbook', 'black-box', 'modes'] },
  { key: 'charging', title: 'Charging & range', slugs: ['charge-port', 'dictionary', 'range'] },
  { key: 'integrity', title: 'Integrity & firmware', slugs: ['meters', 'firmware-epochs', 'nervous-system', 'vault'] },
];

export function PhysicsInvestigationNav({ activeSlug, t }: { activeSlug?: PhysicsSlug; t: Translate }) {
  return <GlassPanel className="space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PanelTitle>{t('teslaOnly.workbench.navigation', 'Tesla Physics investigations')}</PanelTitle>
      <Link to="/tesla-physics" aria-current={activeSlug ? undefined : 'page'}
        className="rounded-lg px-3 py-2 text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]">
        {t('teslaOnly.workbench.overview', 'Start here')}
      </Link>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map((group) => <div key={group.key} className="space-y-2">
        <Text as="h3" variant="subhead">{t(`teslaOnly.workbench.${group.key}`, group.title)}</Text>
        <div className="flex flex-col gap-1">
          {features.filter((item) => group.slugs.includes(item.slug)).map((item) =>
            <Link key={item.slug} to={`/tesla-physics/${item.slug}`}
              aria-current={activeSlug === item.slug ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] ${
                activeSlug === item.slug
                  ? 'border-[var(--theme-primary)] bg-[var(--surface-2)] text-[var(--text-primary)]'
                  : 'border-[var(--glass-border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'
              }`}>
              {t(`teslaOnly.feature.${item.slug}.title`, item.title)}
            </Link>)}
        </div>
      </div>)}
    </div>
    <div className="flex flex-wrap gap-4 border-t border-[var(--glass-border)] pt-3">
      <Link to="/tesla-physics/ledger" className="text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]">
        {t('teslaOnly.feature.ledger.title', 'Physics Ledger')} →
      </Link>
      <Link to="/science" className="text-[var(--theme-primary)] underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]">
        {t('teslaOnly.scienceLab', 'Science Lab')} →
      </Link>
    </div>
  </GlassPanel>;
}
