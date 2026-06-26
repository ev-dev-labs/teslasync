// Native parity port of web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx.
//
// The web widget is a "Now Playing" dashboard tile. It renders inside the shared
// <WidgetShell> and switches between a Compact view (cols === 1 && rows === 1: a
// centred music glyph over the track title + artist) and a Standard/Tall view
// (an icon-box header with title/artist/optional album, an "Playing" pill, a
// progress bar with elapsed/duration clocks, and — when rows >= 2 — a media
// source row plus a volume meter; the non-tall layout shows the source as a small
// footer). Data comes from useMediaLatest(id, 5000) / useVehicles().
//
// None of the web visual deps are native-safe, so — mirroring the sibling native
// ports (LifetimeStatsWidget, CostBreakdownWidget, EnergySiteInfoWidget) — each
// piece is rebuilt with React Native primitives, AppText, the repo SemanticIcon
// glyphs and the design tokens. The shared deps with no native port
// (react-i18next, lucide-react Music/Radio/Volume2, @/components/feedback
// EmptyState, ./WidgetShell, ./types WidgetProps, @/lib/dateFormat
// formatDurationClock) are inlined as self-contained native-safe parity here.
// The native useVehicles + useMediaLatest hooks are reused verbatim.
//
// Line-by-line coverage of the source:
//   L1     `import { useTranslation }` -> useNativeTranslationFallback (every i18n
//          key + English fallback preserved; namespace kept as I18N_NAMESPACE).
//   L2     lucide Music/Radio/Volume2 -> repo SemanticIcon glyphs (media/radio/
//          volume).
//   L3     @/components/feedback EmptyState -> inlined native EmptyState.
//   L4     @/api/hooks/useVehicles useVehicles + useMediaLatest -> native hooks
//          (same names) reused verbatim.
//   L5     @/lib/dateFormat formatDurationClock -> inlined value-identical native
//          (ms -> "m:ss", '—' on non-finite/negative input).
//   L6     ./WidgetShell -> inlined native WidgetShell (freshness pill + pulse).
//   L7     ./types WidgetProps -> inlined WidgetSize/WidgetConfig/WidgetProps mirror.
//   L9-19  ProgressBar({elapsed,duration}): pct = duration>0 ?
//          min((elapsed/duration)*100,100) : 0 -> ported verbatim; the surface-2
//          track + neon-cyan fill become a native track/fill View pair.
//   L21    default export ({vehicleId,size}: WidgetProps) -> ported.
//   L22    t = useTranslation('dashboard') -> useNativeTranslationFallback.
//   L23-24 useVehicles(); id = vehicleId ?? vehicles?.[0]?.id ?? 0 -> ported.
//   L25    useMediaLatest(id, 5_000) destructured (media/isLoading/isFetching/
//          isStale/isError/dataUpdatedAt/refetch) -> ported verbatim.
//   L27-28 isCompact = cols===1 && rows===1; isTall = rows>=2 -> ported.
//   L30-38 title/artist/album/source/status/elapsed/duration/volume/volumeMax
//          field extraction with the exact `?? '—'`, `?? 0`, `?? 11`,
//          `playback_source ?? now_playing_station` fallbacks -> ported verbatim.
//   L40    isPlaying = status === 'Playing' -> ported.
//   L42-52 WidgetShell props: title (undefined when compact else 'Now Playing'),
//          Music icon glyph, loading, updatedAt, isFetching, isStale, isError,
//          onRefresh=()=>refetch() -> ported.
//   L53-60 media ? (compact ? centred Music glyph + title + artist ...) -> ported.
//   L61-80 standard/tall header row: icon box, title/artist/(tall&&album), and the
//          isPlaying 'Playing' pill -> ported.
//   L82-90 duration>0 ? ProgressBar + elapsed/duration clocks -> ported.
//   L92-113 isTall ? source row (Radio) + volume meter (Volume2 + bar + value) ->
//          ported (the web volume fill uses surface-2 — same as its track — that
//          quirk is preserved).
//   L115-120 !isTall && source ? small footer source row (Radio) -> ported.
//   L123-128 : EmptyState(Music glyph, 'Nothing playing', py-4) -> ported.
//   L130-132 closing WidgetShell/JSX/braces -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported — only RN primitives plus
// existing apps/native components (AppText, SemanticIcon), tokens and native hooks.

import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {useMediaLatest, useVehicles} from '../../../api/hooks/useVehicles';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` usage exactly.
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ------------------------------------------------------------------ */
/*  Inlined @/lib/dateFormat formatDurationClock                       */
/* ------------------------------------------------------------------ */

// web numberFormat.isFiniteNumber.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// web dateFormat.formatDurationClock(ms): "m:ss", returning the universal '—'
// placeholder for null/undefined/non-finite/negative input (no pre-guarding).
function formatDurationClock(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  lucide icons -> repo SemanticIcon glyphs                           */
/* ------------------------------------------------------------------ */

// lucide Music -> repo 'media' glyph; Radio -> 'radio'; Volume2 -> 'volume'.
const MUSIC_GLYPH = getSemanticIconDefinition('media').glyph;
const RADIO_GLYPH = getSemanticIconDefinition('radio').glyph;
const VOLUME_GLYPH = getSemanticIconDefinition('volume').glyph;

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback EmptyState                            */
/* ------------------------------------------------------------------ */

// web EmptyState(icon Music, message, className="py-4"): a centred icon glyph
// above a muted message line.
function EmptyState({glyph, message}: {glyph?: string; message: string}) {
  return (
    <View style={styles.emptyState}>
      {glyph ? (
        <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
          {glyph}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ProgressBar (web local component)                          */
/* ------------------------------------------------------------------ */

// web ProgressBar: surface-2 track with a neon-cyan fill whose width is the clamped
// elapsed/duration percentage (0 when duration <= 0).
function ProgressBar({elapsed, duration}: {elapsed: number; duration: number}) {
  const pct = duration > 0 ? Math.min((elapsed / duration) * 100, 100) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, {width: `${pct}%`}]} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Freshness caption helper for the inlined WidgetShell (web <DataFreshness>
// renders a relative "updated" time when not compact).
function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>): a pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption.
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatFreshness(updatedAt, t)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse-on-data-change effect (web `justUpdated`): ported verbatim; the
  // transient flag drives a subtle border highlight in place of the web box
  // shadow.
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellState}>
        <AppText tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function MediaNowPlayingWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: media,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useMediaLatest(id, 5_000);

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const title = media?.now_playing_title ?? '—';
  const artist = media?.now_playing_artist ?? '—';
  const album = media?.now_playing_album;
  const source = media?.playback_source ?? media?.now_playing_station;
  const status = media?.playback_status;
  const elapsed = media?.now_playing_elapsed ?? 0;
  const duration = media?.now_playing_duration ?? 0;
  const volume = media?.audio_volume;
  const volumeMax = media?.audio_volume_max ?? 11;

  const isPlaying = status === 'Playing';

  return (
    <WidgetShell
      icon={
        <AppText style={styles.headerIcon} tone="accent" weight="bold">
          {MUSIC_GLYPH}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.nowPlaying', 'Now Playing')}
      updatedAt={dataUpdatedAt}>
      {media ? (
        isCompact ? (
          // ── Compact 1×1 ──
          <View style={styles.compact}>
            <AppText style={styles.compactIcon} tone="accent" weight="bold">
              {MUSIC_GLYPH}
            </AppText>
            <AppText numberOfLines={1} style={styles.compactTitle} weight="semibold">
              {title}
            </AppText>
            <AppText
              numberOfLines={1}
              style={styles.compactArtist}
              tone="secondary"
              variant="caption">
              {artist}
            </AppText>
          </View>
        ) : (
          // ── Standard / Tall ──
          <View style={styles.standard}>
            <View style={styles.headRow}>
              <View style={styles.iconBox}>
                <AppText style={styles.iconBoxGlyph} tone="accent" weight="bold">
                  {MUSIC_GLYPH}
                </AppText>
              </View>
              <View style={styles.headText}>
                <AppText numberOfLines={1} style={styles.trackTitle} weight="bold">
                  {title}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={styles.trackArtist}
                  tone="secondary"
                  variant="caption">
                  {artist}
                </AppText>
                {isTall && album ? (
                  <AppText
                    numberOfLines={1}
                    style={styles.trackAlbum}
                    tone="muted"
                    variant="caption">
                    {album}
                  </AppText>
                ) : null}
              </View>
              {isPlaying ? (
                <View style={styles.playingBadge}>
                  <AppText style={styles.playingBadgeText} variant="caption">
                    {t('widget.playing', 'Playing')}
                  </AppText>
                </View>
              ) : null}
            </View>

            {duration > 0 ? (
              <View style={styles.progressSection}>
                <ProgressBar duration={duration} elapsed={elapsed} />
                <View style={styles.timeRow}>
                  <AppText style={styles.timeText} tone="muted" variant="caption">
                    {formatDurationClock(elapsed)}
                  </AppText>
                  <AppText style={styles.timeText} tone="muted" variant="caption">
                    {formatDurationClock(duration)}
                  </AppText>
                </View>
              </View>
            ) : null}

            {isTall ? (
              <View style={styles.tallExtras}>
                {source ? (
                  <View style={styles.sourceRow}>
                    <AppText
                      style={styles.sourceGlyph}
                      tone="secondary"
                      variant="caption">
                      {RADIO_GLYPH}
                    </AppText>
                    <AppText
                      numberOfLines={1}
                      style={styles.sourceText}
                      tone="secondary"
                      variant="caption">
                      {source}
                    </AppText>
                  </View>
                ) : null}
                {volume != null ? (
                  <View style={styles.sourceRow}>
                    <AppText
                      style={styles.sourceGlyph}
                      tone="secondary"
                      variant="caption">
                      {VOLUME_GLYPH}
                    </AppText>
                    <View style={styles.volumeTrack}>
                      <View
                        style={[
                          styles.volumeFill,
                          {width: `${Math.min((volume / volumeMax) * 100, 100)}%`},
                        ]}
                      />
                    </View>
                    <AppText
                      style={styles.volumeValue}
                      tone="secondary"
                      variant="caption">
                      {volume}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ) : null}

            {!isTall && source ? (
              <View style={styles.sourceRowCompact}>
                <AppText
                  style={styles.sourceGlyph}
                  tone="muted"
                  variant="caption">
                  {RADIO_GLYPH}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={styles.sourceTextMuted}
                  tone="muted"
                  variant="caption">
                  {source}
                </AppText>
              </View>
            ) : null}
          </View>
        )
      ) : (
        <EmptyState
          glyph={MUSIC_GLYPH}
          message={t('widget.noMedia', 'Nothing playing')}
        />
      )}
    </WidgetShell>
  );
}

MediaNowPlayingWidget.displayName = 'MediaNowPlayingWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const MEDIA_NOW_PLAYING_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Header icon (cyan music) ---
  headerIcon: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 14,
  },

  // --- Compact 1×1 body ---
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  compactIcon: {
    color: colors.accent,
    fontSize: 18,
    lineHeight: 22,
  },
  compactTitle: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    width: '100%',
  },
  compactArtist: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    width: '100%',
  },

  // --- Standard / Tall body ---
  standard: {
    flex: 1,
    gap: spacing.sm,
  },
  headRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconBoxGlyph: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 20,
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  trackArtist: {
    fontSize: 12,
    lineHeight: 16,
  },
  trackAlbum: {
    fontSize: 11,
    lineHeight: 15,
  },

  // --- Playing pill ---
  playingBadge: {
    backgroundColor: colors.successSurface,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  playingBadgeText: {
    color: colors.success,
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Progress bar + clocks ---
  progressSection: {
    gap: spacing.xs,
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 4,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Tall extras (source + volume) ---
  tallExtras: {
    gap: 6,
    marginTop: 'auto',
  },
  sourceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  sourceGlyph: {
    fontSize: 11,
    lineHeight: 15,
  },
  sourceText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  volumeTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 4,
    overflow: 'hidden',
  },
  volumeFill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: '100%',
  },
  volumeValue: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Non-tall footer source ---
  sourceRowCompact: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 'auto',
  },
  sourceTextMuted: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 15,
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 18,
    letterSpacing: 0.5,
    lineHeight: 22,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderColor: colors.successBorder,
    borderRadius: 12,
    borderWidth: 1,
  },
  shellState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  shellFreshnessOverlay: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // --- DataFreshness ---
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
