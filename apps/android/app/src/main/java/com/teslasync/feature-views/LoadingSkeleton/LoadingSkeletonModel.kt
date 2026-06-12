// Pure, framework-free model for the LoadingSkeleton feature view — the native analogue of the
// composition that web/src/features/charging/components/charging-curve/LoadingSkeleton.tsx returns.
// No Compose, no Android, no HTTP: every type here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web source is a PURELY PRESENTATIONAL loading scaffold: it binds no data hook, reads no i18n
// catalog, and has a single, unconditional render path (a `space-y-6` stack of shimmering bars laid
// out like the charging-curve page it stands in for — a header, a filter row, a six-tile stat grid,
// two chart panels, a two-up panel row, and a four-tile stat grid). Because the surface has zero
// data sources there is no loading / empty / error / stale / offline lifecycle to derive here:
// modelling those would invent behaviour the web source does not have (a drift violation). The
// surface IS the loading affordance, so its single state is projected verbatim from the web JSX into
// the [LOADING_SKELETON_SPEC] region descriptors below, and the only logic it owns is the responsive
// column count for its grids (the web `grid-cols-*` breakpoints) plus the accessibility announcement.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LoadingSkeleton — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling ToolCard surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.loadingskeleton

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object LoadingSkeletonRegistration {
    /** Stable surface id. */
    const val ID: String = "loading-skeleton"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LoadingSkeleton"
}

/**
 * i18n catalog key (P1/S10) for the single string this surface needs — the accessibility
 * announcement spoken when the loading scaffold is on screen. The web source renders no text, but a
 * native loading region must still expose a TalkBack label; this maps to the Android resource
 * `R.string.translation_a11y_loading`.
 */
const val A11Y_LOADING_KEY: String = "a11y.loading"

/**
 * Window-width breakpoint (dp): the lower bound of the medium window-size class. Widths below this
 * are compact. Used to fold the web responsive grids onto the Material window-size classes — the
 * same breakpoints the sibling card-grid surfaces use.
 */
const val MEDIUM_MIN_WIDTH_DP: Float = 600f

/** Window-width breakpoint (dp): the lower bound of the expanded window-size class. */
const val EXPANDED_MIN_WIDTH_DP: Float = 840f

/**
 * Responsive column counts for one grid region across the three width classes — the native
 * expression of a web `grid-cols-{compact} md:grid-cols-{medium} lg:grid-cols-{expanded}` triple.
 */
data class GridColumns(
    val compact: Int,
    val medium: Int,
    val expanded: Int,
)

/**
 * One shimmering loading bar: [heightDp] tall and either [widthDp] dp wide or — when [widthDp] is
 * `null` — filling its parent's width (the web `w-full` block bars). Dimensions are the web Tailwind
 * `h-*` / `w-*` sizes converted 1:1 to dp (Tailwind `h-8` = 32 px ⇒ 32 dp).
 */
data class SkeletonBar(
    val heightDp: Int,
    val widthDp: Int? = null,
)

/** A stat tile's two stacked bars — web `<Skeleton h-3 .../>` above `<Skeleton mt-2 h-7 .../>`. */
data class SkeletonStatTile(
    val label: SkeletonBar,
    val value: SkeletonBar,
)

/** A stat-grid region: [count] identical [tile]s laid out across [columns] responsive columns. */
data class SkeletonStatGridSpec(
    val count: Int,
    val tile: SkeletonStatTile,
    val columns: GridColumns,
)

/** A chart panel: a [title] bar above a full-width block of [blockHeightDp] dp — web `GlassPanel p-6`. */
data class SkeletonChartPanelSpec(
    val title: SkeletonBar,
    val blockHeightDp: Int,
)

/** A split region: [count] identical [panel]s laid out across [columns] responsive columns. */
data class SkeletonSplitSpec(
    val count: Int,
    val panel: SkeletonChartPanelSpec,
    val columns: GridColumns,
)

/**
 * The full composition projected from the web source. The region order mirrors the JSX top-to-bottom
 * so the native column reads identically to the web `space-y-6` stack.
 */
data class LoadingSkeletonSpec(
    val header: List<SkeletonBar>,
    val filters: List<SkeletonBar>,
    val topStats: SkeletonStatGridSpec,
    val chartPanels: List<SkeletonChartPanelSpec>,
    val splitPanels: SkeletonSplitSpec,
    val bottomStats: SkeletonStatGridSpec,
)

/**
 * Exact projection of `features/charging/components/charging-curve/LoadingSkeleton.tsx`:
 *  - header: `Skeleton h-8 w-48` over `Skeleton h-4 w-72`
 *  - filters: `Skeleton h-10 w-48` and `Skeleton h-10 w-64`
 *  - topStats: six `GlassPanel p-4` tiles (`h-3 w-16` label, `h-7 w-20` value), `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`
 *  - chartPanels: `GlassPanel p-6` with `h-5 w-40` title over `h-64` block, then `h-5 w-56` title over `h-52` block
 *  - splitPanels: two `GlassPanel p-6` (`h-5 w-44` title over `h-48` block), `grid-cols-1 lg:grid-cols-2`
 *  - bottomStats: four `GlassPanel p-4` tiles (`h-3 w-20` label, `h-7 w-16` value), `grid-cols-2 lg:grid-cols-4`
 */
val LOADING_SKELETON_SPEC: LoadingSkeletonSpec =
    LoadingSkeletonSpec(
        header =
            listOf(
                SkeletonBar(heightDp = 32, widthDp = 192),
                SkeletonBar(heightDp = 16, widthDp = 288),
            ),
        filters =
            listOf(
                SkeletonBar(heightDp = 40, widthDp = 192),
                SkeletonBar(heightDp = 40, widthDp = 256),
            ),
        topStats =
            SkeletonStatGridSpec(
                count = 6,
                tile =
                    SkeletonStatTile(
                        label = SkeletonBar(heightDp = 12, widthDp = 64),
                        value = SkeletonBar(heightDp = 28, widthDp = 80),
                    ),
                columns = GridColumns(compact = 2, medium = 3, expanded = 6),
            ),
        chartPanels =
            listOf(
                SkeletonChartPanelSpec(title = SkeletonBar(heightDp = 20, widthDp = 160), blockHeightDp = 256),
                SkeletonChartPanelSpec(title = SkeletonBar(heightDp = 20, widthDp = 224), blockHeightDp = 208),
            ),
        splitPanels =
            SkeletonSplitSpec(
                count = 2,
                panel = SkeletonChartPanelSpec(title = SkeletonBar(heightDp = 20, widthDp = 176), blockHeightDp = 192),
                columns = GridColumns(compact = 1, medium = 2, expanded = 2),
            ),
        bottomStats =
            SkeletonStatGridSpec(
                count = 4,
                tile =
                    SkeletonStatTile(
                        label = SkeletonBar(heightDp = 12, widthDp = 80),
                        value = SkeletonBar(heightDp = 28, widthDp = 64),
                    ),
                columns = GridColumns(compact = 2, medium = 4, expanded = 4),
            ),
    )

/** Pure derivations the composable switches on — unit-tested off-device. */
object LoadingSkeletonProjection {
    /** The web-parity composition rendered by the surface. */
    val webParity: LoadingSkeletonSpec = LOADING_SKELETON_SPEC

    /**
     * Folds an available width (dp) onto a [columns] region's column count, reproducing the web
     * `grid-cols-*` responsive breakpoints: compact width → [GridColumns.compact], medium →
     * [GridColumns.medium], expanded → [GridColumns.expanded]. The lower bound of a class is
     * inclusive (exactly [MEDIUM_MIN_WIDTH_DP] is already medium).
     */
    fun columnsFor(
        widthDp: Float,
        columns: GridColumns,
    ): Int =
        when {
            widthDp < MEDIUM_MIN_WIDTH_DP -> columns.compact
            widthDp < EXPANDED_MIN_WIDTH_DP -> columns.medium
            else -> columns.expanded
        }

    /**
     * Resolves the accessibility announcement for the loading scaffold through the supplied i18n
     * [translate] resolver (the P1/S10 facade), reading [A11Y_LOADING_KEY]. Kept pure so the a11y
     * label is verifiable without Compose.
     */
    fun accessibilityLabel(translate: (String) -> String): String = translate(A11Y_LOADING_KEY)
}
