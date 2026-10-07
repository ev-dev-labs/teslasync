import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import { Text } from '@/components/ui';
import type { CommandDef } from '../commands';

interface FavoritesBarProps {
  favorites: string[];
  commands: CommandDef[];
  renderTile: (cmd: CommandDef) => ReactNode;
}

export function FavoritesBar({ favorites, commands, renderTile }: FavoritesBarProps) {
  const { t } = useTranslation();

  // Match favourite ids against the command list defensively: undefined or
  // malformed props (e.g. a corrupt localStorage value) degrade to an empty
  // bar instead of throwing on `.filter`/`.includes`. Memoised + Set-backed so
  // an unrelated parent re-render doesn't re-scan every command. Command order
  // is preserved (favourites do not reorder the grid).
  const favCmds = useMemo(() => {
    const favSet = new Set(Array.isArray(favorites) ? favorites : []);
    const list = Array.isArray(commands) ? commands : [];
    return list.filter(c => favSet.has(c.id));
  }, [favorites, commands]);

  if (favCmds.length === 0) return null;

  const heading = t('commands.cat.quickActions', 'Quick Actions');

  return (
    <FadeIn>
      <section aria-label={heading}>
        <div className="flex items-center gap-2 mb-2">
          <Star className="h-4 w-4 text-neon-amber fill-neon-amber" aria-hidden="true" />
          <Text size="xs" weight="medium" className="uppercase tracking-wider text-[var(--text-secondary)]">
            {heading}
          </Text>
          <Text size="2xs" color="muted">({favCmds.length})</Text>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {favCmds.map(cmd => renderTile(cmd))}
        </div>
      </section>
    </FadeIn>
  );
}
