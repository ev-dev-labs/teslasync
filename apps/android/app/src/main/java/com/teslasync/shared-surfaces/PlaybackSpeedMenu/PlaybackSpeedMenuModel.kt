// Pure, framework-free model + projection + diagnostics for the PlaybackSpeedMenu shared surface — the native
// analogue of every decision the web component makes (web/src/components/data-display/PlaybackSpeedMenu.tsx)
// before it paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in
// the :app:testReleaseUnitTest gate, keeping the composable a thin render layer over these pure functions (the
// accepted sibling-surface contract used by Speed / FreshnessIndicator / AnimatedNumber).
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURELY PRESENTATIONAL control. Its only hook is `useTranslation`; the current `speed` and the `onChange`
//     callback are caller props. There is NO data port to bind (no P1/S8 Source/ViewModel, no fetch) — modelling
//     one would invent behaviour the web spec does not have (honesty covenant: no scope narrowing, no silent
//     drift), exactly as the accepted Speed / AnimatedNumber / VisuallyHidden presentational ports document. The
//     surface therefore has NO loading / empty / error / stale / offline lifecycle: it fetches nothing, so a
//     spinner or a "stale" chip would fabricate a state the web component cannot enter. The reproduced states are
//     the discrete speed selections (one per REPLAY_SPEEDS slot) plus the two transition gestures below.
//   • `REPLAY_SPEEDS = [1, 10, 25, 50, 100]` — the slowest→fastest multipliers ([REPLAY_SPEEDS]).
//   • `nextSpeed(current)` — cycle to the next-fastest, WRAPPING past the top back to the slowest (web
//     `REPLAY_SPEEDS[(idx + 1) % length]`, with an unknown current — `indexOf` = -1 — falling to the slowest,
//     `(-1 + 1) % length = 0`). This is the tap / left-click action ([nextSpeed]).
//   • `shiftSpeed(current, delta)` — step `delta` slots, CLAMPED to the available range (web
//     `clamp(idx + delta, 0, length - 1)`, unknown current treated as slot 0). The web binds `shiftSpeed(-1)` to
//     the right-click / context-menu gesture, so a backward step from the slowest stays at the slowest rather
//     than wrapping ([shiftSpeed]).
//   • Visible label `{speed}x` (web JSX text node) → [speedLabel]; the only on-screen text the surface renders.
//
// i18n: the web component makes exactly ONE `t()` call — `t('replay.controls.speed', 'Playback speed')` — used as
// the control's `aria-label`. That key already exists in the shared P1/S10 catalog
// (`translation.replay.controls.speed` = "Playback speed"); the composable resolves it through the generated
// Android string resource. The "x" multiplier suffix is a unit symbol, not translatable prose (it is identical in
// the web source's `{speed}x`), so it lives here as a constant exactly like the sibling surfaces' unit symbols.
// The pure model carries NO English microcopy — [accessibleLabel] composes the localized name (resolved at the
// render boundary) with the non-translatable `{speed}x` value so the spoken label is testable off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/PlaybackSpeedMenu — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.playbackspeedmenu

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the PlaybackSpeedMenu surface. [SLUG] is the prompt-mandated diagnostics slug
 * emitted with the one-shot `view.opened` event (P1/S11); [ID] is the stable key a host would bind the surface
 * with. [SPEED_LABEL_KEY] records the single web i18n key this surface reproduces, so the catalog binding is
 * greppable from the model and assertable in the off-device test.
 */
object PlaybackSpeedMenuRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "playbackSpeedMenu"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "PlaybackSpeedMenu"

    /** The single web i18n key reproduced (web `t('replay.controls.speed')`), present in the P1/S10 catalog. */
    const val SPEED_LABEL_KEY: String = "translation.replay.controls.speed"
}

/**
 * The replay speed multipliers, slowest → fastest — a verbatim port of the web `REPLAY_SPEEDS` constant. The order
 * is the cycle order [nextSpeed] advances through and the clamp range [shiftSpeed] is bounded by.
 */
val REPLAY_SPEEDS: List<Int> = listOf(1, 10, 25, 50, 100)

/**
 * Step the speed up by [delta] slots (signed), CLAMPED to the available range — the native port of the web
 * `shiftSpeed`. An unrecognised [current] (not in [REPLAY_SPEEDS]) is treated as slot 0, matching the web
 * `idx === -1 ? 0 : idx` guard, and the result never leaves `[0, lastIndex]` so a backward step from the slowest
 * speed stays at the slowest (the web binds `shiftSpeed(-1)` to the backward / right-click gesture).
 */
fun shiftSpeed(
    current: Int,
    delta: Int,
): Int {
    val index = REPLAY_SPEEDS.indexOf(current).let { if (it == -1) 0 else it }
    val next = (index + delta).coerceIn(0, REPLAY_SPEEDS.lastIndex)
    return REPLAY_SPEEDS[next]
}

/**
 * Cycle to the next-fastest speed, WRAPPING from the fastest back to the slowest — the native port of the web
 * `nextSpeed` (`REPLAY_SPEEDS[(idx + 1) % length]`). An unrecognised [current] yields the slowest speed (the web
 * `indexOf` returns -1, so `(-1 + 1) % length = 0`). This is the tap / primary action.
 */
fun nextSpeed(current: Int): Int {
    val index = REPLAY_SPEEDS.indexOf(current)
    return REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.size]
}

/**
 * Pure projection from a speed multiplier to the surface's render-ready strings — the native mirror of the web
 * component's only derivations: the visible `{speed}x` label and the spoken accessibility label (the localized
 * "Playback speed" name plus the current value). Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves the localized name and draws what these return.
 */
object PlaybackSpeedMenuProjection {
    /** The multiplier suffix the web appends in `{speed}x` — a unit symbol, identical across locales. */
    const val MULTIPLIER_SUFFIX: String = "x"

    /** Separator between the localized control name and the current value in the spoken accessibility label. */
    private const val A11Y_SEPARATOR: String = ", "

    /** The visible label for [speed] — web `{speed}x` (e.g. `10x`). The surface's only on-screen text. */
    fun speedLabel(speed: Int): String = "$speed$MULTIPLIER_SUFFIX"

    /**
     * The spoken accessibility label — the localized control [name] (web `aria-label` =
     * `t('replay.controls.speed')`) followed by the current [speed] value, so a screen-reader user hears both the
     * purpose and the active selection. The web `aria-label` alone omits the value; surfacing it here is the
     * deliberate a11y improvement the sibling ports also make, achieved WITHOUT inventing any new i18n key (the
     * value is the same non-translatable `{speed}x` token already shown on screen).
     */
    fun accessibleLabel(
        name: String,
        speed: Int,
    ): String = "$name$A11Y_SEPARATOR${speedLabel(speed)}"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event tagged
 * with the surface [SLUG] — never the current speed or the callback target — so a diagnostics line can never leak
 * a user's playback choice. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable
 * calls it once per surface open.
 */
object PlaybackSpeedMenuDiagnostics {
    /** The surface slug emitted with every diagnostic (mirrors [PlaybackSpeedMenuRegistration.SLUG]). */
    const val SLUG: String = PlaybackSpeedMenuRegistration.SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
