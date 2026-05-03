import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { FadeIn } from '@/components/motion';
import type { CommandDef } from '../commands';

interface FavoritesBarProps {
  favorites: string[];
  commands: CommandDef[];
  renderTile: (cmd: CommandDef) => ReactNode;
}

export function FavoritesBar({ favorites, commands, renderTile }: FavoritesBarProps) {
  const { t } = useTranslation();
  const favCmds = commands.filter(c => favorites.includes(c.id));
  if (favCmds.length === 0) return null;

  return (
    <FadeIn>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Star className="h-4 w-4 text-neon-amber fill-neon-amber" />
          <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium">
            {t('commands.cat.quickActions', 'Quick Actions')}
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">({favCmds.length})</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {favCmds.map(cmd => renderTile(cmd))}
        </div>
      </div>
    </FadeIn>
  );
}
