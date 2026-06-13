// The native Jetpack Compose + Material 3 LayoutBreadcrumbs shared surface — a parity port of the web breadcrumb
// graph rooted at web/src/components/layout/LayoutBreadcrumbs.tsx (which composes <Breadcrumbs>, useBreadcrumbs,
// and BreadcrumbOverridesContext). The web surface is the single canonical breadcrumb row mounted in the global
// layout chrome: it reads per-page label overrides and the current route, resolves the full parent chain, and
// renders a leading home affordance, chevron separators, linked ancestor crumbs, and a plain-text current crumb —
// self-suppressing to nothing for a top-level page whose chain is a single item.
//
// Every derivation flows through the pure model (LayoutBreadcrumbsModel.kt); this file is a thin render layer. The
// faithful mapping of the web behaviour:
//   • useBreadcrumbOverrides() -> the [LayoutBreadcrumbsViewModel] reading the shared override store (P1/S8).
//   • useBreadcrumbs(overrides) -> [buildBreadcrumbTrail] over the current [destination] + route [args] (the nav
//     destination is handed in by the owning scaffold, the native analogue of the web `useLocation`/`useParams`).
//   • <Breadcrumbs> JSX -> [LayoutBreadcrumbsContent]: the `items.length <= 1 -> null` self-suppression, the
//     leading home link, the per-item chevron + (link | current text), the `truncate max-w-[200px]` clamp, the
//     `overflow-x-auto` horizontal scroll, and the `hidden sm:inline` + "..." collapse of middle crumbs on a
//     compact width are each reproduced below. Every visible string resolves through the i18n catalog (P1/S10) and
//     every interactive element carries a screen-reader label; the one-shot `view.opened` diagnostic (P1/S11) is
//     emitted on first composition.
//
// The atomic chrome (Icon, IconButton, Text) is reused from the shared component library; this surface only
// composes it — no web Tailwind classes, platform design tokens only (P1/S9). The leading affordance uses the
// native dashboard glyph the rest of the nav chrome uses (the web home icon also anchors at "/"), labelled
// "Dashboard" exactly like the web `a11y.breadcrumbHome` key.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.navigation.navTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the breadcrumb row — the native analogue of the web `<nav aria-label="Breadcrumb">`. */
const val LAYOUT_BREADCRUMBS_TEST_TAG: String = "layout-breadcrumbs"

/**
 * Stateful entry point bound to the navigation layer + the override store — the faithful port of the web
 * `LayoutBreadcrumbs` mounted in the global layout chrome. Resolves the current [destination]'s parent chain into
 * a crumb trail, pulling friendly per-page labels from the shared override store (P1/S8) and localized fallbacks
 * from the nav catalog (P1/S10), then delegates to the stateless renderer. No data is fetched here.
 *
 * @param destination the current navigation destination (the web `useLocation` analogue, supplied by the scaffold).
 * @param modifier optional layout modifier for the breadcrumb row.
 * @param args the current route's path args (the web `useParams` analogue) used to fill `{{token}}` labels and
 *   `{arg}` link routes.
 * @param onNavigate invoked with an ancestor crumb when it is tapped; the host opens [BreadcrumbItem.route].
 * @param onHome invoked when the leading home affordance is tapped; the host returns to the dashboard ("/").
 * @param overridesStore the shared breadcrumb-label store; defaults to the process-wide [BreadcrumbOverrides].
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey scopes the ViewModel per placement; defaults to the surface slug.
 */
@Composable
fun LayoutBreadcrumbs(
    destination: Destination,
    modifier: Modifier = Modifier,
    args: Map<String, String> = emptyMap(),
    onNavigate: (BreadcrumbItem) -> Unit = {},
    onHome: () -> Unit = {},
    overridesStore: BreadcrumbOverridesStore = BreadcrumbOverrides.store,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = LayoutBreadcrumbsDiagnostics.SLUG,
) {
    val viewModel: LayoutBreadcrumbsViewModel =
        viewModel(key = instanceKey, factory = LayoutBreadcrumbsViewModel.factory(overridesStore, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val overrides by viewModel.overrides.collectAsStateWithLifecycle()

    val chainIds = remember(destination.id) { breadcrumbChainIds(destination.id) }
    val titles = LinkedHashMap<String, String>(chainIds.size)
    for (id in chainIds) titles[id] = navTitle(Destinations.require(id))

    val items = buildBreadcrumbTrail(destination.id, args, overrides) { id -> titles[id] ?: id }

    LayoutBreadcrumbsContent(items = items, modifier = modifier, onNavigate = onNavigate, onHome = onHome)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the breadcrumb row for a resolved trail,
 * or nothing at all when the trail self-suppresses (web `items.length <= 1 ? null`). The row is horizontally
 * scrollable (web `overflow-x-auto`); on a compact width the middle crumbs collapse to a single ellipsis exactly
 * like the web `hidden sm:inline` rule, while the first and current crumbs always stay visible.
 */
@Composable
fun LayoutBreadcrumbsContent(
    items: List<BreadcrumbItem>,
    modifier: Modifier = Modifier,
    onNavigate: (BreadcrumbItem) -> Unit = {},
    onHome: () -> Unit = {},
) {
    if (classifyBreadcrumbs(items) is BreadcrumbsSurface.Suppressed) return

    val navLabel = stringResource(R.string.translation_a11y_breadcrumb)
    val homeLabel = stringResource(R.string.translation_a11y_breadcrumbHome)

    BoxWithConstraints(modifier = modifier) {
        val compact = maxWidth < COMPACT_WIDTH
        Row(
            modifier =
                Modifier
                    .testTag(LAYOUT_BREADCRUMBS_TEST_TAG)
                    .horizontalScroll(rememberScrollState())
                    .semantics { contentDescription = navLabel },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            HomeCrumb(label = homeLabel, onClick = onHome)
            items.forEachIndexed { index, item ->
                val isLast = index == items.lastIndex
                val isMiddle = index > 0 && !isLast
                Separator()
                when {
                    compact && isMiddle -> CollapsedCrumb()
                    item.isCurrent -> CurrentCrumb(label = item.label)
                    else -> LinkCrumb(label = item.label, onClick = { onNavigate(item) })
                }
            }
        }
    }
}

/**
 * The leading home affordance — a tappable dashboard glyph that returns to "/" (web `<PrefetchLink to="/">` with
 * the `Home` icon). It is a shared [IconButton] so it carries a 48 dp touch target and announces the localized
 * [label] ("Dashboard") to assistive tech.
 */
@Composable
private fun HomeCrumb(
    label: String,
    onClick: () -> Unit,
) {
    IconButton(
        imageVector = NavGlyphs.Dashboard,
        contentDescription = label,
        onClick = onClick,
        size = IconSize.Sm,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The chevron between crumbs (web `<ChevronRight>`), decorative and skipped by assistive tech. */
@Composable
private fun Separator() {
    Icon(
        imageVector = TeslaGlyphs.ChevronRight,
        contentDescription = null,
        size = IconSize.Xs,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * A linked ancestor crumb — muted, truncated text that opens its route on tap (web ancestor `<PrefetchLink>`). The
 * clickable carries the localized [label] as its action label so the link is announced to assistive tech.
 */
@Composable
private fun LinkCrumb(
    label: String,
    onClick: () -> Unit,
) {
    Text(
        text = label,
        modifier =
            Modifier
                .widthIn(max = CRUMB_MAX_WIDTH)
                .clickable(onClickLabel = label, role = Role.Button, onClick = onClick)
                .padding(vertical = Spacing.xs),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The trailing current-page crumb — emphasized, truncated, non-interactive text (web last `<span>`). */
@Composable
private fun CurrentCrumb(label: String) {
    Text(
        text = label,
        modifier = Modifier.widthIn(max = CRUMB_MAX_WIDTH),
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The compact-width collapse indicator standing in for hidden middle crumbs (web `<span aria-hidden>...`). */
@Composable
private fun CollapsedCrumb() {
    Text(
        text = "\u2026",
        modifier = Modifier.clearAndSetSemantics { },
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Compact-width cutoff below which middle crumbs collapse — the native analogue of the Tailwind `sm` breakpoint. */
private val COMPACT_WIDTH = 600.dp

/** Per-crumb text clamp — the native analogue of the web `max-w-[200px]` truncation. */
private val CRUMB_MAX_WIDTH = 200.dp

@Preview(name = "Breadcrumbs - trail", showBackground = true)
@Composable
private fun LayoutBreadcrumbsTrailPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutBreadcrumbsContent(
            items =
                listOf(
                    BreadcrumbItem(destinationId = "drives", label = "Drives", route = "drives"),
                    BreadcrumbItem(destinationId = "driveDetail", label = "Trip to office", route = null),
                ),
        )
    }
}

@Preview(name = "Breadcrumbs - nested", showBackground = true)
@Composable
private fun LayoutBreadcrumbsNestedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutBreadcrumbsContent(
            items =
                listOf(
                    BreadcrumbItem(destinationId = "vehicles", label = "Vehicles", route = "vehicles"),
                    BreadcrumbItem(destinationId = "vehicleDetail", label = "Model 3", route = "vehicles/3"),
                    BreadcrumbItem(destinationId = "vehicleAccess", label = "Access", route = null),
                ),
        )
    }
}
