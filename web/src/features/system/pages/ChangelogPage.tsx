import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { CHANGELOG, type ChangelogBadge, type ChangelogChangeType, type ChangelogEntry } from '@/generated/changelog';
import { cn } from '@/lib/cn';

/**
 * ChangelogPage — Phase-40 / Prompt 67.
 *
 * Full timeline view of every shipped release. Consumes the auto-generated
 * `@/generated/changelog` module (parsed from the repo-root CHANGELOG.md
 * by `web/scripts/buildChangelog.mjs`) so this page, the ReleaseNotes
 * component, and the "what's new" modal all stay in lock-step.
 *
 * Per-entry rendering groups changes by Keep-a-Changelog category
 * (Added / Changed / Fixed / …) so a 50-bullet release stays scannable.
 */

const SECTION_ORDER: readonly ChangelogChangeType[] = [
  'added',
  'changed',
  'fixed',
  'removed',
  'deprecated',
  'security',
];

const SECTION_KEY: Record<ChangelogChangeType, string> = {
  added: 'changelog.sections.added',
  changed: 'changelog.sections.changed',
  fixed: 'changelog.sections.fixed',
  removed: 'changelog.sections.removed',
  deprecated: 'changelog.sections.deprecated',
  security: 'changelog.sections.security',
};

const SECTION_FALLBACK: Record<ChangelogChangeType, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  removed: 'Removed',
  deprecated: 'Deprecated',
  security: 'Security',
};

const SECTION_DOT: Record<ChangelogChangeType, string> = {
  added: 'bg-emerald-400/60',
  changed: 'bg-cyan-400/60',
  fixed: 'bg-amber-400/60',
  removed: 'bg-rose-400/60',
  deprecated: 'bg-purple-400/60',
  security: 'bg-rose-400/60',
};

const BADGE_VARIANT: Record<ChangelogBadge, 'success' | 'info' | 'warning'> = {
  latest: 'success',
  stable: 'info',
  beta: 'warning',
};

const BADGE_KEY: Record<ChangelogBadge, string> = {
  latest: 'changelog.badges.latest',
  stable: 'changelog.badges.stable',
  beta: 'changelog.badges.beta',
};

const BADGE_FALLBACK: Record<ChangelogBadge, string> = {
  latest: 'Latest',
  stable: 'Stable',
  beta: 'Beta',
};

interface SectionGroup {
  type: ChangelogChangeType;
  items: ChangelogEntry['changes'];
}

function groupChanges(entry: ChangelogEntry): SectionGroup[] {
  return SECTION_ORDER.map((type) => ({
    type,
    items: entry.changes.filter((c) => c.type === type),
  })).filter((g) => g.items.length > 0);
}

export default function ChangelogPage() {
  const { t } = useTranslation();
  usePageTitle(t('changelog.title', 'Changelog'));

  return (
    <PageContainer
      title={t('changelog.title', 'Changelog')}
      subtitle={t('changelog.subtitle', 'History of features, improvements, and fixes')}
    >
      <div className="relative mt-4">
        {/* Timeline line */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-cyan-400/25 via-purple-500/25 to-transparent" />

        <div className="space-y-8">
          {CHANGELOG.map((entry, idx) => {
            const groups = groupChanges(entry);
            return (
              <FadeIn key={entry.version} delay={idx * 0.05}>
                <div className="relative pl-16">
                  {/* Timeline dot */}
                  <div className="absolute left-[18px] top-5 h-4 w-4 rounded-full border-2 border-cyan-400 bg-gray-900 shadow-lg shadow-cyan-400/30" />

                  <GlassPanel className="p-5">
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <Badge variant={BADGE_VARIANT[entry.badge]} size="sm">
                        {t(BADGE_KEY[entry.badge], BADGE_FALLBACK[entry.badge])}
                      </Badge>
                      <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                        v{entry.version}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Calendar className="h-3 w-3" aria-hidden />
                        {entry.date}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {groups.map((group) => (
                        <div key={group.type}>
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                            {t(SECTION_KEY[group.type], SECTION_FALLBACK[group.type])}
                          </p>
                          <ul className="space-y-1.5">
                            {group.items.map((item, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', SECTION_DOT[group.type])} />
                                <span className="break-words">{item.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </GlassPanel>
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}
