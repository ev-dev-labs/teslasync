// Pure, framework-free model + projection for the WeekSelector feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/weekly-digest/WeekSelector.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// WeekSelector is a presentational control: the web component takes its `weekLabel` / `isCurrentWeek` and the
// `onPrevWeek` / `onNextWeek` callbacks as props from the WeeklyDigest page (`useWeeklyDigest`), which owns
// the TanStack queries and the `weekOffset` client state. The page itself gates the cache-then-network
// lifecycle — it renders a skeleton while loading, a QueryError on failure, and an EmptyState when the week
// has no rows, mounting this control only in the resolved, has-data branch
// (`isLoading ? … : error ? … : !hasData ? <EmptyState/> : <FadeIn><WeekSelector …/>…`). So, exactly as the
// sibling StatusHeader / SummaryStatsRow presentational ports document, the loading / empty / error /
// stale / offline states live on the owning page, not here; the two branches the web source defines —
// `isCurrentWeek` (show the "Current" badge, disable Next) and not-current (hide the badge, enable Next) —
// are the complete state set this surface renders. The only data source the web component itself binds is
// `useTranslation`, mapped natively to the generated i18n catalog (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/WeekSelector — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.weekselector

import io.teslasync.shared.core.diagnostics.Logger

/** The em-dash fallback shown when the week label is blank, so the control is never a blank box. */
private const val EM_DASH: String = "\u2014"

/**
 * The fully projected, render-ready view — the native analogue of everything the web component decides
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property weekLabel the date-range label the center slot renders (web `{weekLabel}`); a blank input folds
 *   to an em dash so the slot never collapses to nothing.
 * @property showCurrentBadge whether the "Current" badge renders — web `isCurrentWeek && <Badge>`.
 * @property nextEnabled whether the Next control is enabled — web `disabled={isCurrentWeek}`, i.e. you can
 *   never page past the current week.
 */
data class WeekSelectorDisplay(
    val weekLabel: String,
    val showCurrentBadge: Boolean,
    val nextEnabled: Boolean,
)

/**
 * Pure projection from the surface's inputs to its render-ready [WeekSelectorDisplay] — a 1:1 port of the
 * two decisions the web component makes: the `isCurrentWeek && <Badge>` badge gate and the
 * `disabled={isCurrentWeek}` Next-button guard. Side-effect-free, so it is fully covered by the off-device
 * unit gate.
 */
object WeekSelectorProjection {
    /**
     * Select the render-ready view for the given inputs. [weekLabel] is rendered verbatim (web renders the
     * already-formatted `${start} – ${end}` range); a blank value folds to an em dash so the center slot is
     * never empty. [isCurrentWeek] both shows the "Current" badge and disables Next, matching the web source.
     */
    fun project(
        weekLabel: String,
        isCurrentWeek: Boolean,
    ): WeekSelectorDisplay =
        WeekSelectorDisplay(
            weekLabel = weekLabel.ifBlank { EM_DASH },
            showCurrentBadge = isCurrentWeek,
            nextEnabled = !isCurrentWeek,
        )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the week
 * label, which can encode the fleet's activity window — so a diagnostics line can never leak which week an
 * operator was inspecting.
 */
object WeekSelectorDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "WeekSelector"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
