// Pure, framework-free model + projection + diagnostics for the StickyChipBar shared surface — the native
// analogue of everything web/src/components/status/StickyChipBar.tsx computes. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): StickyChipBar is a
// horizontal "jump to section" navigation — a row of pill chips that scroll to in-page anchors. It is purely
// presentational and reads NO data hook: its only state is the locally-tracked `activeId`
// (`useState(chips[0]?.id ?? '')`), updated two ways — (a) an `IntersectionObserver` that highlights the
// top-most visible anchored section, and (b) a click that scrolls the section into view and marks it active.
// The parent owns the scroll container (the web reaches into `#main-content`); on Android the host owns the
// scrollable and reports which section anchors are visible, so the surface stays a pure presentation layer.
// Its real render decisions, all reproduced here:
//   * each chip resolves `active = chip.id === activeId` — reduced into [ChipView];
//   * an empty `chips` array renders no pills (web maps an empty list) — carried as [StickyChipBarProjection.Empty];
//   * the active chip is the only highlighted one — carried by [ChipView.active].
// The top-most-visible selection the `IntersectionObserver` performs (web `visible.reduce((min, e) =>
// e.boundingClientRect.top < min.boundingClientRect.top ? e : min)`) is a pure ordering decision, reproduced
// by [topMostVisibleId]; the scroll side effect and the sticky CSS positioning are host concerns (documented
// in StickyChipBar.kt), not projection concerns.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface is PURE PRESENTATIONAL — it renders the controlled chip collection the parent already holds and
// fetches nothing, so it never loads, errors, goes stale or goes offline. Modelling those would fabricate
// behaviour the web spec does not have (Honesty Covenant: no scope narrowing, no silent drift) — the same
// rationale the accepted sibling presentational ports Delta / PillFilterBar / ScoreBadge document. Its REAL,
// fully reproduced states are the populated row ([StickyChipBarProjection.Resolved], every per-chip
// active / inactive branch) and the no-chips branch ([StickyChipBarProjection.Empty]). The web renders an
// empty `<nav>` when `chips` is empty; the native port resolves that to a friendly empty surface so a panel
// is never a blank box (the P3 "every state renders" contract).
//
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations; `InvalidPackageDeclaration`
// because the mandated surface directory (com/teslasync/shared-surfaces/StickyChipBar — the P3 prompt's
// allowed-files path) cannot form a valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal
// in a package identifier), so the package intentionally diverges from the path — exactly as the sibling
// shared surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickychipbar

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the StickyChipBar surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`StickyChipBar`).
 */
object StickyChipBarRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the bar with). */
    const val ID: String = "stickyChipBar"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StickyChipBar"
}

/**
 * One "jump to" target — the native analogue of the web `ChipItem`.
 *
 * @property id the stable in-page anchor id the chip scrolls to and is keyed by (web `ChipItem.id`).
 * @property label the already-localized visible label (web `ChipItem.label`); the host supplies the
 *   translated text, exactly as the web parent passes already-localized labels.
 */
data class ChipItem(
    val id: String,
    val label: String,
)

/**
 * The fully reduced, render-ready projection of one chip — everything the composable needs to paint a single
 * pill, derived purely so every branch is covered off-device.
 *
 * @property id the chip's stable id (web `chip.id`); echoed to the scroll callback on click.
 * @property label the visible label (web `{chip.label}`).
 * @property active whether this chip is the active one (web `chip.id === activeId`); the only highlighted pill.
 */
data class ChipView(
    val id: String,
    val label: String,
    val active: Boolean,
)

/**
 * The projected render state the bar paints — the native analogue of the web component's two real render
 * outcomes. Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
sealed interface StickyChipBarProjection {
    /**
     * The web empty-`chips` outcome. The web renders an empty `<nav>`; the native port resolves it to a
     * friendly empty surface (the P3 "never a blank box" contract).
     */
    data object Empty : StickyChipBarProjection

    /**
     * The populated row — one [ChipView] per chip, in source order, each carrying its active / inactive
     * branch (web maps `chips.map(...)`).
     */
    data class Resolved(
        val chips: List<ChipView>,
    ) : StickyChipBarProjection

    companion object {
        /**
         * Projects [chips] + the tracked [activeId] into the branch the composable paints — the native mirror
         * of everything the web `StickyChipBar` decides before its returned JSX. An empty collection renders
         * [Empty]; otherwise every chip is reduced into a [ChipView] (web `chips.map`), preserving source
         * order so scroll order and visual order match.
         */
        fun project(
            chips: List<ChipItem>,
            activeId: String,
        ): StickyChipBarProjection =
            if (chips.isEmpty()) {
                Empty
            } else {
                Resolved(chips.map { ChipView(id = it.id, label = it.label, active = it.id == activeId) })
            }
    }
}

/**
 * The initial active id — the native mirror of the web `useState(chips[0]?.id ?? '')`: the first chip's id, or
 * the empty string when there are no chips. Pure so the seed is unit-tested without a Compose host.
 */
fun initialActiveId(chips: List<ChipItem>): String = chips.firstOrNull()?.id ?: ""

/**
 * Re-derives a still-valid active id when the chip set changes — keeps [current] when it still names a present
 * chip, otherwise falls back to the first chip's id (or the empty string when the list is empty). This mirrors
 * the web seed (`chips[0]?.id ?? ''`) while preventing a stale highlight from surviving a chip-list change
 * (the web `IntersectionObserver` would eventually correct it; re-deriving avoids a transient wrong highlight).
 * Pure so the reducer is unit-tested off-device.
 */
fun resolveActiveId(
    chips: List<ChipItem>,
    current: String,
): String =
    when {
        chips.isEmpty() -> ""
        chips.any { it.id == current } -> current
        else -> chips.first().id
    }

/**
 * The top-most currently-visible anchored section among [visibleIds], ordered by the document/[order] sequence
 * — the pure native port of the web `IntersectionObserver` callback's `visible.reduce((min, e) =>
 * e.boundingClientRect.top < min.boundingClientRect.top ? e : min)`. The entry highest on screen is the one
 * earliest in document order among those intersecting, so this returns the first [order] entry that is also
 * visible. Ids not present in [order] are ignored (the observer only watches chip anchors). Returns `null`
 * when nothing is visible (web `if (visible.length > 0)`), so the caller leaves the active id unchanged.
 */
fun topMostVisibleId(
    visibleIds: List<String>,
    order: List<String>,
): String? {
    val visible = visibleIds.toHashSet()
    return order.firstOrNull { it in visible }
}

/**
 * The complete inventory of localized strings this surface resolves through the Android catalog (P1/S10),
 * each mapped to its catalog entry. The render boundary resolves these via `stringResource`; this list
 * documents the contract and is asserted complete + unique by the model test.
 *
 * Parity-with-honesty (Honesty Covenant #9, documented not silent): the web source hard-codes its single
 * label — `aria-label="Jump to section"` — as an English literal rather than a `t()` call, so there is no web
 * i18n key to mirror. The native parity bar is higher ("No English literals in native code"), so the port
 * routes the navigation label and the friendly empty-state message through the existing catalog instead:
 *
 * - [NAV_LABEL] → `R.string.translation_nav_quickNav` ("Quick navigation") — the row's accessibility label
 *   (the web `<nav aria-label>`); a quick-jump navigation region.
 * - [EMPTY] → `R.string.translation_common_noData` ("No data available") — the friendly empty-state message
 *   rendered when there are no chips (the web empty `<nav>`).
 */
object StickyChipBarKeys {
    /** The row's accessibility label key — the web `aria-label="Jump to section"` analogue. */
    const val NAV_LABEL: String = "nav.quickNav"

    /** The empty-state message key — rendered when there are no chips (web empty `<nav>`). */
    const val EMPTY: String = "common.noData"

    /** Every catalog key this surface resolves, in source order. */
    val ALL: List<String> = listOf(NAV_LABEL, EMPTY)
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [StickyChipBarRegistration.SLUG]
 * (P1/S11) — never a chip id or label, so a diagnostics line can never leak which sections a page exposes.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per open.
 */
fun recordStickyChipBarOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to StickyChipBarRegistration.SLUG))
}
