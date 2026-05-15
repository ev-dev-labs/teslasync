import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';

import { HelixMark } from '@/components/branding/HelixMark';
import { Tooltip } from '@/components/ui/Tooltip';
import { CHART_COLORS_CB_SAFE } from '@/lib/colors';
import { cn } from '@/lib/cn';

/**
 * Phase-46 / Prompt 15 — shared Avatar primitive.
 *
 * Renders one of three visuals, in priority order:
 *   1. `src` image (with automatic fallback to initials on load error).
 *   2. Deterministic 2-letter initials derived from `name`, on a colored
 *      circle whose hue is hashed from `userId` (or `name` when no id).
 *   3. A generic `<User />` / `<Bot />` glyph when neither `name` nor `src`
 *      is provided — selected by the `kind` prop. The chatbot uses this
 *      branch since the self-hosted single-user model has no display name
 *      to attribute messages to.
 *
 * The colour palette is the Okabe-Ito CB-safe palette from
 * `@/lib/colors` so colour-attribution stays distinguishable for users
 * with deuteranopia, protanopia, or tritanopia.
 *
 * Sizes are in pixels: xs=16, sm=24, md=32, lg=48 — chosen to align with
 * the existing icon-box sizes used in DataTable rows (sm) and
 * card headers (md).
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
export type AvatarShape = 'circle' | 'rounded';
export type AvatarStatus = 'online' | 'idle' | 'offline';
export type AvatarKind = 'user' | 'bot';

export interface AvatarProps {
  /**
   * Stable user identifier — used to compute the deterministic palette
   * index. When omitted, `name` falls through as the hash seed so the
   * same name renders the same colour across mounts even without an id.
   */
  userId?: string | null;
  /**
   * Display name — first 2 word-initials are extracted as the visible
   * fallback (e.g. "John Doe" → "JD", "Cher" → "CH"). When neither
   * `name` nor `src` is supplied the avatar falls back to a generic
   * glyph chosen by `kind`.
   */
  name?: string | null;
  /**
   * Optional image URL. When present the avatar renders an `<img>` and
   * falls back to initials/glyph on `onError`.
   */
  src?: string | null;
  /** Size token. Defaults to `sm` (24px) — the comfortable DataTable size. */
  size?: AvatarSize;
  /** Shape token. Defaults to `circle`. `rounded` matches Tailwind `rounded-lg`. */
  shape?: AvatarShape;
  /**
   * When set, renders a tiny coloured dot anchored to the bottom-right
   * corner of the avatar. Visual: green (online) / amber (idle) / grey
   * (offline). The dot carries an aria-label so screen readers announce
   * presence state alongside the user name.
   */
  status?: AvatarStatus;
  /**
   * When true, wraps the avatar in a `<Tooltip>` whose content is
   * `name` (or the localised "Unknown user" fallback). Pair with
   * tabular layouts where the visible name is truncated.
   */
  showTooltip?: boolean;
  /**
   * Kind selector for the no-name fallback. Defaults to `user`.
   * Set to `bot` for assistant/system avatars (chatbot, automation
   * worker logs).
   */
  kind?: AvatarKind;
  className?: string;
}

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
};

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'h-4 w-4 text-[8px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-12 w-12 text-sm',
};

const STATUS_CLASSES: Record<AvatarStatus, string> = {
  // Status uses the semantic palette (good/warn/muted) — the same hues
  // every other live indicator in the app uses, so colour-meaning stays
  // consistent across surfaces.
  online: 'bg-emerald-400',
  idle: 'bg-amber-400',
  offline: 'bg-gray-500',
};

/**
 * djb2 hash — small, deterministic, no dependencies. We only need a
 * non-cryptographic stable mapping from string → palette index.
 */
function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    // hash * 33 + char — standard djb2 step.
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // Force unsigned int so the modulo below is positive.
  return hash >>> 0;
}

/**
 * Pick a palette index from the seed. Exported for tests so the colour
 * stability assertion can hash without re-deriving the implementation.
 */
export function avatarColorIndex(seed: string): number {
  return djb2(seed) % CHART_COLORS_CB_SAFE.length;
}

/**
 * Compute the visible initials for a name. Splits on whitespace and
 * uses the first character of the first two words. For single-word
 * names, falls back to the first two characters. Whitespace-only or
 * empty input returns "?" so the avatar never renders blank.
 */
export function avatarInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  const parts = trimmed.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  // Single-word names: take up to 2 chars (handles "Cher" → "CH",
  // "X" → "X").
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
  className,
}: AvatarProps) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);

  const trimmedName = name?.trim() ?? '';
  const seed = (userId && userId.length > 0 ? userId : trimmedName) || '?';
  const colorIndex = avatarColorIndex(seed);
  const backgroundColor = CHART_COLORS_CB_SAFE[colorIndex];
  const initials = avatarInitials(name);
  const hasNameInitials = initials !== '?';
  const showImage = Boolean(src) && !imageFailed;

  const radiusClass = shape === 'circle' ? 'rounded-full' : 'rounded-lg';
  const sizeClass = SIZE_CLASSES[size];
  const sizePx = SIZE_PX[size];

  // Generic glyph dimensions follow the box size, leaving ~25% padding
  // so the icon doesn't bleed against the edge.
  const glyphSize = Math.round(sizePx * 0.6);
  // `kind="bot"` is the chatbot/assistant slot — render the Helix
  // brand mark instead of a generic bot glyph so the assistant has a
  // consistent visual identity across every avatar surface.
  const GenericIcon = kind === 'bot' ? HelixMark : User;

  // Tooltip / aria-label: name when known, otherwise the localised
  // "Unknown user" placeholder so SR users still get a meaningful
  // announcement.
  const tooltipLabel = trimmedName.length > 0
    ? trimmedName
    : t('avatar.unknown', 'Unknown user');

  // Fallback rendering uses the deterministic palette colour for the
  // background ONLY when we have something to attribute to (a name or
  // userId seed). The truly-anonymous chatbot case (no userId, no name)
  // gets a neutral surface so it doesn't suggest user identity.
  const isAttributed = trimmedName.length > 0 || (userId !== undefined && userId !== null && userId !== '');
  const fallbackBg = isAttributed ? backgroundColor : undefined;

  const inner = (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white select-none',
        // Phase-46/11 — keep the avatar circle visible in Windows High
        // Contrast: a CanvasText border gives the chip a system-colour
        // outline since the bg-* colour is suppressed by forced-colors.
        'forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        radiusClass,
        sizeClass,
        !isAttributed && !showImage && 'bg-[var(--surface-2)]',
        className,
      )}
      style={fallbackBg && !showImage ? { backgroundColor: fallbackBg } : undefined}
      data-testid="avatar"
      data-avatar-kind={kind}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={trimmedName.length > 0 ? trimmedName : t('avatar.unknown', 'Unknown user')}
          onError={() => setImageFailed(true)}
          className={cn('h-full w-full object-cover', radiusClass)}
          data-testid="avatar-image"
        />
      ) : hasNameInitials ? (
        <span aria-hidden="true" data-testid="avatar-initials">
          {initials}
        </span>
      ) : (
        <GenericIcon
          width={glyphSize}
          height={glyphSize}
          aria-hidden="true"
          data-testid="avatar-glyph"
        />
      )}

      {status && (
        <span
          className={cn(
            'absolute bottom-0 right-0 block rounded-full ring-2 ring-[var(--surface-1)]',
            'forced-colors:ring-[Canvas] forced-colors:border forced-colors:border-[CanvasText]',
            // Dot is sized as a fraction of the avatar so it stays
            // proportional. Minimum 6px for tap-target legibility.
            size === 'xs' ? 'h-1.5 w-1.5' : size === 'sm' ? 'h-2 w-2' : size === 'md' ? 'h-2.5 w-2.5' : 'h-3 w-3',
            STATUS_CLASSES[status],
          )}
          role="img"
          aria-label={
            status === 'online'
              ? t('avatar.statusOnline', 'Online')
              : status === 'idle'
                ? t('avatar.statusIdle', 'Idle')
                : t('avatar.statusOffline', 'Offline')
          }
          data-testid="avatar-status"
          data-status={status}
        />
      )}
    </span>
  );

  if (!showTooltip) {
    return inner;
  }
  return <Tooltip content={tooltipLabel}>{inner}</Tooltip>;
}
