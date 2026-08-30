import { useTranslation } from 'react-i18next';
import { Clock, Trash2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { glassCardClasses } from '@/lib/tokens';
import { Badge, Button, IconBox, Text, Caption, Code } from '@/components/ui';
import { formatDate } from '@/lib/dateFormat';
import type { APIKey } from '@/types/admin';
import { KEY_ICON } from './constants';
import { isKeyExpired } from './helpers';
import { ApiKeyPermissionBadge } from './ApiKeyPermissionBadge';

interface ApiKeyCardProps {
  apiKey: APIKey;
  onRevoke: (id: string) => void;
  onDelete: (key: APIKey) => void;
  revoking?: boolean;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

/** 44×44 square override so icon-only actions meet the WCAG touch-target size. */
const ICON_BTN = '!h-11 !w-11 !px-0 text-[var(--text-muted)]';

/** A single API key surface: identity + permission + lifecycle metadata + actions. */
export function ApiKeyCard({
  apiKey,
  onRevoke,
  onDelete,
  revoking = false,
  actionsDisabled = false,
  actionsDisabledReason,
}: ApiKeyCardProps) {
  const { t } = useTranslation();
  const expired = isKeyExpired(apiKey);
  const KeyIcon = KEY_ICON;
  // Single source of truth for the human label: falls back to "Unnamed key"
  // so the icon-only Revoke/Delete actions still announce a meaningful
  // accessible name (an empty `name` otherwise yields "Revoke key ").
  const displayName = apiKey.name || t('apiKeys.unnamed', 'Unnamed key');

  return (
    <div
      className={cn(
        glassCardClasses.md,
        'flex flex-col gap-3 transition-colors hover:border-white/[0.10]',
        expired && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <IconBox color={expired ? 'red' : 'cyan'} size="md">
          <KeyIcon className="h-5 w-5" aria-hidden="true" />
        </IconBox>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text size="sm" weight="semibold" color="primary" className="truncate">
              {displayName}
            </Text>
            <ApiKeyPermissionBadge perm={apiKey.permissions} />
            {expired && (
              <Badge variant="danger" size="sm">
                <XCircle className="h-3 w-3" aria-hidden="true" />
                {t('apiKeys.expired', 'Expired')}
              </Badge>
            )}
          </div>
          <Code className="mt-1 block truncate">{apiKey.keyPrefix || '—'}</Code>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!expired && (
            <Button
              variant="ghost"
              onClick={() => onRevoke(apiKey.id)}
              loading={revoking}
              disabled={actionsDisabled}
              icon={<XCircle className="h-4 w-4" aria-hidden="true" />}
              aria-label={t('apiKeys.revokeAria', 'Revoke key {{name}}', { name: displayName })}
              title={actionsDisabledReason ?? t('apiKeys.revoke', 'Revoke')}
              className={cn(ICON_BTN, 'hover:bg-neon-amber/10 hover:text-amber-300')}
            />
          )}
          <Button
            variant="ghost"
            onClick={() => onDelete(apiKey)}
            disabled={actionsDisabled}
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            aria-label={t('apiKeys.deleteAria', 'Delete key {{name}}', { name: displayName })}
            title={actionsDisabledReason ?? t('apiKeys.delete', 'Delete')}
            className={cn(ICON_BTN, 'hover:bg-neon-red/10 hover:text-rose-300')}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] pt-2">
        <Caption className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {t('apiKeys.created', 'Created')} {formatDate(apiKey.createdAt)}
        </Caption>
        <Caption>
          {apiKey.lastUsedAt
            ? `${t('apiKeys.lastUsed', 'Last used')} ${formatDate(apiKey.lastUsedAt)}`
            : t('apiKeys.neverUsed', 'Never used')}
        </Caption>
      </div>
    </div>
  );
}
