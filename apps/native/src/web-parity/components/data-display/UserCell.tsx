// Native parity port of web/src/components/data-display/UserCell.tsx.
//
// Drop-in cell for user-attributed columns (audit log "actor", feedback queue
// "reporter", notification log "delivered to", etc.). Renders the shared
// {@link Avatar} alongside the display name, with an optional muted email line
// beneath. When `user` is null/unattributed the cell renders an em-dash so empty
// states stay scannable in dense tables.
//
// Replaces the DOM <span> wrappers, the Tailwind utility classes (inline-flex /
// items-center / gap-2 / min-w-0 / flex-col / text-sm / text-xs / truncate / the
// text-[var(--text-*)] color tokens), the `cn` class-merge helper, and the
// react-i18next useTranslation hook with React Native View/AppText primitives,
// native color tokens, numberOfLines truncation, and the established
// useNativeTranslationFallback helper (preserving the avatar.unknown fallback).

import React, {useCallback} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

import {Avatar, type AvatarSize} from './Avatar';

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
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function UserCell({
  user,
  showEmail = false,
  size = 'sm',
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
}: UserCellProps) {
  const t = useNativeTranslationFallback();

  if (!user || (!user.name && !user.email && !user.id)) {
    return (
      <AppText
        testID={testID ?? dataTestID ?? 'user-cell-empty'}
        tone="muted">
        —
      </AppText>
    );
  }

  // Display priority: name -> email local-part -> id -> "Unknown user".
  // We never render the bare id by itself unless it's the only signal, since
  // opaque header values (e.g. ForwardAuth subject) aren't useful names — but
  // they're better than nothing for accountability.
  const displayName =
    user.name?.trim() ||
    user.email?.split('@')[0] ||
    user.id ||
    t('avatar.unknown', 'Unknown user');

  return (
    <View
      style={[styles.root, style]}
      testID={testID ?? dataTestID ?? 'user-cell'}>
      <Avatar
        name={displayName}
        showTooltip
        size={size}
        src={user.avatarUrl ?? undefined}
        userId={user.id ?? undefined}
      />
      <View style={styles.column}>
        <AppText numberOfLines={1} style={styles.name} tone="primary">
          {displayName}
        </AppText>
        {showEmail && user.email ? (
          <AppText numberOfLines={1} style={styles.email} tone="muted">
            {user.email}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

UserCell.displayName = 'UserCell';

const styles = StyleSheet.create({
  column: {
    flexDirection: 'column',
    flexShrink: 1,
    minWidth: 0,
  },
  email: {
    fontSize: 12,
    lineHeight: 16,
  },
  name: {
    fontSize: 14,
    lineHeight: 18,
  },
  root: {
    alignItems: 'center',
    columnGap: 8,
    flexDirection: 'row',
    flexShrink: 1,
    minWidth: 0,
  },
});
