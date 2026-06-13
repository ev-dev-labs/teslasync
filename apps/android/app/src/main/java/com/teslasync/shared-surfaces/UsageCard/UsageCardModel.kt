// Pure, framework-free model + projection + diagnostics for the UsageCard shared surface — the native
// analogue of web/src/components/data-display/UsageCard.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over this pure decision (the accepted sibling-surface contract, e.g.
// MetricCard / Delta / AnimatedNumber).
//
// What the web source actually is (and therefore the COMPLETE branch set this surface reproduces): the
// web `UsageCard` is a PURELY PRESENTATIONAL "spend / volume" card — "no hooks, no API calls, no derived
// state. Every dynamic value comes in via props". Two consumers share it (TeslaApiUsageCard, AiUsageCard);
// the card itself only decides ONE thing before its returned JSX — the web `hasAnything`: whether any of
// the optional regions (budget bar, at-a-glance bands, key/value detail grid, top-list breakdowns, callout
// banner, footer links) is present. When nothing is present it paints the empty fallback
// (`emptyMessage ?? 'No data to display yet.'`); otherwise it paints the supplied regions in order. Those
// are the card's real, fully-reproduced branches:
//   * the EMPTY fallback (web `!hasAnything`) — never a blank box;
//   * the optional budget progress bar (web `budget` — hidden entirely when absent);
//   * the optional 3-up bands row (web `bands`);
//   * the optional key/value detail grid (web `details`);
//   * the optional top-list breakdown blocks (web `topLists`);
//   * the optional callout banner (web `banner`);
//   * the optional footer link row (web `footer`).
// [UsageCardProjection.project] reproduces the web `hasAnything` boolean verbatim (budget OR any band OR
// any detail OR any top-list OR banner OR any footer link), so the composable can never collapse to a
// blank region: a populated card paints its regions, an unpopulated one paints the localized empty state.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: the
// web `UsageCard` fetches nothing — it is handed finished, already-derived values by its consumers — so it
// never loads, errors, goes stale, or goes offline. Modelling those would fabricate behaviour the web spec
// does not have (Honesty Covenant: no scope narrowing, no silent drift), exactly as the accepted
// VisuallyHidden / AnimatedNumber / Delta / MetricCard presentational ports document. The lifecycle of the
// numbers the card shows belongs to the consuming feature views (each its own prompt), which bind the
// shared P1/S8 state holders and hand this surface a finished projection.
//
// The card renders no static copy of its own — every headline, label, value, caption, title, and banner
// line is caller-supplied (already localized by the consumer) — so the only string the surface itself owns
// is the DEFAULT empty fallback (web `'No data to display yet.'`), resolved at the render boundary from the
// shared P1/S10 catalog (`translation_common_noData`); no English literal lives in native code.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/UsageCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usagecard

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the UsageCard surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`UsageCard`).
 */
object UsageCardRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "usage-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "UsageCard"
}

/**
 * The presence of each optional region a UsageCard can show — the pure inputs to the web `hasAnything`
 * decision. Flags / counts only (never the framework-typed region data: no `ImageVector`, no `onClick`), so
 * the decision stays off-device testable. The composable builds this from the supplied budget / bands /
 * details / top-lists / banner / footer.
 */
data class UsageCardRegions(
    val hasBudget: Boolean = false,
    val bandCount: Int = 0,
    val detailCount: Int = 0,
    val topListCount: Int = 0,
    val hasBanner: Boolean = false,
    val footerCount: Int = 0,
)

/**
 * The projected render decision a [io.teslasync.android.sharedsurfaces.usagecard.UsageCard] paints — the
 * pure mirror of the web `UsageCard`'s only pre-JSX computation, `hasAnything`. [hasContent] is `true` when
 * any optional region is supplied, so the composable paints those regions; `false` when none is, so it
 * paints the localized empty fallback (never a blank box). Framework-free, so the whole contract is covered
 * by the off-device unit gate.
 */
data class UsageCardProjection(
    val hasContent: Boolean,
) {
    companion object {
        /**
         * Reproduces the web `hasAnything` exactly: content exists when the budget bar is present, OR any
         * band / detail / top-list is supplied, OR the banner is present, OR any footer link is supplied.
         */
        fun project(regions: UsageCardRegions): UsageCardProjection =
            UsageCardProjection(
                hasContent =
                    regions.hasBudget ||
                        regions.bandCount > 0 ||
                        regions.detailCount > 0 ||
                        regions.topListCount > 0 ||
                        regions.hasBanner ||
                        regions.footerCount > 0,
            )
    }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [UsageCardRegistration.SLUG] — never a headline, value, caption, or banner line,
 * so a diagnostics record can never leak what the card displays. Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the composable calls it once per surface open.
 */
object UsageCardDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to UsageCardRegistration.SLUG))
    }
}
