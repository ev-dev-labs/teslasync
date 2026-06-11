// The native Jetpack Compose + Material 3 VehicleUpgrades ("Upgrades & Sharing") dashboard surface — a parity
// port of web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx. It mirrors the web `WidgetShell` (a
// skeleton while the first upgrades load is in flight, otherwise an ArrowUpCircle-iconed title + freshness
// header) wrapping either the compact tile (icon + eligible-upgrade count + "available", or an "Up to date"
// badge when none) or the full layout (the available-upgrades list — name + price chip + eligibility badge,
// or the "All upgrades applied" row — a divider, then the share-links section: active-link count + nearest
// expiry, or the "No active share links" empty state). A hard upgrades failure with no cache surfaces the
// retry affordance (web `isError`); a stale/offline cached snapshot keeps its rows visible with the freshness
// chip flagged and auto-refreshes. All data flows through the shared [VehicleUpgradesWidgetViewModel] (P1/S8);
// the view never performs HTTP. Every string resolves through the i18n catalog (P1/S10) and every interactive
// element carries a TalkBack label.
//
// The Lucide `ArrowUpCircle` + `Link2` glyphs the web uses have no shared-set equivalent, so they are authored
// here as 24×24 stroked vectors (the same approach as the sibling SubscriptionsWidget's `CreditCard`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleUpgradesWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleupgrades

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.sharing.ShareToken
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Minimum 44 dp target so each upgrade row + the compact tile is a comfortable TalkBack/touch target. */
private val MIN_TARGET_HEIGHT = 44.dp

/** Tighter inter-line spacing inside the two/three-line upgrade row. */
private val ROW_LINE_SPACING = 2.dp

/** Skeleton chrome dimensions while the first upgrades load is in flight. */
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_ROW_HEIGHT = 28.dp
private const val SKELETON_TITLE_FRACTION = 0.5f
private const val SKELETON_LABEL_FRACTION = 0.4f

/** Local glyph viewport/stroke dimensions (24×24 stroked, mirroring the shared glyph sets). */
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * Stateful entry point. Binds the shared vehicles + upgrades + drives + share-links feeds via [source] into a
 * [VehicleUpgradesWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface for
 * the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8 data layer), an
 * optional bound [vehicleId] (web `WidgetProps.vehicleId`; `null` ⇒ first enrolled vehicle), and a unique
 * [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (a `VehiclesStore`/`DrivingStore`/`SharingStore` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleUpgradesWidget(
    source: VehicleUpgradesSource,
    modifier: Modifier = Modifier,
    size: VehicleUpgradesSize = VehicleUpgradesRegistration.defaultSize,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = VehicleUpgradesRegistration.ID,
) {
    val viewModel: VehicleUpgradesWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = VehicleUpgradesWidgetViewModel.factory(source, logger, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    VehicleUpgradesWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web `WidgetShell`
 * short-circuits (first load → skeleton; hard error → retry) and otherwise the ArrowUpCircle title + freshness
 * header over the compact tile / full upgrades + sharing layout. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [nowMillis] anchors the share-link `daysUntil` math (tests pin it).
 */
@Composable
fun VehicleUpgradesWidgetContent(
    state: UiState<VehicleUpgradesSnapshot>,
    size: VehicleUpgradesSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberVehicleUpgradesStrings()
    when {
        state.isLoading -> VehicleUpgradesLoading(compact = size.isCompact, modifier = modifier)
        state.isError -> VehicleUpgradesError(onRetry = onRefresh, modifier = modifier)
        else -> VehicleUpgradesLoaded(state, size, strings, onRefresh, nowMillis, modifier)
    }
}

@Composable
private fun VehicleUpgradesLoaded(
    state: UiState<VehicleUpgradesSnapshot>,
    size: VehicleUpgradesSize,
    strings: VehicleUpgradesStrings,
    onRefresh: () -> Unit,
    nowMillis: Long,
    modifier: Modifier,
) {
    val snapshot = state.data ?: VehicleUpgradesSnapshot.EMPTY
    val display =
        remember(snapshot, size, strings, nowMillis) {
            VehicleUpgradesProjection.project(snapshot, size, strings, nowMillis)
        }
    Column(modifier = modifier.fillMaxSize()) {
        VehicleUpgradesHeader(showTitle = !size.isCompact, title = strings.title, state = state, onRefresh = onRefresh)
        FadeIn(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (size.isCompact) {
                VehicleUpgradesCompactBody(display, strings)
            } else {
                VehicleUpgradesStandardBody(display, strings)
            }
        }
    }
}

@Composable
private fun VehicleUpgradesHeader(
    showTitle: Boolean,
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (showTitle) {
            Icon(ArrowUpCircleGlyph, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = !showTitle,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// ── Compact (1-column) tile ──────────────────────────────────────────────────────────────────────────────

@Composable
private fun VehicleUpgradesCompactBody(
    display: VehicleUpgradesDisplay,
    strings: VehicleUpgradesStrings,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .heightIn(min = MIN_TARGET_HEIGHT)
                .padding(Spacing.md)
                .clearAndSetSemantics { contentDescription = display.compactDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(ArrowUpCircleGlyph, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.success)
        if (display.hasUpgrades) {
            MetricValue(display.eligibleCount.toString())
            MetricLabel(strings.available)
        } else {
            Badge(text = strings.upToDate, variant = BadgeVariant.Success)
        }
    }
}

// ── Full (≥2-column) layout ──────────────────────────────────────────────────────────────────────────────

@Composable
private fun VehicleUpgradesStandardBody(
    display: VehicleUpgradesDisplay,
    strings: VehicleUpgradesStrings,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        UpgradesSection(display, strings)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        ShareLinksSection(display, strings)
    }
}

@Composable
private fun UpgradesSection(
    display: VehicleUpgradesDisplay,
    strings: VehicleUpgradesStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(strings.upgradesHeading, modifier = Modifier.semantics { heading() })
        if (display.hasUpgrades) {
            display.upgrades.forEachIndexed { index, row ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                UpgradeListRow(row, display.isWide)
            }
        } else {
            AllAppliedRow(strings.allApplied)
        }
    }
}

@Composable
private fun UpgradeListRow(
    row: UpgradeRow,
    isWide: Boolean,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TARGET_HEIGHT)
                .clearAndSetSemantics { contentDescription = row.contentDescription }
                .padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(ROW_LINE_SPACING)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                BodyText(row.name, modifier = Modifier.weight(1f, fill = false), maxLines = 1)
                row.priceLabel?.let { Badge(text = it, variant = BadgeVariant.Neutral) }
            }
            row.description?.let {
                BodyText(it, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            if (isWide) {
                Caption(row.eligibilityLabel)
            }
        }
        Badge(
            text = row.eligibilityLabel,
            variant = if (row.eligible) BadgeVariant.Success else BadgeVariant.Neutral,
        )
    }
}

@Composable
private fun AllAppliedRow(message: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.sm)
                .clearAndSetSemantics { contentDescription = message },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(DataDisplayGlyphs.CheckCircle, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
        BodyText(message, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

@Composable
private fun ShareLinksSection(
    display: VehicleUpgradesDisplay,
    strings: VehicleUpgradesStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.semantics { heading() },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(Link2Glyph, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Caption(strings.shareLinksHeading)
        }
        if (display.hasActiveShareLinks) {
            ShareLinkSummary(display, strings)
        } else {
            EmptyState(message = strings.noShareLinks, icon = Link2Glyph, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun ShareLinkSummary(
    display: VehicleUpgradesDisplay,
    strings: VehicleUpgradesStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        KeyValueRow(label = strings.activeLinks, value = display.activeShareLinkCount.toString())
        display.nearestExpiryLabel?.let { label ->
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = MIN_TARGET_HEIGHT)
                        .clearAndSetSemantics { contentDescription = "${strings.nearestExpiry}, $label" },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Caption(strings.nearestExpiry)
                Badge(text = label, variant = BadgeVariant.Warning)
            }
        }
    }
}

@Composable
private fun KeyValueRow(
    label: String,
    value: String,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TARGET_HEIGHT)
                .clearAndSetSemantics { contentDescription = "$label, $value" },
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        BodyText(value, maxLines = 1)
    }
}

@Composable
private fun VehicleUpgradesLoading(
    compact: Boolean,
    modifier: Modifier,
) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        if (!compact) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
            Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_TITLE_HEIGHT)
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun VehicleUpgradesError(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
        )
    }
}

/**
 * Builds the localized [VehicleUpgradesStrings] from the i18n catalog (P1/S10). All eleven chrome keys
 * (`widget.upgrades.{title,available,upToDate,upgradesHeading,eligible,notEligible,allApplied,
 * shareLinksHeading,activeLinks,nearestExpiry,noShareLinks}`) resolve through `stringResource`. Remembered
 * against the resolved values so a locale change re-projects the surface.
 */
@Composable
private fun rememberVehicleUpgradesStrings(): VehicleUpgradesStrings {
    val title = stringResource(R.string.translation_widget_upgrades_title)
    val available = stringResource(R.string.translation_widget_upgrades_available)
    val upToDate = stringResource(R.string.translation_widget_upgrades_upToDate)
    val upgradesHeading = stringResource(R.string.translation_widget_upgrades_upgradesHeading)
    val eligible = stringResource(R.string.translation_widget_upgrades_eligible)
    val notEligible = stringResource(R.string.translation_widget_upgrades_notEligible)
    val allApplied = stringResource(R.string.translation_widget_upgrades_allApplied)
    val shareLinksHeading = stringResource(R.string.translation_widget_upgrades_shareLinksHeading)
    val activeLinks = stringResource(R.string.translation_widget_upgrades_activeLinks)
    val nearestExpiry = stringResource(R.string.translation_widget_upgrades_nearestExpiry)
    val noShareLinks = stringResource(R.string.translation_widget_upgrades_noShareLinks)
    return remember(
        title,
        available,
        upToDate,
        upgradesHeading,
        eligible,
        notEligible,
        allApplied,
        shareLinksHeading,
        activeLinks,
        nearestExpiry,
        noShareLinks,
    ) {
        VehicleUpgradesStrings(
            title = title,
            available = available,
            upToDate = upToDate,
            upgradesHeading = upgradesHeading,
            eligible = eligible,
            notEligible = notEligible,
            allApplied = allApplied,
            shareLinksHeading = shareLinksHeading,
            activeLinks = activeLinks,
            nearestExpiry = nearestExpiry,
            noShareLinks = noShareLinks,
        )
    }
}

// ── Local glyphs — the web `ArrowUpCircle` + `Link2` (lucide), authored as 24×24 stroked vectors. The shared
// glyph sets ship neither, and this surface's allowed files cannot extend them, so they are hand-authored here
// (mirroring the sibling SubscriptionsWidget's `CreditCard`). Monochrome; recolored by the [Icon] tint. ──

private fun upgradesStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs (the shared-glyph pattern). */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** The web `ArrowUpCircle`: an enclosing circle with an upward arrow (shaft + chevron). */
private val ArrowUpCircleGlyph: ImageVector =
    upgradesStroked("ArrowUpCircle") {
        circle(12f, 12f, 9f)
        moveTo(12f, 16f)
        lineTo(12f, 8f)
        moveTo(8f, 12f)
        lineTo(12f, 8f)
        lineTo(16f, 12f)
    }

/** The web `Link2`: two rounded link brackets joined by a short connector. */
private val Link2Glyph: ImageVector =
    upgradesStroked("Link2") {
        // Left bracket: down-edge → arc bulging left → up-edge.
        moveTo(9f, 17f)
        lineTo(7f, 17f)
        arcTo(5f, 5f, 0f, false, false, 7f, 7f)
        lineTo(9f, 7f)
        // Right bracket: up-edge → arc bulging right → down-edge.
        moveTo(15f, 7f)
        lineTo(17f, 7f)
        arcTo(5f, 5f, 0f, false, true, 17f, 17f)
        lineTo(15f, 17f)
        // Connector.
        moveTo(8f, 12f)
        lineTo(16f, 12f)
    }

// ── Previews — one per rendered state (standard content / compact / empty). ──

private fun previewShareToken(
    id: Long,
    expiresAt: String?,
): ShareToken =
    ShareToken(
        id = id,
        token = "tok$id",
        driveId = 1L,
        includeMap = true,
        includeTelemetry = false,
        includeSpeed = true,
        views = 0,
        expiresAt = expiresAt,
        createdAt = "2024-01-01T00:00:00Z",
    )

private fun previewSnapshot(): VehicleUpgradesSnapshot =
    VehicleUpgradesSnapshot(
        upgradesData =
            buildJsonObject {
                put(
                    "upgrades",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("name", "Acceleration Boost")
                                put("price", "2000")
                                put("description", "0–60 mph improved")
                                put("eligible", true)
                            },
                        )
                        add(
                            buildJsonObject {
                                put("name", "Premium Connectivity")
                                put("eligible", false)
                            },
                        )
                    },
                )
            },
        shareLinks = listOf(previewShareToken(1L, "2099-06-01")),
    )

@Preview(name = "Standard — content", widthDp = 240, heightDp = 320)
@Composable
private fun PreviewStandard() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleUpgradesWidgetContent(
            state = UiState(UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            size = VehicleUpgradesRegistration.defaultSize,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Compact — count", widthDp = 120, heightDp = 160)
@Composable
private fun PreviewCompact() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleUpgradesWidgetContent(
            state = UiState(UiPhase.Content, data = previewSnapshot(), fetchedAt = PREVIEW_NOW),
            size = VehicleUpgradesSize(cols = 1, rows = 2),
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "Empty — all applied", widthDp = 240, heightDp = 320)
@Composable
private fun PreviewEmpty() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleUpgradesWidgetContent(
            state = UiState(UiPhase.Empty, data = VehicleUpgradesSnapshot.EMPTY, fetchedAt = PREVIEW_NOW),
            size = VehicleUpgradesRegistration.defaultSize,
            onRefresh = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

/** 2025-06-11T00:00:00Z — anchors the preview share-link expiry math deterministically. */
private const val PREVIEW_NOW: Long = 1_749_600_000_000L
