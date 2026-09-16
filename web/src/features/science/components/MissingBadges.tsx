import {
  Badge
} from '@/components/ui';
import { useT } from './helpers';

export function MissingBadges({ missing }: { missing?: string[] }) {
  const t = useT();
  if (!missing || missing.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="warning" size="sm">
        {t('science.missingSignals', 'Missing signals')}: {missing.join(', ')}
      </Badge>
    </div>
  );
}
