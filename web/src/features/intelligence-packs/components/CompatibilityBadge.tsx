/**
 * Shows whether a pack's declared `appCompatibility` range is satisfied by
 * the running app version (`lib/compatibility.ts`). A local, offline,
 * semver-only comparison — never a network lookup.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { currentAppVersion, isAppVersionCompatible } from '../lib/compatibility';
import type { PackAppCompatibility } from '../lib/manifestTypes';

export function CompatibilityBadge({ compat, className }: { compat: PackAppCompatibility; className?: string }) {
  const { t } = useTranslation();
  const appVersion = currentAppVersion();
  const result = isAppVersionCompatible(compat, appVersion);

  return (
    <div className={className}>
      <Badge variant={result.compatible ? 'success' : 'danger'} size="sm">
        {result.compatible
          ? t('intelPacks.compat.compatible', 'Compatible')
          : t('intelPacks.compat.incompatible', 'Incompatible')}
      </Badge>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{result.reason}</p>
    </div>
  );
}
