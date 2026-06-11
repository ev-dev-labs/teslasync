// Pure, framework-free model + projection for the Recent Drives dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/RecentDrivesWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin
// render layer. Each drive arrives as the generated SI DTO [Drive]; this file owns the display-boundary
// distance conversion (Phase-48 SI-canonical rule; web `useUnits` + `convertDistanceFromSI`) and the
// per-row string assembly. The absolute short-date rendering is delegated to an injected formatter
// ([RecentDrivesStrings.formatStartDate]) built at the Compose boundary so the projection stays
// locale/zone-stable and deterministic in tests (the web `useDateFormat().formatDateShort`).
//
// SoC parity note: the web `Drive` type (web/src/features/dashboard/types.ts) reads `start_soc_pct` /
// `end_soc_pct`, but the live API (internal/models/drive/drive.go) and the generated OpenAPI DTO both
// carry the same start/end state-of-charge as `start_battery_pct` / `end_battery_pct`. We read the
// canonical generated fields ([Drive.startBatteryPct] / [Drive.endBatteryPct]) so the percentage actually
// renders rather than silently resolving to the web type's stale (absent) keys.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/RecentDrivesWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentdrives

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.util.Locale

/** Unknown-percentage fallback marker (web `?? '?'`); a symbol, not localized microcopy. */
private const val UNKNOWN_PCT = "?"

/** Percent suffix appended to each SoC value (web `…%`). */
private const val PERCENT = "%"

/** Middle dot separating the duration from the SoC delta (web `·`). */
private const val MIDDLE_DOT = "\u00B7"

/** Right arrow between the start and end SoC (web `→`). */
private const val ARROW = "\u2192"

/** Single space joiner. */
private const val SPACE = " "

/** TalkBack phrase separator folding the row's three lines into one announcement. */
private const val COMMA_SPACE = ", "

/** 60 seconds per minute — the web `duration_s / 60` minute projection. */
private const val SECONDS_PER_MINUTE = 60.0

/** Distance precision (web `fmtNumber(distance, 1)`). */
private const val DISTANCE_DECIMALS = 1

/** Duration precision (web `fmtInt(minutes)` ⇒ whole minutes). */
private const val MINUTE_DECIMALS = 0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * Recent Drives source renders the same scrolling drive list at every footprint (no compact/wide branch),
 * so this type carries the footprint only for the dashboard grid contract; the loading skeleton uses
 * [rows] to size its shimmer-bar count.
 */
data class RecentDrivesSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`recent-drives`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object RecentDrivesRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "recent-drives"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "RecentDrivesWidget"

    /** Most-recent drives rendered, matching the web query's `&limit=5`. */
    const val DEFAULT_LIMIT = 5

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = RecentDrivesSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 2 rows (web `minSize`). */
    val minSize = RecentDrivesSize(cols = 2, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = RecentDrivesSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: RecentDrivesSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: RecentDrivesSize): RecentDrivesSize =
        RecentDrivesSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One projected, render-ready drive row — the native analogue of the per-`drive` JSX block the web maps.
 * Pure data (no Compose types): the [primaryText] distance line (`"12.3 km"`), the [subtitleText] duration
 * + SoC delta line (`"20 min · 80% → 65%"`), the [dateLabel] short date, the [id] used both as the list
 * key and the navigation target (web `Link to="/drives/{id}"`), and a TalkBack [contentDescription] folding
 * all three lines into one phrase.
 */
data class RecentDriveRow(
    val id: Long,
    val primaryText: String,
    val subtitleText: String,
    val dateLabel: String,
    val contentDescription: String,
)

/**
 * Localized labels + the short-date formatter the surface folds into its output. The pure
 * [RecentDrivesProjection] reads [noDrives] / [minutesLabel] / [formatStartDate]; the composable chrome
 * additionally reads [title] / [viewAll] / [refreshLabel]. The composable builds this from `stringResource`
 * plus a locale/zone-aware `MMM d` formatter (web `formatDateShort`); tests pass a deterministic instance.
 * [minutesLabel] is the duration unit symbol (web's literal ` min`), supplied as `DurationUnitPref.MINUTES`
 * so no English word is hard-coded.
 */
data class RecentDrivesStrings(
    val title: String,
    val viewAll: String,
    val noDrives: String,
    val refreshLabel: String,
    val minutesLabel: String,
    val formatStartDate: (Long) -> String,
)

/**
 * The fully projected, render-ready view of the recent drives — the native analogue of the `items` the web
 * component maps before returning JSX. Pure data so the projection is unit-tested without a UI host.
 * [hasItems] drives the web `items.length > 0 ? list : <EmptyState />` gate.
 */
data class RecentDrivesDisplay(
    val hasItems: Boolean,
    val items: List<RecentDriveRow>,
    val emptyMessage: String,
)

/**
 * Pure projection from a decoded list of [Drive] to the render-ready [RecentDrivesDisplay] — the native
 * port of the web component's render body. The shared [io.teslasync.shared.core.presentation.driving.DrivingStore.drives]
 * feed has no `limit` parameter (unlike the web query's `&limit=5`), so the projection reproduces the web
 * "Last 5 drives" by sorting newest-first on `start_ts` and taking [RecentDrivesRegistration.DEFAULT_LIMIT].
 * SI metres are converted to the user's distance unit at this display boundary (web `convertDistanceFromSI`);
 * numbers are formatted via the shared [ChartFormat] (web `fmtNumber` / `fmtInt`). [locale] drives the
 * grouping/separators (tests pin [Locale.US]).
 */
object RecentDrivesProjection {
    /** Project [drives] using the user's display [prefs] (distance unit), the localized [strings], and [locale]. */
    fun project(
        drives: List<Drive>,
        prefs: UnitPref,
        strings: RecentDrivesStrings,
        locale: Locale = Locale.US,
    ): RecentDrivesDisplay {
        val rows =
            drives
                .sortedByDescending { it.startTs }
                .take(RecentDrivesRegistration.DEFAULT_LIMIT)
                .map { it.toRow(prefs, strings, locale) }
        return RecentDrivesDisplay(
            hasItems = rows.isNotEmpty(),
            items = rows,
            emptyMessage = strings.noDrives,
        )
    }

    private fun Drive.toRow(
        prefs: UnitPref,
        strings: RecentDrivesStrings,
        locale: Locale,
    ): RecentDriveRow {
        val distanceText = ChartFormat.number(convertDistanceFromSI(distanceM, prefs.distance), DISTANCE_DECIMALS, locale)
        val primary = "$distanceText$SPACE${prefs.distance.label}"
        val minutes = ChartFormat.number(durationS / SECONDS_PER_MINUTE, MINUTE_DECIMALS, locale)
        val startPct = startBatteryPct?.toString() ?: UNKNOWN_PCT
        val endPct = endBatteryPct?.toString() ?: UNKNOWN_PCT
        val subtitle =
            "$minutes$SPACE${strings.minutesLabel}$SPACE$MIDDLE_DOT$SPACE$startPct$PERCENT$SPACE$ARROW$SPACE$endPct$PERCENT"
        val date = strings.formatStartDate(startTs.toEpochMilliseconds())
        return RecentDriveRow(
            id = id,
            primaryText = primary,
            subtitleText = subtitle,
            dateLabel = date,
            contentDescription = "$primary$COMMA_SPACE$subtitle$COMMA_SPACE$date",
        )
    }
}
