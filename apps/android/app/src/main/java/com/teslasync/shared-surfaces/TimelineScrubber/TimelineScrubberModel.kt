// Pure, framework-free model + projection + diagnostics for the TimelineScrubber shared surface — the native
// analogue of every value the web component derives from its props before returning JSX
// (web/src/components/data-display/TimelineScrubber.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer over these pure functions.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A rich trip-replay scrubber: a controlled progress track with drag-to-scrub (intermediate `onSeek`
//     emissions every SCRUB_INTERVAL_MS ms), a hover/drag preview tooltip (pre-formatted speed/power/SoC/
//     elevation + a m:ss clock), keyframe marker ticks (charge boundaries, fast segments, regen peaks, low
//     SoC, …), an optional decorative background, and a touch-friendly hit area. It is PURELY presentational:
//     its only inputs are props (`progress`, `buffered`, `duration`, `markers`, `getPreviewAt`, `onSeek`,
//     `background`) and its only web hooks are `useTranslation` (i18n) and `useMotionPreference` (reduced
//     motion). There is NO data fetch — the replay page owns the timeline and feeds it down — so there is no
//     network lifecycle to model (no loading / error / stale / offline), exactly as the sibling presentational
//     surfaces (TimeMarker, PlaybackSpeedMenu) document. Modelling one would invent a fetch the web spec does
//     not have (honesty covenant: no scope narrowing, no silent drift). Its real, fully-reproduced states are
//     the empty timeline (no markers, unknown duration → a bare track), a populated timeline, the hover/drag
//     preview, the buffered fill, and the reduced-motion path — every conditional branch the web source has.
//   • `Math.max(0, Math.min(1, …))` clamps `progress` and `buffered` to 0..1 — ported in [clampFraction].
//   • `aria-valuetext` renders the current playback clock and is `undefined` when the duration is non-finite or
//     ≤ 0 (`if (!Number.isFinite(duration) || duration <= 0) return undefined`) — ported in [ariaValueText].
//   • The preview clock is likewise `null` when the duration is unusable — ported in [previewClock].
//   • `marker.count != null && marker.count > 1` shows the cluster-count badge — ported in [showCountBadge].
//
// SI boundary (unit-conversion instructions, ADR / Phase-48): this surface does NO number formatting. The web
// component's preview values arrive ALREADY formatted (`TimelinePreviewPoint.speed/power/soc/elevation` are
// pre-formatted strings the caller built with the unit-aware formatter), and `duration` is a plain seconds
// count used only for the accessibility clock. So — like the web — there is no unit conversion here; the only
// numeric work is the m:ss clock, which is unit-agnostic.
//
// Marker color mapping (web `MARKER_COLORS`, Tailwind classes → generated brand tokens, resolved in the
// composable, never a raw hex literal): each kind maps to a semantic [MarkerTone] plus a `lighten` flag that
// preserves the web's lighter-within-family relationship (the `-300` shades render as the base brand token
// lightened toward white; the `-400` shades use the base token). start/charge-start → battery (emerald),
// stop/low-soc → danger (rose/red), fast-segment/charge-stop → energy (amber), regen-peak → regen (cyan),
// event → a neutral surface token. See [markerStyle].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TimelineScrubber — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timelinescrubber

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToLong

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val TIMELINE_SCRUBBER_SLUG: String = "TimelineScrubber"

/**
 * Smooth-scrub cadence — the web `SCRUB_INTERVAL_MS`: while dragging, intermediate `onSeek` values are emitted
 * at most once per this many milliseconds (the final position is always emitted on release).
 */
const val SCRUB_INTERVAL_MS: Long = 50L

/** The mountain glyph the web prepends to the preview's speed line (`⛰`, language-neutral). */
const val PREVIEW_SPEED_GLYPH: String = "\u26F0"

/** Seconds in a minute — the m:ss clock divisor. */
private const val SECONDS_PER_MINUTE: Long = 60L

/** The two-digit zero-pad width for the seconds component of the m:ss clock (web `padStart(2, '0')`). */
private const val SECONDS_PAD_WIDTH: Int = 2

/** Percent scale for the 0..1 fraction → 0..100 conversion (web `* 100`). */
private const val PERCENT_SCALE: Double = 100.0

/** The minimum cluster count that surfaces the marker's count badge (web `count > 1`). */
private const val MIN_CLUSTER_COUNT: Int = 1

/**
 * The kind of a keyframe marker on the timeline — the native mirror of the web `TimelineMarkerKind` union.
 * Drives the tick color (through [markerStyle] → a brand token) and the default accessible / tooltip label.
 */
enum class TimelineMarkerKind {
    Start,
    Stop,
    ChargeStart,
    ChargeStop,
    FastSegment,
    RegenPeak,
    LowSoc,
    Event,
}

/**
 * One notable moment on the timeline — the native mirror of the web `TimelineMarker`.
 *
 * @property at normalized 0..1 position along the timeline (clamped before use).
 * @property kind the marker's semantic kind; selects the tick color and the default label.
 * @property label optional human label rendered in the tooltip + folded into the accessible label.
 * @property href optional route a host may open instead of seeking (carried for data-shape parity; the seek
 *   handler still fires, mirroring the web marker's `onSeek`).
 * @property count when the marker represents N clustered events, the count surfaced in a small badge.
 */
data class TimelineMarker(
    val at: Double,
    val kind: TimelineMarkerKind,
    val label: String? = null,
    val href: String? = null,
    val count: Int? = null,
)

/**
 * Pre-formatted preview values for a normalized position — the native mirror of the web `TimelinePreviewPoint`.
 * The scrubber does NO number formatting itself: the host samples the timeline and hands back already-formatted,
 * unit-aware strings (web contract). Any absent field is simply not rendered.
 *
 * @property at the normalized 0..1 position the preview was sampled for.
 * @property speed pre-formatted speed string, or null.
 * @property power pre-formatted power string, or null.
 * @property soc pre-formatted state-of-charge string, or null.
 * @property elevation pre-formatted elevation string, or null.
 */
data class TimelinePreviewPoint(
    val at: Double,
    val speed: String? = null,
    val power: String? = null,
    val soc: String? = null,
    val elevation: String? = null,
)

/**
 * Semantic color family for a marker tick — resolved to a concrete brand token in the composable (the
 * theme-aware `TeslaTokens.status.*` / theme-invariant `TeslaTokens.chart.*` palettes), never a raw hex.
 */
enum class MarkerTone { Battery, Danger, Energy, Regen, Neutral }

/**
 * A marker's resolved visual style — the semantic [tone] plus whether it is the lighter within-family variant
 * (the web `-300` shade vs the base `-400` shade). The composable maps [tone] → a brand token and, when
 * [lighten] is set, blends it toward white so the two same-family kinds stay visually distinct.
 */
data class MarkerStyle(
    val tone: MarkerTone,
    val lighten: Boolean,
)

/**
 * The marker tick style for a [kind] — a faithful port of the web `MARKER_COLORS` table. The `-400` shades map
 * to the base brand token (`lighten = false`); the `-300` shades map to the same token lightened toward white
 * (`lighten = true`), preserving the web's lighter-within-family relationship without a raw hex literal.
 */
fun markerStyle(kind: TimelineMarkerKind): MarkerStyle =
    when (kind) {
        TimelineMarkerKind.Start -> MarkerStyle(MarkerTone.Battery, lighten = false)
        TimelineMarkerKind.ChargeStart -> MarkerStyle(MarkerTone.Battery, lighten = true)
        TimelineMarkerKind.Stop -> MarkerStyle(MarkerTone.Danger, lighten = false)
        TimelineMarkerKind.LowSoc -> MarkerStyle(MarkerTone.Danger, lighten = true)
        TimelineMarkerKind.FastSegment -> MarkerStyle(MarkerTone.Energy, lighten = false)
        TimelineMarkerKind.ChargeStop -> MarkerStyle(MarkerTone.Energy, lighten = true)
        TimelineMarkerKind.RegenPeak -> MarkerStyle(MarkerTone.Regen, lighten = true)
        TimelineMarkerKind.Event -> MarkerStyle(MarkerTone.Neutral, lighten = false)
    }

/** Clamp a [value] to 0..1, mapping NaN to 0 — the web `Math.max(0, Math.min(1, value))` (Double). */
fun clampFraction(value: Double): Double = if (value.isNaN()) 0.0 else value.coerceIn(0.0, 1.0)

/** Clamp a [value] to 0..1, mapping NaN to 0 — the web `Math.max(0, Math.min(1, value))` (Float, for Compose). */
fun clampFraction(value: Float): Float = if (value.isNaN()) 0f else value.coerceIn(0f, 1f)

/** The integer percent (0..100) of a clamped [fraction] — the web `Math.round(fraction * 100)`. */
fun percentOf(fraction: Double): Int = (clampFraction(fraction) * PERCENT_SCALE).roundToLong().toInt()

/**
 * The normalized 0..1 position for a pointer at [xPx] over a track of [widthPx] pixels — the native mirror of
 * the web `positionAtClientX` (`(clientX - rect.left) / rect.width`, clamped). A non-positive width yields 0.
 */
fun fractionAt(
    xPx: Float,
    widthPx: Int,
): Float = if (widthPx <= 0) 0f else clampFraction(xPx / widthPx)

/** Format a whole-second [totalSeconds] count as `m:ss` — the web `${m}:${String(sec).padStart(2, '0')}`. */
fun formatClock(totalSeconds: Long): String {
    val safe = if (totalSeconds < 0) 0 else totalSeconds
    val minutes = safe / SECONDS_PER_MINUTE
    val seconds = safe % SECONDS_PER_MINUTE
    return "$minutes:${seconds.toString().padStart(SECONDS_PAD_WIDTH, '0')}"
}

/**
 * The accessibility clock for the current playhead — the web `aria-valuetext`. Null when [durationSeconds] is
 * non-finite or ≤ 0 (web `if (!Number.isFinite(duration) || duration <= 0) return undefined`); otherwise the
 * `m:ss` rendering of `round(duration * progress)`.
 */
fun ariaValueText(
    durationSeconds: Double,
    progress: Float,
): String? {
    if (!durationSeconds.isFinite() || durationSeconds <= 0.0) return null
    return formatClock((durationSeconds * clampFraction(progress)).roundToLong())
}

/**
 * The preview tooltip's clock at a normalized position [at] — the web `previewTimeStr`. Null when
 * [durationSeconds] is non-finite or ≤ 0; otherwise the `m:ss` rendering of `round(duration * at)`.
 */
fun previewClock(
    durationSeconds: Double,
    at: Float,
): String? {
    if (!durationSeconds.isFinite() || durationSeconds <= 0.0) return null
    return formatClock((durationSeconds * clampFraction(at)).roundToLong())
}

/** Whether the cluster-count badge shows — the web `marker.count != null && marker.count > 1`. */
fun showCountBadge(count: Int?): Boolean = count != null && count > MIN_CLUSTER_COUNT

/**
 * The accessible label for a marker — the localized [name] (the marker's own label or its kind label) joined
 * with the localized [atPercentPhrase] ("at 42%"). The web builds `${label} ${t('replay.markers.atPercent')}`
 * when a label is present and `${kind} ${pct}%` otherwise; this unifies on the localized phrase so no English
 * literal (and no raw kind token) is spoken — a faithful, fully-localized improvement over the web fallback.
 */
fun markerAccessibleLabel(
    name: String,
    atPercentPhrase: String,
): String = "$name $atPercentPhrase"

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a progress
 * value, marker position, or preview figure — so a diagnostics line can never leak a user's trip timeline.
 */
object TimelineScrubberDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = TIMELINE_SCRUBBER_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
