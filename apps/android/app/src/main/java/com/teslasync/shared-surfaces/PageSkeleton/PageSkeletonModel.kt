// Pure, framework-free model + projection + diagnostics for the PageSkeleton shared surface — the native
// analogue of web/src/components/feedback/PageSkeleton.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web source is a SHAPED LOADING PRIMITIVE, not a data-fetching view. It imports only the `<Skeleton>`
// primitive and the `cn` class helper — no hook, no context, no fetch — and exports four building blocks
// (`PageHeaderSkeleton`, `StatGridSkeleton`, `ChartBlockSkeleton`, `TableSkeleton`) whose only job is to
// claim the same vertical/horizontal space the real content will, so Cumulative Layout Shift stays near
// zero. Each block is announced as `role="status" aria-busy="true"` with a fixed aria-label and carries a
// stable `data-testid`. The blocks accept layout configuration only — `cards` (default 4), `height`
// (default 320), `rows` (default 8), `cols` (default 4).
//
// Because the surface is the loading-state vocabulary ITSELF (not an async cache-then-network feed), it has
// no loading / empty / error / stale / offline lifecycle to project — modelling those would fabricate
// behaviour the web spec does not have (the same rationale the accepted VisuallyHidden / globalShortcuts /
// QuickNav ports document). The surface's real, reproduced states are the four region shapes, their
// configuration, and the reduced-motion variant (the native translation of the web `animate-pulse` being
// disabled under `prefers-reduced-motion`). For the same reason there is deliberately NO
// `PageSkeletonSource.kt`: the web component has no data or seam dependency to abstract, so a "source" seam
// would be a stub the Honesty Covenant forbids. The single dependency the surface DOES have — the
// diagnostics [io.teslasync.shared.core.diagnostics.Logger] (P1/S11) — flows through
// [PageSkeletonViewModel], so the view stays a thin renderer (ADR-002).
//
// This projection is the pure "data adapter" the composable renders: it normalises the four raw layout
// parameters into safe, render-ready specs (web defaults preserved; pathological inputs clamped so a native
// `repeat(n)` can never be handed a negative count the way the web `Array.from({ length: cards })` would
// throw). The web source renders no copy of its own beyond four anonymous English aria-labels, so the
// surface maps those to the single existing catalog key `a11y.loading` ("Loading", the Range precedent)
// rather than inventing four new keys; the per-block distinction the shared label collapses is preserved
// structurally via [PageSkeletonRegion.testTag] (= the web `data-testid`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/PageSkeleton — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageskeleton

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the PageSkeleton surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`PageSkeleton`).
 */
object PageSkeletonRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "page-skeleton"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PageSkeleton"
}

/**
 * The four shaped loading regions the web source exports, each carrying the stable [testTag] that mirrors
 * the web `data-testid`. The shared accessible label ([PageSkeletonRegistration]) collapses the web's four
 * anonymous aria-labels onto the single catalog `a11y.loading` key; this enum preserves the per-region
 * distinction so a screen reader's region order and the UI tests both stay precise.
 */
enum class PageSkeletonRegion(
    val testTag: String,
) {
    /** Web `PageHeaderSkeleton` — title + subtitle row (`data-testid="page-header-skeleton"`). */
    Header("page-header-skeleton"),

    /** Web `StatGridSkeleton` — 2/4-column stat-card grid (`data-testid="stat-grid-skeleton"`). */
    StatGrid("stat-grid-skeleton"),

    /** Web `ChartBlockSkeleton` — single chart-sized box (`data-testid="chart-block-skeleton"`). */
    Chart("chart-block-skeleton"),

    /** Web `TableSkeleton` — header row + body grid (`data-testid="table-skeleton"`). */
    Table("table-skeleton"),
}

/**
 * Normalised stat-grid layout the [StatGridSkeleton] draws — the web `StatGridSkeleton({ cards })` shape
 * after clamping. [cards] is guaranteed in `[MIN_BLOCK_COUNT, MAX_STAT_CARDS]`.
 */
data class StatGridSpec(
    val cards: Int,
)

/**
 * Normalised table layout the [TableSkeleton] draws — the web `TableSkeleton({ rows, cols })` shape after
 * clamping. [rows] is in `[MIN_BLOCK_COUNT, MAX_TABLE_ROWS]`, [cols] in `[MIN_BLOCK_COUNT, MAX_TABLE_COLS]`.
 */
data class TableSpec(
    val rows: Int,
    val cols: Int,
)

// ── Web defaults (THE spec) ───────────────────────────────────────────────────────────────────────────

/** Web `StatGridSkeleton` default `cards = 4`. */
const val DEFAULT_STAT_CARDS: Int = 4

/** Web `ChartBlockSkeleton` default `height = 320` (pixels → dp). */
const val DEFAULT_CHART_HEIGHT_DP: Int = 320

/** Web `TableSkeleton` default `rows = 8`. */
const val DEFAULT_TABLE_ROWS: Int = 8

/** Web `TableSkeleton` default `cols = 4`. */
const val DEFAULT_TABLE_COLS: Int = 4

// ── Safe bounds (native guard the web `Array.from({ length })` lacks) ─────────────────────────────────

/** Every repeated region needs at least one cell so a native `repeat(n)` is never handed a non-positive n. */
const val MIN_BLOCK_COUNT: Int = 1

/** Upper bound on stat cards — a skeleton never needs more, and it caps a pathological caller value. */
const val MAX_STAT_CARDS: Int = 12

/** Upper bound on table body rows. */
const val MAX_TABLE_ROWS: Int = 50

/** Upper bound on table columns. */
const val MAX_TABLE_COLS: Int = 12

/** Floor for the chart skeleton box height (dp) — keeps the box visible even if a caller passes 0. */
const val MIN_CHART_HEIGHT_DP: Int = 48

/** Ceiling for the chart skeleton box height (dp) — caps a runaway caller value. */
const val MAX_CHART_HEIGHT_DP: Int = 1200

/**
 * Pure normalisation for the four web layout parameters — the surface's "data adapter". Each function maps
 * a raw caller value onto a safe, render-ready value: the web defaults are applied by the composable's
 * parameter defaults, and these clamps guarantee the repeated regions and the chart box always render
 * (never a crash on a negative `repeat`, never a zero-height box). Pure, so it is fully covered by the
 * off-device projection test.
 */
object PageSkeletonProjection {
    /** Clamps the stat-card count into `[MIN_BLOCK_COUNT, MAX_STAT_CARDS]` (web default [DEFAULT_STAT_CARDS]). */
    fun statCards(raw: Int): Int = raw.coerceIn(MIN_BLOCK_COUNT, MAX_STAT_CARDS)

    /** Clamps the chart height (dp) into `[MIN_CHART_HEIGHT_DP, MAX_CHART_HEIGHT_DP]` (web default [DEFAULT_CHART_HEIGHT_DP]). */
    fun chartHeightDp(raw: Int): Int = raw.coerceIn(MIN_CHART_HEIGHT_DP, MAX_CHART_HEIGHT_DP)

    /** Clamps the table row count into `[MIN_BLOCK_COUNT, MAX_TABLE_ROWS]` (web default [DEFAULT_TABLE_ROWS]). */
    fun tableRows(raw: Int): Int = raw.coerceIn(MIN_BLOCK_COUNT, MAX_TABLE_ROWS)

    /** Clamps the table column count into `[MIN_BLOCK_COUNT, MAX_TABLE_COLS]` (web default [DEFAULT_TABLE_COLS]). */
    fun tableCols(raw: Int): Int = raw.coerceIn(MIN_BLOCK_COUNT, MAX_TABLE_COLS)

    /** Builds the clamped [StatGridSpec] from a raw card count. */
    fun statGridSpec(rawCards: Int): StatGridSpec = StatGridSpec(statCards(rawCards))

    /** Builds the clamped [TableSpec] from raw row/column counts. */
    fun tableSpec(
        rawRows: Int,
        rawCols: Int,
    ): TableSpec = TableSpec(tableRows(rawRows), tableCols(rawCols))
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [PageSkeletonRegistration.SLUG]
 * (P1/S11) — never any caller value, route, VIN, or vehicle id. Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordPageSkeletonOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to PageSkeletonRegistration.SLUG))
}
