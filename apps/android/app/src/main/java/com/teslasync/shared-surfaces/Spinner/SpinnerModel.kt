// Pure, framework-free model + geometry + animation projection for the Spinner shared surface — the native
// analogue of everything the web component derives before it paints its SVG
// (web/src/components/feedback/Spinner.tsx). No Compose, no Android, no HTTP: every declaration here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL brand loading mark — a lightning bolt that "draws itself like a strike, fills to
//     solid, holds, then fades and redraws" over a 2s loop, wrapped in a cyan/emerald electrical glow. The
//     only hook it reads is useMotionPreference(); it owns no data, fetches nothing, and resolves no i18n key
//     of its own (the default accessible name "Loading" and the optional caller-supplied label are the only
//     text). So there is no cache-then-network lifecycle here: the generic data-surface states (empty / error
//     / stale / offline) belong to whatever page shows a Spinner while it loads — this surface IS the loading
//     state. Modelling those states would invent behaviour the source does not have (honesty covenant: no
//     scope narrowing, no silent drift). The real, fully reproduced states are the ones the web source defines
//     and they are all projected below:
//       - the animated draw cycle (the boltDraw @keyframes: strike-in -> fill -> hold -> fade-and-retreat), and
//       - the reduced-motion static frame (useMotionPreference().reduce -> a fully-filled, fully-opaque bolt
//         with the same glow, no draw cycle), plus the three sizes and the with-/without-label split.
//
// Why the geometry + keyframes live here (pure) and not in the composable: the bolt outline and the per-instant
// (drawStart, drawEnd, fillOpacity, opacity) the renderer needs are deterministic functions of the size and the
// loop progress, so they are projected here and asserted off-device — each [BoltFrame] doubles as the per-state
// "snapshot" (exactly the sibling ProgressRing approach), and the reduced-motion frame is a named constant.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Spinner — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling ProgressRing / LiveIndicator surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.spinner

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The loading-mark size scale — the native mirror of the web `sizeMap` (sm / md / lg). Pure numbers (no Compose
 * `Dp`) so the scale is unit-tested off-device; the composable converts [boxDp] to a `Dp` and scales the bolt.
 *
 * @property boxDp the rendered box edge in dp — the web `pixels` (24 / 48 / 80); the bolt is drawn into a square
 *   of this size and the glow scales with it.
 * @property strokeViewport the bolt stroke width in the 200-unit viewBox — the web `stroke` (22 / 14 / 10). The
 *   actual on-screen stroke is [strokeViewport] scaled by `boxPx / VIEWBOX`, so a small mark reads as a chunky
 *   bolt and a large one as a fine-lined bolt, matching the web exactly.
 */
enum class SpinnerSize(
    val boxDp: Int,
    val strokeViewport: Float,
) {
    /** Web `sm` — a 24px mark with a 22-unit stroke (chunky at small size). */
    Sm(boxDp = 24, strokeViewport = 22f),

    /** Web `md` — the 48px default mark with a 14-unit stroke. */
    Md(boxDp = 48, strokeViewport = 14f),

    /** Web `lg` — an 80px mark with a fine 10-unit stroke. */
    Lg(boxDp = 80, strokeViewport = 10f),
}

/**
 * One vertex of the bolt outline in the web 200x200 viewBox. Pure data (no Compose `Offset`) so the outline is
 * asserted off-device; the composable maps each vertex to a scaled `Offset` when it builds the `Path`.
 */
data class BoltVertex(
    val x: Float,
    val y: Float,
)

/**
 * The render-ready state of the bolt at one instant of the loop — the native analogue of the three animated
 * SVG attributes the web `boltDraw` keyframes drive. Pure data so each frame is a unit-tested per-state
 * snapshot.
 *
 * @property drawStart the fraction of the outline (0f..1f) where the visible stroke begins. `0f` for most of
 *   the cycle; it advances to `1f` during the fade-out so the stroke "retreats" from its start — the native
 *   mirror of the web `stroke-dashoffset` going negative (`0 -> -100`).
 * @property drawEnd the fraction of the outline (0f..1f) where the visible stroke ends. It advances `0f -> 1f`
 *   during the strike-in — the native mirror of the web `stroke-dashoffset` going `100 -> 0`.
 * @property fillOpacity the bolt fill alpha (0f..1f) — the web `fill-opacity` (`0` while striking in, `1` once
 *   filled, back to `0` as it fades).
 * @property opacity the overall mark alpha (0f..1f) — the web element `opacity` (`0.15 -> 1 -> 0.9 -> 0`); the
 *   glow tracks it so the whole mark, halo included, fades together.
 */
data class BoltFrame(
    val drawStart: Float,
    val drawEnd: Float,
    val fillOpacity: Float,
    val opacity: Float,
)

/** One stop of the web `boltDraw` @keyframes, already mapped from the SVG attributes into [BoltFrame] space. */
private data class BoltKeyframe(
    val stop: Float,
    val drawStart: Float,
    val drawEnd: Float,
    val fillOpacity: Float,
    val opacity: Float,
)

/**
 * Pure projection of every web `Spinner` derivation: the bolt outline, the size scale, and the `boltDraw`
 * keyframe timeline. A 1:1 port of the geometry and animation the web component encodes in its SVG `path` and
 * its CSS keyframes, kept free of Compose so the composable only has to draw the result.
 */
object SpinnerProjection {
    /** The web `viewBox="0 0 200 200"` edge; the bolt outline and stroke are expressed in this unit space. */
    const val VIEWBOX: Float = 200f

    /**
     * The lightning-bolt outline — a 1:1 decode of the web SVG path `M112 30L62 108h34L78 170l58-82h-34z`
     * (absolute moves/lines plus the `h`/`l` relative segments), as the closed polygon the renderer strokes
     * and fills. The path is closed back to the first vertex by the trailing `z`.
     */
    val BOLT_OUTLINE: List<BoltVertex> =
        listOf(
            BoltVertex(112f, 30f), // M112 30 — top notch
            BoltVertex(62f, 108f), // L62 108 — down to the left elbow
            BoltVertex(96f, 108f), // h34 — right along the elbow (62 + 34)
            BoltVertex(78f, 170f), // L78 170 — down to the bottom tip
            BoltVertex(136f, 88f), // l58 -82 — up-right to the right shoulder (78 + 58, 170 - 82)
            BoltVertex(102f, 88f), // h-34 — left along the shoulder (136 - 34)
        )

    /** The reduced-motion frame — a fully-drawn, fully-filled, fully-opaque bolt (web `reduce` branch). */
    val STATIC_FRAME: BoltFrame = BoltFrame(drawStart = 0f, drawEnd = 1f, fillOpacity = 1f, opacity = 1f)

    // The web `boltDraw` keyframes, with `stroke-dashoffset` decoded into (drawStart, drawEnd):
    //   offset  100 -> start 0, end 0  (nothing yet)      offset 0    -> start 0, end 1  (fully struck in)
    //   offset -100 -> start 1, end 1  (retreated away).
    private val KEYFRAMES: List<BoltKeyframe> =
        listOf(
            BoltKeyframe(stop = 0.00f, drawStart = 0f, drawEnd = 0f, fillOpacity = 0f, opacity = 0.15f),
            BoltKeyframe(stop = 0.30f, drawStart = 0f, drawEnd = 1f, fillOpacity = 0f, opacity = 1.00f),
            BoltKeyframe(stop = 0.55f, drawStart = 0f, drawEnd = 1f, fillOpacity = 1f, opacity = 1.00f),
            BoltKeyframe(stop = 0.80f, drawStart = 0f, drawEnd = 1f, fillOpacity = 1f, opacity = 0.90f),
            BoltKeyframe(stop = 1.00f, drawStart = 1f, drawEnd = 1f, fillOpacity = 0f, opacity = 0.00f),
        )

    /**
     * The on-screen bolt stroke width for a [size] drawn into a [boxPx]-wide canvas — the web `stroke` scaled
     * out of the 200-unit viewBox (`strokeViewport * boxPx / VIEWBOX`).
     */
    fun strokeWidthPx(
        size: SpinnerSize,
        boxPx: Float,
    ): Float = size.strokeViewport / VIEWBOX * boxPx

    /**
     * The [BoltFrame] at [progress] through the 2s loop (`0f..1f`) — a linear interpolation between the
     * surrounding web keyframe stops. [progress] is clamped into `0f..1f` first so an over- or under-driven
     * animation value never reads off the ends of the timeline.
     */
    fun frameAt(progress: Float): BoltFrame {
        val p = clampProgress(progress)
        val upperIndex = KEYFRAMES.indexOfFirst { it.stop >= p }
        if (upperIndex <= 0) return KEYFRAMES.first().toFrame()
        val lower = KEYFRAMES[upperIndex - 1]
        val upper = KEYFRAMES[upperIndex]
        val span = upper.stop - lower.stop
        val t = if (span <= 0f) 0f else (p - lower.stop) / span
        return BoltFrame(
            drawStart = lerp(lower.drawStart, upper.drawStart, t),
            drawEnd = lerp(lower.drawEnd, upper.drawEnd, t),
            fillOpacity = lerp(lower.fillOpacity, upper.fillOpacity, t),
            opacity = lerp(lower.opacity, upper.opacity, t),
        )
    }

    /** Web `{label && <span>…</span>}`: the caption is shown only for a present, non-empty label. */
    fun hasVisibleLabel(label: String?): Boolean = !label.isNullOrEmpty()

    /**
     * The accessible name for the mark — web `aria-label={label ?? 'Loading'}`. Mirrors the `??` exactly: a
     * `null` label falls back to [fallback] (the localized "Loading"); any supplied label, even empty, is kept.
     */
    fun accessibleLabel(
        label: String?,
        fallback: String,
    ): String = label ?: fallback

    private fun clampProgress(progress: Float): Float {
        if (progress.isNaN()) return 0f
        return progress.coerceIn(0f, 1f)
    }

    private fun lerp(
        start: Float,
        stop: Float,
        fraction: Float,
    ): Float = start + (stop - start) * fraction

    private fun BoltKeyframe.toFrame(): BoltFrame =
        BoltFrame(drawStart = drawStart, drawEnd = drawEnd, fillOpacity = fillOpacity, opacity = opacity)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the size or
 * the caller-supplied label — so a diagnostics line can never leak what a screen was loading.
 */
object SpinnerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "Spinner"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emit the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
