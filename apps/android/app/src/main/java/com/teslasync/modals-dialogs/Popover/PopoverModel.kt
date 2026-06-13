// Pure, framework-free model + projection for the Popover modal/dialog surface — the native analogue of the only
// thing the web component computes before it renders (web/src/components/ui/Popover.tsx, the `useLayoutEffect`
// `compute()` body). No Compose, no Android, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, so the Compose layer (Popover.kt) stays a thin shell that just feeds the
// measured rectangles in and applies the resulting offset.
//
// The web component is a lightweight anchored overlay primitive: it portals its `children` to <body>, positions
// the content relative to the trigger's bounding rect, auto-flips `side` when the requested side overflows the
// viewport, shifts/clamps horizontally + vertically to keep the content on screen, and closes on Esc /
// click-outside / blur-out (restoring focus to the trigger). It binds NO data hook — its only React imports are
// `useState`/`useRef`/`useEffect`/`useLayoutEffect` for the *positioning* effect, not for fetching — and it has NO
// i18n (the surface is anonymous; the only human string is the caller-supplied `ariaLabel`). So, exactly like the
// sibling ConfirmDialog / KioskOverlay primitives, the cache-then-network lifecycle (loading / empty / error /
// stale / offline) lives on the OWNING surface that hosts the trigger, never here; modelling those phases would
// invent behaviour the web spec does not have (drift). The branches the web source actually defines are the
// complete state set this surface renders, and each is projected here:
//   1. the requested-side resolution with the overflow auto-flip (web `resolvedSide` — bottom<->top),
//   2. the vertical placement for each resolved side (web `top = a.bottom + sideOffset` | `a.top - sideOffset - c.height`),
//   3. the cross-axis alignment (web `align` — start | end | center),
//   4. the horizontal viewport clamp (web right-overflow then left-margin),
//   5. the vertical viewport clamp (web bottom-overflow then top-margin — the rare both-sides-overflow case).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/Popover — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations (the file's primary export is [PopoverProjection], not a `PopoverModel` type).
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.popover

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Which side of the anchor the content prefers — the native mirror of the web `PopoverSide` (`'bottom' | 'top'`).
 * The requested side is only a preference: [PopoverProjection.resolveSide] flips it when it would overflow.
 */
enum class PopoverSide {
    Bottom,
    Top,
}

/**
 * Cross-axis alignment of the content against the anchor — the native mirror of the web `PopoverAlign`
 * (`'start' | 'end' | 'center'`). `Start` pins the content's leading edge to the anchor's leading edge, `End`
 * pins the trailing edges, and `Center` centres the content over the anchor (all in physical pixels, matching the
 * web component's `a.left` / `a.right` math).
 */
enum class PopoverAlign {
    Start,
    Center,
    End,
}

/**
 * A pixel rectangle in window/viewport coordinates — the native analogue of the web `getBoundingClientRect()`
 * result the component reads for the anchor. Carries the four edges; [width] / [height] are derived so the
 * projection can mirror the web's `a.width` / `a.height` reads without a second source of truth.
 */
data class PopoverRect(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
) {
    /** Anchor width (web `a.width`). */
    val width: Int get() = right - left

    /** Anchor height (web `a.height`). */
    val height: Int get() = bottom - top
}

/** A pixel size — used for both the measured content box (web `c`) and the viewport (web `vw` / `vh`). */
data class PopoverSize(
    val width: Int,
    val height: Int,
)

/**
 * The fully resolved placement the Compose layer applies — the native analogue of the web `{ top, left,
 * resolvedSide }` state the effect sets. Pure data (no Compose types) so the projection is unit-tested without a
 * UI host.
 *
 * @property x the content's left edge in window coordinates (web `left`).
 * @property y the content's top edge in window coordinates (web `top`).
 * @property resolvedSide the side actually used after the overflow auto-flip (web `resolvedSide`).
 */
data class PopoverPlacement(
    val x: Int,
    val y: Int,
    val resolvedSide: PopoverSide,
)

/**
 * The placement preferences the web component takes as props (`side` / `align` / `sideOffset`), grouped into one
 * carrier so the pure [PopoverProjection.resolve] entry stays small. Defaults mirror the web prop defaults
 * (`side = 'bottom'`, `align = 'start'`, `sideOffset = 6`).
 *
 * @property side the preferred side; flips on overflow (web `side`).
 * @property align the cross-axis alignment (web `align`).
 * @property sideOffset the pixel gap between the anchor and the content along the resolved side (web `sideOffset`).
 */
data class PopoverOptions(
    val side: PopoverSide = PopoverSide.Bottom,
    val align: PopoverAlign = PopoverAlign.Start,
    val sideOffset: Int = PopoverProjection.DEFAULT_SIDE_OFFSET_PX,
)

/**
 * Pure projection from the measured rectangles to the render-ready [PopoverPlacement] — a 1:1 port of the web
 * component's `useLayoutEffect` `compute()` body. Given the anchor rect, the measured content box, the viewport
 * size, the requested [PopoverSide] / [PopoverAlign], and the pixel `sideOffset`, it resolves the side (flipping
 * on overflow), computes the cross-axis offset, and clamps the result inside an 8 px viewport margin. No Compose,
 * no formatting — just the integer geometry, so it runs entirely off-device.
 */
object PopoverProjection {
    /** Web `const margin = 8`: the minimum gap kept between the content and every viewport edge. */
    const val MARGIN_PX: Int = 8

    /** Web `sideOffset = 6` default: the gap between the anchor and the content along the resolved side. */
    const val DEFAULT_SIDE_OFFSET_PX: Int = 6

    /**
     * Resolves the side actually used, flipping the requested side when it overflows and the opposite side has
     * more room — a direct port of the web `if (side === 'bottom' && c.height > spaceBelow && spaceAbove >
     * spaceBelow) … else if (side === 'top' && …)`. A side is kept whenever it fits or the opposite side is no
     * roomier, so the content never flips into a tighter space.
     */
    fun resolveSide(
        requestedSide: PopoverSide,
        anchor: PopoverRect,
        contentHeight: Int,
        viewportHeight: Int,
        sideOffset: Int,
    ): PopoverSide {
        val spaceBelow = viewportHeight - anchor.bottom - sideOffset - MARGIN_PX
        val spaceAbove = anchor.top - sideOffset - MARGIN_PX
        return when (requestedSide) {
            PopoverSide.Bottom ->
                if (contentHeight > spaceBelow && spaceAbove > spaceBelow) PopoverSide.Top else PopoverSide.Bottom
            PopoverSide.Top ->
                if (contentHeight > spaceAbove && spaceBelow > spaceAbove) PopoverSide.Bottom else PopoverSide.Top
        }
    }

    /**
     * Projects the measured [anchor] / [content] / [viewport] rectangles into the render-ready [PopoverPlacement],
     * mirroring the web `compute()` order exactly: resolve the side, place the top edge for that side, align the
     * left edge on the cross axis, then clamp horizontally (right-overflow, then left-margin) and vertically
     * (bottom-overflow, then top-margin). All arithmetic is integer pixels; the cross-axis centre uses the same
     * `a.width / 2 - c.width / 2` grouping the web does (integer division truncates toward zero). The [options]
     * carry the requested side / alignment / side-offset (web props), defaulting to the web defaults.
     */
    fun resolve(
        anchor: PopoverRect,
        content: PopoverSize,
        viewport: PopoverSize,
        options: PopoverOptions = PopoverOptions(),
    ): PopoverPlacement {
        val resolvedSide = resolveSide(options.side, anchor, content.height, viewport.height, options.sideOffset)

        var top =
            if (resolvedSide == PopoverSide.Bottom) {
                anchor.bottom + options.sideOffset
            } else {
                anchor.top - options.sideOffset - content.height
            }

        var left =
            when (options.align) {
                PopoverAlign.Start -> anchor.left
                PopoverAlign.End -> anchor.right - content.width
                PopoverAlign.Center -> anchor.left + anchor.width / 2 - content.width / 2
            }

        // Clamp horizontally to the viewport (web: right-overflow first, then the left margin).
        if (left + content.width + MARGIN_PX > viewport.width) left = viewport.width - content.width - MARGIN_PX
        if (left < MARGIN_PX) left = MARGIN_PX

        // Clamp vertically (web: rare — only when both sides overflow).
        if (top + content.height + MARGIN_PX > viewport.height) top = viewport.height - content.height - MARGIN_PX
        if (top < MARGIN_PX) top = MARGIN_PX

        return PopoverPlacement(x = left, y = top, resolvedSide = resolvedSide)
    }
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object PopoverRegistration {
    /** Stable surface id. */
    const val ID: String = "popover"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Popover"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PopoverRegistration.SLUG] (P1/S11). Carries
 * only the slug — never the anchor position, the content, or the caller's `ariaLabel` — so a diagnostics line can
 * never leak where the popover opened or what it showed. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from the open-transition effect.
 */
fun recordPopoverOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PopoverRegistration.SLUG))
}
