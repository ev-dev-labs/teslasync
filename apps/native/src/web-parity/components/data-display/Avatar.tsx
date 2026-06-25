// Native parity port of web/src/components/data-display/Avatar.tsx.
// Uses React Native primitives while preserving the deterministic initials,
// Okabe-Ito color hashing, image fallback, status dot, and bot brand mark.

import React, {useCallback, useState} from 'react';
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {HelixMark} from '../branding/HelixMark';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
export type AvatarShape = 'circle' | 'rounded';
export type AvatarStatus = 'online' | 'idle' | 'offline';
export type AvatarKind = 'user' | 'bot';

export interface AvatarProps {
  userId?: string | null;
  name?: string | null;
  src?: string | null;
  size?: AvatarSize;
  shape?: AvatarShape;
  status?: AvatarStatus;
  showTooltip?: boolean;
  kind?: AvatarKind;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
};

const TEXT_SIZE_PX: Record<AvatarSize, number> = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
};

const STATUS_SIZE_PX: Record<AvatarSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
};

const STATUS_COLORS: Record<AvatarStatus, string> = {
  online: colors.success,
  idle: colors.warning,
  offline: '#6b7280',
};

const CHART_COLORS_CB_SAFE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export function avatarColorIndex(seed: string): number {
  return djb2(seed) % CHART_COLORS_CB_SAFE.length;
}

export function avatarInitials(name: string | null | undefined): string {
  if (!name) {
    return '?';
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return '?';
  }
  const parts = trimmed.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export function Avatar({
  userId,
  name,
  src,
  size = 'sm',
  shape = 'circle',
  status,
  showTooltip = false,
  kind = 'user',
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: AvatarProps) {
  const t = useNativeTranslationFallback();
  const [imageFailed, setImageFailed] = useState(false);

  const trimmedName = name?.trim() ?? '';
  const seed = (userId && userId.length > 0 ? userId : trimmedName) || '?';
  const colorIndex = avatarColorIndex(seed);
  const backgroundColor = CHART_COLORS_CB_SAFE[colorIndex];
  const initials = avatarInitials(name);
  const hasNameInitials = initials !== '?';
  const imageUri = src ?? '';
  const showImage = imageUri.length > 0 && !imageFailed;

  const sizePx = SIZE_PX[size];
  const radius = shape === 'circle' ? sizePx / 2 : Math.min(8, sizePx / 2);
  const glyphSize = Math.round(sizePx * 0.6);

  const tooltipLabel =
    trimmedName.length > 0 ? trimmedName : t('avatar.unknown', 'Unknown user');
  const statusLabel = status ? avatarStatusLabel(status, t) : undefined;
  const nativeLabel =
    accessibilityLabel ??
    (statusLabel ? `${tooltipLabel}, ${statusLabel}` : tooltipLabel);

  const isAttributed =
    trimmedName.length > 0 ||
    (userId !== undefined && userId !== null && userId !== '');
  const fallbackBg = isAttributed ? backgroundColor : colors.surfaceRaised;

  return (
    <View
      accessible
      accessibilityHint={
        showTooltip
          ? t(
              'avatar.tooltipNativeHint',
              'Avatar tooltip label is exposed for accessibility on native.',
            )
          : undefined
      }
      accessibilityLabel={nativeLabel}
      accessibilityRole="image"
      style={[
        styles.root,
        {
          backgroundColor: showImage ? colors.surfaceRaised : fallbackBg,
          borderRadius: radius,
          height: sizePx,
          width: sizePx,
        },
        style,
      ]}
      testID={testID ?? dataTestID ?? 'avatar'}>
      {showImage ? (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={tooltipLabel}
          onError={() => setImageFailed(true)}
          resizeMode="cover"
          source={{uri: imageUri}}
          style={[styles.image, {borderRadius: radius}]}
          testID="avatar-image"
        />
      ) : hasNameInitials ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.initials, {fontSize: TEXT_SIZE_PX[size]}]}
          testID="avatar-initials"
          weight="semibold">
          {initials}
        </AppText>
      ) : kind === 'bot' ? (
        <HelixMark
          accessibilityElementsHidden
          color={colors.textPrimary}
          importantForAccessibility="no-hide-descendants"
          size={glyphSize}
          testID="avatar-glyph"
        />
      ) : (
        <UserGlyph size={glyphSize} testID="avatar-glyph" />
      )}

      {status ? (
        <View
          accessible
          accessibilityLabel={statusLabel}
          accessibilityRole="image"
          style={[
            styles.statusDot,
            {
              backgroundColor: STATUS_COLORS[status],
              borderRadius: STATUS_SIZE_PX[size] / 2,
              height: STATUS_SIZE_PX[size],
              width: STATUS_SIZE_PX[size],
            },
          ]}
          testID="avatar-status"
        />
      ) : null}
    </View>
  );
}

function avatarStatusLabel(status: AvatarStatus, t: NativeTFunction): string {
  if (status === 'online') {
    return t('avatar.statusOnline', 'Online');
  }
  if (status === 'idle') {
    return t('avatar.statusIdle', 'Idle');
  }
  return t('avatar.statusOffline', 'Offline');
}

function UserGlyph({size, testID}: {size: number; testID: string}) {
  const headSize = Math.max(4, Math.round(size * 0.38));
  const bodyWidth = Math.max(8, Math.round(size * 0.72));
  const bodyHeight = Math.max(4, Math.round(size * 0.32));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.userGlyph, {height: size, width: size}]}
      testID={testID}>
      <View
        style={[
          styles.userGlyphHead,
          {
            borderRadius: headSize / 2,
            height: headSize,
            width: headSize,
          },
        ]}
      />
      <View
        style={[
          styles.userGlyphBody,
          {
            borderTopLeftRadius: bodyHeight,
            borderTopRightRadius: bodyHeight,
            height: bodyHeight,
            width: bodyWidth,
          },
        ]}
      />
    </View>
  );
}

Avatar.displayName = 'Avatar';

const styles = StyleSheet.create({
  image: {
    height: '100%',
    width: '100%',
  },
  initials: {
    color: colors.textPrimary,
    lineHeight: 18,
    textAlign: 'center',
  },
  root: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  statusDot: {
    borderColor: colors.surface,
    borderWidth: 2,
    bottom: 0,
    position: 'absolute',
    right: 0,
  },
  userGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userGlyphBody: {
    backgroundColor: colors.textPrimary,
    marginTop: 2,
    opacity: 0.96,
  },
  userGlyphHead: {
    backgroundColor: colors.textPrimary,
    opacity: 0.96,
  },
});
