import { useTranslation } from 'react-i18next';

import { Avatar, type AvatarSize } from './Avatar';
import { cn } from '@/lib/cn';

/**
 * Phase-46 / Prompt 15 — drop-in cell for user-attributed columns
 * (audit log "actor", feedback queue "reporter", notification log
 * "delivered to", etc.).
 *
 * Renders the shared {@link Avatar} alongside the display name, with
 * an optional muted email line beneath. When `user` is null the cell
 * renders an em-dash so empty states stay scannable in dense tables.
 */
export interface UserCellUser {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface UserCellProps {
  user: UserCellUser | null | undefined;
  /** When true, renders the email beneath the name. Defaults to false. */
  showEmail?: boolean;
  size?: AvatarSize;
  className?: string;
}

export function UserCell({ user, showEmail = false, size = 'sm', className }: UserCellProps) {
  const { t } = useTranslation();

  if (!user || (!user.name && !user.email && !user.id)) {
    return (
      <span className="text-[var(--text-muted)]" data-testid="user-cell-empty">
        —
      </span>
    );
  }

  // Display priority: name → email local-part → id → "Unknown user".
  // We never render the bare id by itself unless it's the only signal,
  // since opaque header values (e.g. ForwardAuth subject) aren't useful
  // names — but they're better than nothing for accountability.
  const displayName = user.name?.trim()
    || user.email?.split('@')[0]
    || user.id
    || t('avatar.unknown', 'Unknown user');

  return (
    <span
      className={cn('inline-flex items-center gap-2 min-w-0', className)}
      data-testid="user-cell"
    >
      <Avatar
        userId={user.id ?? undefined}
        name={displayName}
        src={user.avatarUrl ?? undefined}
        size={size}
        showTooltip
      />
      <span className="flex flex-col min-w-0">
        <span className="text-sm text-[var(--text-primary)] truncate">{displayName}</span>
        {showEmail && user.email ? (
          <span className="text-xs text-[var(--text-muted)] truncate">{user.email}</span>
        ) : null}
      </span>
    </span>
  );
}
