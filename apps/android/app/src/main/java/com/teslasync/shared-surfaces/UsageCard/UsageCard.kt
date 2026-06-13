// The native Jetpack Compose + Material 3 UsageCard shared surface — a parity port of the web shared
// "spend / volume" primitive web/src/components/data-display/UsageCard.tsx.
//
// [UsageCard] is the stateful entry: it records the one-shot `view.opened` diagnostic (P1/S11) and paints
// the result through the stateless [UsageCardContent] (the test / preview entry point). The faithful
// reproduction of the web layout is delegated to the SHIPPED atomic
// [io.teslasync.android.components.datadisplay.UsageCard] (the P3 component-library bundle's port of the
// SAME web file) — the DRY win: the atomic already maps each web region onto the shared component library
// and the generated theme tokens (the budget bar → a semantic progressbar with the web `ariaLabel`; the
// bands / detail grid / top-lists → the [io.teslasync.android.components.ui] primitives; the banner →
// an accented callout; the footer → shared [io.teslasync.android.components.ui.Button]s; intents →
// `TeslaTokens.status.*`, never a raw hex). This surface adds only what a "surface" owns over an atomic:
// the PII-safe diagnostic, the registry slug, the pure web-`hasAnything` decision
// ([UsageCardProjection]), and the localized DEFAULT empty fallback so the card is NEVER a blank box even
// when a caller hands it nothing. It performs NO HTTP — every value is caller-supplied (the consuming
// feature views bind the P1/S8 state holders and hand this surface a finished projection).
//
// The web region model is reused verbatim from the atomic ([UsageBudget] / [UsageBand] / [UsageDetail] /
// [UsageTopList] / [UsageTopListItem] / [UsageBanner] / [UsageFooterLink] / [UsageIntent]) so there is one
// native contract for the card, not two. The web footer's `to` / `external` navigation is adapted to the
// native idiom as an `onClick` (navigation is a host concern), exactly the choice the shipped atomic made.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/UsageCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usagecard

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.UsageBand
import io.teslasync.android.components.datadisplay.UsageBanner
import io.teslasync.android.components.datadisplay.UsageBudget
import io.teslasync.android.components.datadisplay.UsageDetail
import io.teslasync.android.components.datadisplay.UsageFooterLink
import io.teslasync.android.components.datadisplay.UsageIntent
import io.teslasync.android.components.datadisplay.UsageTopList
import io.teslasync.android.components.datadisplay.UsageTopListItem
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.datadisplay.UsageCard as AtomicUsageCard

/**
 * Stateful entry point — the faithful port of the web `UsageCard`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) and paints the result. The actual region layout is delegated to the stateless
 * [UsageCardContent], which in turn reuses the shipped atomic renderer — the view performs no work of its
 * own beyond the diagnostic.
 *
 * @param modifier optional layout modifier for the card.
 * @param budget optional budget progress bar (web `budget`); hidden entirely when `null`.
 * @param bands optional 3-up at-a-glance bands (web `bands`).
 * @param details optional key/value detail grid (web `details`).
 * @param topLists optional top-list breakdown blocks (web `topLists`).
 * @param banner optional callout banner (web `banner`).
 * @param footer optional footer link row (web `footer`).
 * @param emptyMessage optional already-localized override for the empty fallback (web `emptyMessage`);
 *   `null` resolves the shared default (`translation_common_noData`) so the card is never blank.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun UsageCard(
    modifier: Modifier = Modifier,
    budget: UsageBudget? = null,
    bands: List<UsageBand> = emptyList(),
    details: List<UsageDetail> = emptyList(),
    topLists: List<UsageTopList> = emptyList(),
    banner: UsageBanner? = null,
    footer: List<UsageFooterLink> = emptyList(),
    emptyMessage: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { UsageCardDiagnostics.recordViewOpened(logger) }
    UsageCardContent(
        modifier = modifier,
        budget = budget,
        bands = bands,
        details = details,
        topLists = topLists,
        banner = banner,
        footer = footer,
        emptyMessage = emptyMessage,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Computes the web `hasAnything` decision
 * with the pure [UsageCardProjection.project], resolves the localized empty fallback, and delegates the
 * faithful region layout to the shipped atomic [io.teslasync.android.components.datadisplay.UsageCard].
 *
 * The atomic is handed the empty fallback ONLY when there is genuinely no content (so an empty card always
 * paints the friendly message — never a blank box); when content exists the fallback is suppressed so the
 * regions render. This also closes the web-parity gap where a card carrying ONLY footer links is content
 * (web `hasAnything` counts the footer): with content present the atomic's empty branch can never fire.
 */
@Composable
fun UsageCardContent(
    modifier: Modifier = Modifier,
    budget: UsageBudget? = null,
    bands: List<UsageBand> = emptyList(),
    details: List<UsageDetail> = emptyList(),
    topLists: List<UsageTopList> = emptyList(),
    banner: UsageBanner? = null,
    footer: List<UsageFooterLink> = emptyList(),
    emptyMessage: String? = null,
) {
    val projection =
        UsageCardProjection.project(
            UsageCardRegions(
                hasBudget = budget != null,
                bandCount = bands.size,
                detailCount = details.size,
                topListCount = topLists.size,
                hasBanner = banner != null,
                footerCount = footer.size,
            ),
        )
    val fallbackEmpty = emptyMessage ?: stringResource(R.string.translation_common_noData)
    AtomicUsageCard(
        modifier = modifier,
        budget = budget,
        bands = bands,
        details = details,
        topLists = topLists,
        banner = banner,
        footer = footer,
        emptyMessage = if (projection.hasContent) null else fallbackEmpty,
    )
}

// ── Previews (tooling-only; sample values are never shipped UI) ───────────────────────────────────────

@Preview(name = "UsageCard — empty fallback", showBackground = true)
@Composable
private fun UsageCardEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UsageCardContent()
    }
}

@Preview(name = "UsageCard — budget + bands + details", showBackground = true)
@Composable
private fun UsageCardPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UsageCardContent(
            budget =
                UsageBudget(
                    headline = "$0.42 of $5.00",
                    pct = 8f,
                    ariaLabel = "Monthly AI credit usage",
                    rightLabel = "8% of monthly credit",
                    caption = "Day 5 of 30 · resets in 25 days",
                ),
            bands =
                listOf(
                    UsageBand(label = "Requests", value = "1,204", sub = "today", icon = DataDisplayGlyphs.Bolt),
                    UsageBand(label = "Tokens", value = "318k", sub = "this month", icon = DataDisplayGlyphs.Gauge),
                    UsageBand(
                        label = "Errors",
                        value = "2",
                        sub = "0.2%",
                        icon = DataDisplayGlyphs.AlertTriangle,
                        intent = UsageIntent.Warn,
                    ),
                ),
            details =
                listOf(
                    UsageDetail(label = "Useful requests", value = "1,180"),
                    UsageDetail(label = "Skipped polls", value = "24"),
                    UsageDetail(label = "Avg latency", value = "412 ms"),
                    UsageDetail(label = "Error rate", value = "0.2%", intent = UsageIntent.Danger),
                ),
        )
    }
}

@Preview(name = "UsageCard — top-list + banner + footer (dark)", showBackground = true)
@Composable
private fun UsageCardBannerFooterPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        UsageCardContent(
            topLists =
                listOf(
                    UsageTopList(
                        key = "endpoints",
                        title = "Top endpoints",
                        icon = DataDisplayGlyphs.Clock,
                        items =
                            listOf(
                                UsageTopListItem(key = "state", label = "/vehicle/state", value = "642"),
                                UsageTopListItem(key = "charge", label = "/charge/history", value = "318"),
                            ),
                    ),
                ),
            banner =
                UsageBanner(
                    title = "Over monthly credit",
                    description = "Usage paused until the credit resets in 25 days.",
                ),
            footer =
                listOf(
                    UsageFooterLink(key = "settings", label = "Open settings", onClick = {}, primary = true),
                    UsageFooterLink(key = "docs", label = "Usage docs", onClick = {}),
                ),
        )
    }
}
