import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { neonColorMap } from '@/lib/tokens';
import { permissionMeta } from './constants';

interface ApiKeyPermissionBadgeProps {
  perm: string;
  className?: string;
}

/**
 * Permission chip for an API key. The saturated neon hue is confined to the
 * chip background/ring; the label uses the toned 300-level text from
 * `neonColorMap`, so this is never "neon body text". Color is paired with an
 * icon so status is not conveyed by color alone.
 */
export function ApiKeyPermissionBadge({ perm, className }: ApiKeyPermissionBadgeProps) {
  const { t } = useTranslation();
  const meta = permissionMeta(perm);
  const c = neonColorMap[meta.color];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1',
        c.bg,
        c.ring,
        c.text,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(meta.labelKey, meta.labelFallback)}
    </span>
  );
}
