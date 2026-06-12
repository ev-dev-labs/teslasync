// Pure, framework-free model for the StatusPageSkeleton feature view — the native analogue of the
// composition that web/src/features/system/components/status/StatusPageSkeleton.tsx returns. No
// Compose, no Android, no HTTP: every type here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web source is a PURELY PRESENTATIONAL loading scaffold: it binds no data hook, reads no i18n
// catalog, and has a single, unconditional render path. It returns a `space-y-5 max-w-3xl mx-auto`
// stack of shimmering bars shaped like the System Status page it stands in for — a hero, a chip bar,
// a six-row health panel, an action-items panel, a resources panel, and four collapsed accordion
// rows — so there is no layout shift once the real page mounts. Because the surface has ZERO data
// sources there is no loading / empty / error / stale / offline lifecycle to derive here: modelling
// those would invent behaviour the web source does not have (a drift violation per the honesty
// covenant). The surface IS the loading affordance, so its single state is projected verbatim from
// the web JSX into the [STATUS_PAGE_SKELETON_SPEC] region descriptors below, and the only behaviour
// it owns is the accessibility announcement spoken while the scaffold is on screen.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/StatusPageSkeleton — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling LoadingSkeleton surface
// does. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statuspageskeleton

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object StatusPageSkeletonRegistration {
    /** Stable surface id. */
    const val ID: String = "status-page-skeleton"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StatusPageSkeleton"
}

/**
 * i18n catalog key (P1/S10) for the single string this surface needs — the accessibility
 * announcement spoken while the loading scaffold is on screen. The web source renders no text and its
 * `aria-label="Loading system status"` is a hard-coded literal, but a native loading region must
 * still expose a localized TalkBack label, so this maps to the catalog's generic loading
 * announcement (`R.string.translation_a11y_loading`) — the same key the sibling LoadingSkeleton
 * surface binds. A status-specific catalog entry is out of this artifact's allowed-files scope.
 */
const val A11Y_LOADING_KEY: String = "a11y.loading"

/**
 * Maximum content width (dp) for the centered column — the native expression of the web
 * `max-w-3xl mx-auto` (Tailwind `3xl` = 48rem = 768 px). Widths above this letterbox the column with
 * equal side margins; narrower windows fill the available width.
 */
const val MAX_CONTENT_WIDTH_DP: Int = 768

/**
 * A vertical/inset spacing step, named to map 1:1 onto the generated [Spacing] token scale (the web
 * Tailwind `space-y-*` / `gap-*` / `p-*` steps converted to the design-token grid). Kept framework-free
 * here so the projection is unit-testable; the renderer resolves each step to its `Spacing` dp value.
 */
enum class SkeletonGap { None, Xs, Sm, Md, Lg, Xl, Xl2 }

/**
 * One shimmering loading bar: [heightDp] tall. Its width is, in priority order, a fixed [widthDp] dp
 * (the web `width="56px"` / `w-*` bars), else a [widthFraction] of the parent in `0f..1f` (the web
 * percentage widths `width="60%"`), else — when both are `null` — the full parent width (the web
 * `w-full` rows). [rounded] selects the pill shape for the web `rounded` / `rounded-full` bars. Pixel
 * dimensions are the web values converted 1:1 to dp.
 */
data class SkeletonBar(
    val heightDp: Int,
    val widthDp: Int? = null,
    val widthFraction: Float? = null,
    val rounded: Boolean = false,
)

/**
 * The hero region — web `GlassPanel p-5` holding a `flex items-start gap-4` row of a rounded
 * [avatar] bar, a `flex-1 space-y-2` stack of the [title] over the [subtitle], and a trailing
 * [action] bar.
 */
data class HeroSpec(
    val avatar: SkeletonBar,
    val title: SkeletonBar,
    val subtitle: SkeletonBar,
    val action: SkeletonBar,
)

/** The chip bar — web `flex gap-2 overflow-hidden` row of [count] identical fixed-width [chip] pills. */
data class ChipBarSpec(
    val count: Int,
    val chip: SkeletonBar,
)

/**
 * A labelled list panel — a `GlassPanel` with a fixed-width [header] bar over [rowCount] full-width
 * [row] bars. [headerGap] is the space between the header and the first row, [rowGap] the space
 * between rows (the web `space-y-*`), and [padding] the panel inset (the web `p-*`).
 */
data class ListPanelSpec(
    val header: SkeletonBar,
    val headerGap: SkeletonGap,
    val rowCount: Int,
    val row: SkeletonBar,
    val rowGap: SkeletonGap,
    val padding: SkeletonGap,
)

/**
 * One collapsed accordion row — web `GlassPanel p-5` with a `flex items-center gap-3` row of an
 * [icon] bar, a `flex-1` stack of the [title] over the [subtitle] (web `mt-1`), and a trailing
 * [badge] bar.
 */
data class AccordionRowSpec(
    val icon: SkeletonBar,
    val title: SkeletonBar,
    val subtitle: SkeletonBar,
    val badge: SkeletonBar,
)

/**
 * The full composition projected from the web source. The region order mirrors the JSX top-to-bottom
 * so the native column reads identically to the web `space-y-5` stack: hero, chip bar, the three
 * list panels, then [accordionCount] identical accordion rows.
 */
data class StatusSkeletonSpec(
    val hero: HeroSpec,
    val chips: ChipBarSpec,
    val health: ListPanelSpec,
    val actionItems: ListPanelSpec,
    val resources: ListPanelSpec,
    val accordion: AccordionRowSpec,
    val accordionCount: Int,
)

/**
 * Exact projection of `features/system/components/status/StatusPageSkeleton.tsx`:
 *  - hero: `GlassPanel p-5` — `56×56 rounded` avatar, `h-24 w-60%` title over `h-14 w-40%` subtitle
 *    (`space-y-2`), and a `120×36` action bar (`flex items-start gap-4`)
 *  - chips: eight `92×32 rounded-full` pills (`flex gap-2 overflow-hidden`)
 *  - health: `GlassPanel p-3 space-y-1` — `h-18 w-80px` header (`mb-2`) over six `h-44 w-full` rows
 *  - actionItems: `GlassPanel p-4 space-y-2` — `h-18 w-180px` header over two `h-32 w-full` rows
 *  - resources: `GlassPanel p-4 space-y-3` — `h-18 w-120px` header over five `h-28 w-full` rows
 *  - accordions: four `GlassPanel p-5` rows — `20×20` icon, `h-16 w-40%` title over `h-12 w-60%`
 *    subtitle (`mt-1`), and a `60×24` badge (`flex items-center gap-3`)
 *
 * The web `space-y-1` health panel additionally carries `mb-2` on its header; that 8 dp bottom
 * margin collapses with the 4 dp `space-y-1` to an 8 dp header gap, so [ListPanelSpec.headerGap]
 * is [SkeletonGap.Sm] there while the inter-row gap stays [SkeletonGap.Xs].
 */
val STATUS_PAGE_SKELETON_SPEC: StatusSkeletonSpec =
    StatusSkeletonSpec(
        hero =
            HeroSpec(
                avatar = SkeletonBar(heightDp = 56, widthDp = 56, rounded = true),
                title = SkeletonBar(heightDp = 24, widthFraction = 0.6f),
                subtitle = SkeletonBar(heightDp = 14, widthFraction = 0.4f),
                action = SkeletonBar(heightDp = 36, widthDp = 120),
            ),
        chips =
            ChipBarSpec(
                count = 8,
                chip = SkeletonBar(heightDp = 32, widthDp = 92, rounded = true),
            ),
        health =
            ListPanelSpec(
                header = SkeletonBar(heightDp = 18, widthDp = 80),
                headerGap = SkeletonGap.Sm,
                rowCount = 6,
                row = SkeletonBar(heightDp = 44),
                rowGap = SkeletonGap.Xs,
                padding = SkeletonGap.Md,
            ),
        actionItems =
            ListPanelSpec(
                header = SkeletonBar(heightDp = 18, widthDp = 180),
                headerGap = SkeletonGap.Sm,
                rowCount = 2,
                row = SkeletonBar(heightDp = 32),
                rowGap = SkeletonGap.Sm,
                padding = SkeletonGap.Lg,
            ),
        resources =
            ListPanelSpec(
                header = SkeletonBar(heightDp = 18, widthDp = 120),
                headerGap = SkeletonGap.Md,
                rowCount = 5,
                row = SkeletonBar(heightDp = 28),
                rowGap = SkeletonGap.Md,
                padding = SkeletonGap.Lg,
            ),
        accordion =
            AccordionRowSpec(
                icon = SkeletonBar(heightDp = 20, widthDp = 20),
                title = SkeletonBar(heightDp = 16, widthFraction = 0.4f),
                subtitle = SkeletonBar(heightDp = 12, widthFraction = 0.6f),
                badge = SkeletonBar(heightDp = 24, widthDp = 60),
            ),
        accordionCount = 4,
    )

/** Pure derivations the composable reads — unit-tested off-device. */
object StatusPageSkeletonProjection {
    /** The web composition — the surface's single, unconditional render. */
    val webParity: StatusSkeletonSpec = STATUS_PAGE_SKELETON_SPEC

    /**
     * Resolves the accessibility announcement for the loading scaffold through the supplied i18n
     * [translate] resolver (the P1/S10 facade), reading [A11Y_LOADING_KEY]. Kept pure so the a11y
     * label is verifiable without Compose.
     */
    fun accessibilityLabel(translate: (String) -> String): String = translate(A11Y_LOADING_KEY)
}
