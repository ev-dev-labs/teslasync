// The native Jetpack Compose + Material 3 RoadmapPage system surface — a parity port of
// web/src/features/system/pages/RoadmapPage.tsx, the product roadmap mounted at /roadmap. It reproduces the web
// page's header (title + subtitle), the four-phase progress bar (GlassPanel1), and the per-phase RoadmapCard
// sections (GlassPanel2) — every card with its icon badge, title, description, phase chip, and feature bullets.
// Every visible string resolves from the generated res/values catalog (ADR-014); the page reads no API (the web
// page renders a hardcoded `roadmapItems` array), so the static catalog lives in the framework-free model and is
// projected through the shared UiState surface by the view-model.
//
// Composition: [RoadmapPage] is the stateful entry (constructs the view-model over the static catalog, records the
// one-shot `view.opened` diagnostic, collects the resolved snapshot); [RoadmapPageContent] is the stateless render
// layer that switches the loading / empty / success surfaces off the bound [UiState] and lays out the progress bar
// + the phase sections.
//
// Color parity note: the web assigns each phase a literal hex for its dot/label/icon/header but a separate Badge
// `variant` (success/info/warning/danger for done/current/next/future). Material 3 forbids hardcoded colors
// (ADR-005), and the token palette exposes exactly those four semantic status colors — so this port resolves ALL of
// a phase's coloring (dot, label, icon, section header, chip) from the single status token matching its web Badge
// variant, keeping each phase internally consistent and theme/dynamic-color aware.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables + the visual-mapping types.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.roadmap

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Diameter of the progress-bar phase dot — the web `w-2.5 h-2.5` (2.5 × 4px). */
private val PhaseDotSize = 10.dp

/** Length of the connector segment between progress-bar phases — the web `w-8 sm:w-16` divider. */
private val PhaseConnectorWidth = 28.dp

/** Height of each roadmap-card loading skeleton (the static catalog never actually shows this). */
private val CardSkeletonHeight = 220.dp

/** Number of skeleton cards shown if a load were ever in flight (web has no spinner; kept for state symmetry). */
private const val SKELETON_COUNT = 4

// ── Visual mapping (Android resources + glyphs live here, never in the framework-free model) ──────────────────

/** The localized copy + glyph one catalog entry renders with — resolved from the web `RoadmapEntry` fields. */
private data class RoadmapVisual(
    val titleRes: Int,
    val descriptionRes: Int,
    val featureRes: List<Int>,
    val icon: ImageVector,
)

/** Maps a stable [RoadmapItemId] to its localized strings + glyph — the native analogue of the web `roadmapItems` row. */
private fun roadmapVisual(id: RoadmapItemId): RoadmapVisual =
    when (id) {
        RoadmapItemId.CorePlatform ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_corePlatform_title,
                descriptionRes = R.string.translation_roadmap_corePlatform_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_corePlatform_feature_0,
                        R.string.translation_roadmap_corePlatform_feature_1,
                        R.string.translation_roadmap_corePlatform_feature_2,
                        R.string.translation_roadmap_corePlatform_feature_3,
                        R.string.translation_roadmap_corePlatform_feature_4,
                        R.string.translation_roadmap_corePlatform_feature_5,
                        R.string.translation_roadmap_corePlatform_feature_6,
                        R.string.translation_roadmap_corePlatform_feature_7,
                        R.string.translation_roadmap_corePlatform_feature_8,
                        R.string.translation_roadmap_corePlatform_feature_9,
                        R.string.translation_roadmap_corePlatform_feature_10,
                    ),
                icon = RoadmapGlyphs.Rocket,
            )
        RoadmapItemId.SmartNotifications ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_smartNotifications_title,
                descriptionRes = R.string.translation_roadmap_smartNotifications_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_smartNotifications_feature_0,
                        R.string.translation_roadmap_smartNotifications_feature_1,
                        R.string.translation_roadmap_smartNotifications_feature_2,
                        R.string.translation_roadmap_smartNotifications_feature_3,
                        R.string.translation_roadmap_smartNotifications_feature_4,
                        R.string.translation_roadmap_smartNotifications_feature_5,
                        R.string.translation_roadmap_smartNotifications_feature_6,
                        R.string.translation_roadmap_smartNotifications_feature_7,
                        R.string.translation_roadmap_smartNotifications_feature_8,
                    ),
                icon = RoadmapGlyphs.Bell,
            )
        RoadmapItemId.Intelligence ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_intelligence_title,
                descriptionRes = R.string.translation_roadmap_intelligence_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_intelligence_feature_0,
                        R.string.translation_roadmap_intelligence_feature_1,
                        R.string.translation_roadmap_intelligence_feature_2,
                        R.string.translation_roadmap_intelligence_feature_3,
                        R.string.translation_roadmap_intelligence_feature_4,
                        R.string.translation_roadmap_intelligence_feature_5,
                        R.string.translation_roadmap_intelligence_feature_6,
                        R.string.translation_roadmap_intelligence_feature_7,
                    ),
                icon = RoadmapGlyphs.Brain,
            )
        RoadmapItemId.FleetTelemetry ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_fleetTelemetry_title,
                descriptionRes = R.string.translation_roadmap_fleetTelemetry_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_fleetTelemetry_feature_0,
                        R.string.translation_roadmap_fleetTelemetry_feature_1,
                        R.string.translation_roadmap_fleetTelemetry_feature_2,
                        R.string.translation_roadmap_fleetTelemetry_feature_3,
                        R.string.translation_roadmap_fleetTelemetry_feature_4,
                        R.string.translation_roadmap_fleetTelemetry_feature_5,
                        R.string.translation_roadmap_fleetTelemetry_feature_6,
                    ),
                icon = RoadmapGlyphs.Zap,
            )
        RoadmapItemId.PremiumUi ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_premiumUi_title,
                descriptionRes = R.string.translation_roadmap_premiumUi_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_premiumUi_feature_0,
                        R.string.translation_roadmap_premiumUi_feature_1,
                        R.string.translation_roadmap_premiumUi_feature_2,
                        R.string.translation_roadmap_premiumUi_feature_3,
                        R.string.translation_roadmap_premiumUi_feature_4,
                        R.string.translation_roadmap_premiumUi_feature_5,
                        R.string.translation_roadmap_premiumUi_feature_6,
                        R.string.translation_roadmap_premiumUi_feature_7,
                    ),
                icon = RoadmapGlyphs.Star,
            )
        RoadmapItemId.ExternalIntegrations ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_externalIntegrations_title,
                descriptionRes = R.string.translation_roadmap_externalIntegrations_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_externalIntegrations_feature_0,
                        R.string.translation_roadmap_externalIntegrations_feature_1,
                        R.string.translation_roadmap_externalIntegrations_feature_2,
                        R.string.translation_roadmap_externalIntegrations_feature_3,
                        R.string.translation_roadmap_externalIntegrations_feature_4,
                        R.string.translation_roadmap_externalIntegrations_feature_5,
                    ),
                icon = RoadmapGlyphs.Plug,
            )
        RoadmapItemId.EnhancedVisualization ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_enhancedVisualization_title,
                descriptionRes = R.string.translation_roadmap_enhancedVisualization_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_enhancedVisualization_feature_0,
                        R.string.translation_roadmap_enhancedVisualization_feature_1,
                        R.string.translation_roadmap_enhancedVisualization_feature_2,
                        R.string.translation_roadmap_enhancedVisualization_feature_3,
                        R.string.translation_roadmap_enhancedVisualization_feature_4,
                        R.string.translation_roadmap_enhancedVisualization_feature_5,
                    ),
                icon = RoadmapGlyphs.Star,
            )
        RoadmapItemId.Helix ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_helix_title,
                descriptionRes = R.string.translation_roadmap_helix_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_helix_feature_0,
                        R.string.translation_roadmap_helix_feature_1,
                        R.string.translation_roadmap_helix_feature_2,
                        R.string.translation_roadmap_helix_feature_3,
                        R.string.translation_roadmap_helix_feature_4,
                        R.string.translation_roadmap_helix_feature_5,
                    ),
                icon = RoadmapGlyphs.Brain,
            )
        RoadmapItemId.Enterprise ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_enterprise_title,
                descriptionRes = R.string.translation_roadmap_enterprise_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_enterprise_feature_0,
                        R.string.translation_roadmap_enterprise_feature_1,
                        R.string.translation_roadmap_enterprise_feature_2,
                        R.string.translation_roadmap_enterprise_feature_3,
                        R.string.translation_roadmap_enterprise_feature_4,
                        R.string.translation_roadmap_enterprise_feature_5,
                        R.string.translation_roadmap_enterprise_feature_6,
                        R.string.translation_roadmap_enterprise_feature_7,
                    ),
                icon = RoadmapGlyphs.Cloud,
            )
        RoadmapItemId.MobileApp ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_mobileApp_title,
                descriptionRes = R.string.translation_roadmap_mobileApp_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_mobileApp_feature_0,
                        R.string.translation_roadmap_mobileApp_feature_1,
                        R.string.translation_roadmap_mobileApp_feature_2,
                        R.string.translation_roadmap_mobileApp_feature_3,
                        R.string.translation_roadmap_mobileApp_feature_4,
                        R.string.translation_roadmap_mobileApp_feature_5,
                        R.string.translation_roadmap_mobileApp_feature_6,
                    ),
                icon = RoadmapGlyphs.Smartphone,
            )
        RoadmapItemId.AdvancedFleet ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_advancedFleet_title,
                descriptionRes = R.string.translation_roadmap_advancedFleet_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_advancedFleet_feature_0,
                        R.string.translation_roadmap_advancedFleet_feature_1,
                        R.string.translation_roadmap_advancedFleet_feature_2,
                        R.string.translation_roadmap_advancedFleet_feature_3,
                        R.string.translation_roadmap_advancedFleet_feature_4,
                        R.string.translation_roadmap_advancedFleet_feature_5,
                        R.string.translation_roadmap_advancedFleet_feature_6,
                    ),
                icon = RoadmapGlyphs.BarChart3,
            )
        RoadmapItemId.SmartRouting ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_smartRouting_title,
                descriptionRes = R.string.translation_roadmap_smartRouting_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_smartRouting_feature_0,
                        R.string.translation_roadmap_smartRouting_feature_1,
                        R.string.translation_roadmap_smartRouting_feature_2,
                        R.string.translation_roadmap_smartRouting_feature_3,
                        R.string.translation_roadmap_smartRouting_feature_4,
                        R.string.translation_roadmap_smartRouting_feature_5,
                        R.string.translation_roadmap_smartRouting_feature_6,
                    ),
                icon = RoadmapGlyphs.Map,
            )
        RoadmapItemId.Security ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_security_title,
                descriptionRes = R.string.translation_roadmap_security_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_security_feature_0,
                        R.string.translation_roadmap_security_feature_1,
                        R.string.translation_roadmap_security_feature_2,
                        R.string.translation_roadmap_security_feature_3,
                        R.string.translation_roadmap_security_feature_4,
                        R.string.translation_roadmap_security_feature_5,
                        R.string.translation_roadmap_security_feature_6,
                    ),
                icon = RoadmapGlyphs.Shield,
            )
        RoadmapItemId.SmartHome ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_smartHome_title,
                descriptionRes = R.string.translation_roadmap_smartHome_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_smartHome_feature_0,
                        R.string.translation_roadmap_smartHome_feature_1,
                        R.string.translation_roadmap_smartHome_feature_2,
                        R.string.translation_roadmap_smartHome_feature_3,
                        R.string.translation_roadmap_smartHome_feature_4,
                        R.string.translation_roadmap_smartHome_feature_5,
                        R.string.translation_roadmap_smartHome_feature_6,
                    ),
                icon = RoadmapGlyphs.Leaf,
            )
        RoadmapItemId.Community ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_community_title,
                descriptionRes = R.string.translation_roadmap_community_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_community_feature_0,
                        R.string.translation_roadmap_community_feature_1,
                        R.string.translation_roadmap_community_feature_2,
                        R.string.translation_roadmap_community_feature_3,
                        R.string.translation_roadmap_community_feature_4,
                        R.string.translation_roadmap_community_feature_5,
                        R.string.translation_roadmap_community_feature_6,
                    ),
                icon = RoadmapGlyphs.Users,
            )
        RoadmapItemId.DeveloperPlatform ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_developerPlatform_title,
                descriptionRes = R.string.translation_roadmap_developerPlatform_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_developerPlatform_feature_0,
                        R.string.translation_roadmap_developerPlatform_feature_1,
                        R.string.translation_roadmap_developerPlatform_feature_2,
                        R.string.translation_roadmap_developerPlatform_feature_3,
                        R.string.translation_roadmap_developerPlatform_feature_4,
                        R.string.translation_roadmap_developerPlatform_feature_5,
                        R.string.translation_roadmap_developerPlatform_feature_6,
                    ),
                icon = RoadmapGlyphs.Wrench,
            )
        RoadmapItemId.Global ->
            RoadmapVisual(
                titleRes = R.string.translation_roadmap_global_title,
                descriptionRes = R.string.translation_roadmap_global_description,
                featureRes =
                    listOf(
                        R.string.translation_roadmap_global_feature_0,
                        R.string.translation_roadmap_global_feature_1,
                        R.string.translation_roadmap_global_feature_2,
                        R.string.translation_roadmap_global_feature_3,
                        R.string.translation_roadmap_global_feature_4,
                        R.string.translation_roadmap_global_feature_5,
                        R.string.translation_roadmap_global_feature_6,
                    ),
                icon = RoadmapGlyphs.Globe,
            )
    }

/** The localized phase label (web `t('roadmap.phase.<p>', label)`). */
private fun phaseLabelRes(phase: RoadmapPhase): Int =
    when (phase) {
        RoadmapPhase.Done -> R.string.translation_roadmap_phase_done
        RoadmapPhase.Current -> R.string.translation_roadmap_phase_current
        RoadmapPhase.Next -> R.string.translation_roadmap_phase_next
        RoadmapPhase.Future -> R.string.translation_roadmap_phase_future
    }

/** The web Badge `variant` per phase (done=success, current=info, next=warning, future=danger). */
private fun phaseVariant(phase: RoadmapPhase): BadgeVariant =
    when (phase) {
        RoadmapPhase.Done -> BadgeVariant.Success
        RoadmapPhase.Current -> BadgeVariant.Info
        RoadmapPhase.Next -> BadgeVariant.Warning
        RoadmapPhase.Future -> BadgeVariant.Danger
    }

/** The section-header glyph per phase (web `PHASE_ICONS`: done=CheckCircle, current=Zap, next=Star, future=Rocket). */
private fun phaseHeaderIcon(phase: RoadmapPhase): ImageVector =
    when (phase) {
        RoadmapPhase.Done -> RoadmapGlyphs.CheckCircle
        RoadmapPhase.Current -> RoadmapGlyphs.Zap
        RoadmapPhase.Next -> RoadmapGlyphs.Star
        RoadmapPhase.Future -> RoadmapGlyphs.Rocket
    }

/** The per-card feature-bullet glyph (web: done→CheckCircle, current→Zap, otherwise→Clock). */
private fun featureBulletIcon(phase: RoadmapPhase): ImageVector =
    when (phase) {
        RoadmapPhase.Done -> RoadmapGlyphs.CheckCircle
        RoadmapPhase.Current -> RoadmapGlyphs.Zap
        else -> RoadmapGlyphs.Clock
    }

/** The semantic status color for a phase — single source for its dot/label/icon/header/chip (see file header). */
@Composable
private fun phaseColor(phase: RoadmapPhase): Color =
    when (phase) {
        RoadmapPhase.Done -> TeslaTokens.status.success
        RoadmapPhase.Current -> TeslaTokens.status.info
        RoadmapPhase.Next -> TeslaTokens.status.warning
        RoadmapPhase.Future -> TeslaTokens.status.danger
    }

/** The feature-bullet tint (web: done→green, current→cyan, otherwise→muted). */
@Composable
private fun featureBulletColor(phase: RoadmapPhase): Color =
    when (phase) {
        RoadmapPhase.Done -> TeslaTokens.status.success
        RoadmapPhase.Current -> TeslaTokens.status.info
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [RoadmapPageViewModel] over the static canonical catalog. [logger] defaults to the
 * app's redacting logger. The view-model is keyed by this surface's slug so it is scoped to the /roadmap entry.
 */
@Composable
fun RoadmapPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: RoadmapPageViewModel =
        viewModel(
            key = RoadmapPageRegistration.SLUG,
            factory = viewModelFactory { initializer { RoadmapPageViewModel(logger = logger) } },
        )
    RoadmapPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot, and hands
 * the stateless content the accessibility pane title (web `usePageTitle(t('roadmap.title'))`).
 */
@Composable
fun RoadmapPage(
    viewModel: RoadmapPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val title = stringResource(R.string.translation_roadmap_title)

    RoadmapPageContent(
        uiState = uiState,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the title/subtitle header, then switches off
 * the bound [uiState]: the loading skeletons, the no-data empty-state, or — on success — the FadeIn progress bar
 * (GlassPanel1) and the per-phase RoadmapCard sections (GlassPanel2).
 */
@Composable
fun RoadmapPageContent(
    uiState: UiState<RoadmapSnapshot>,
    modifier: Modifier = Modifier,
) {
    val snapshot = uiState.data

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        RoadmapHeader()

        when {
            uiState.isLoading -> RoadmapLoading()
            snapshot == null || snapshot.isEmpty -> RoadmapEmpty()
            else -> {
                FadeIn { RoadmapProgressBar(tallies = snapshot.tallies) }
                snapshot.groups.forEach { group ->
                    RoadmapPhaseSection(group = group)
                }
            }
        }
    }
}

/** The page header — title + subtitle (web `PageContainer` title + subtitle). */
@Composable
private fun RoadmapHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_roadmap_title))
        BodyText(
            stringResource(R.string.translation_roadmap_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * GlassPanel1 — the four-phase progress bar. For every phase (including any empty one) it shows a colored dot, the
 * phase label, and a count chip, with a connector segment between phases. Horizontally scrollable like the web
 * `overflow-x-auto` row.
 */
@Composable
private fun RoadmapProgressBar(tallies: List<RoadmapPhaseTally>) {
    val description = stringResource(R.string.translation_roadmap_title)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = description },
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tallies.forEachIndexed { index, tally ->
                RoadmapProgressStep(tally = tally)
                if (index < tallies.lastIndex) {
                    Box(
                        modifier =
                            Modifier
                                .width(PhaseConnectorWidth)
                                .height(1.dp)
                                .background(MaterialTheme.colorScheme.outlineVariant),
                    )
                }
            }
        }
    }
}

/** One progress-bar step: a phase dot + label + count chip (web inner flex group). */
@Composable
private fun RoadmapProgressStep(tally: RoadmapPhaseTally) {
    val color = phaseColor(tally.phase)
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .size(PhaseDotSize)
                    .clip(CircleShape)
                    .background(color),
        )
        BodyText(stringResource(phaseLabelRes(tally.phase)), color = color)
        Badge(text = tally.count.toString(), variant = phaseVariant(tally.phase))
    }
}

/**
 * One non-empty phase section: a colored phase header (icon + label, web `<h2>`) above the StaggerContainer of
 * RoadmapCards for that phase (web per-phase grid). Single-column on mobile, matching the web `grid-cols-1` default.
 */
@Composable
private fun RoadmapPhaseSection(group: RoadmapPhaseGroup) {
    val color = phaseColor(group.phase)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        FadeIn {
            Row(
                modifier = Modifier.semantics { heading() },
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    phaseHeaderIcon(group.phase),
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = color,
                )
                Heading(
                    text = stringResource(phaseLabelRes(group.phase)),
                    level = HeadingLevel.Section,
                    color = color,
                )
            }
        }
        StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            group.entries.forEachIndexed { index, entry ->
                StaggerItem(index = index) {
                    RoadmapCard(entry = entry)
                }
            }
        }
    }
}

/**
 * GlassPanel2 — one roadmap card. Header row (a phase-tinted icon badge + the title/description, with the phase
 * chip on the trailing edge) above the feature-bullet list (each bullet glyph + color keyed to the card's phase).
 */
@Composable
private fun RoadmapCard(entry: RoadmapEntry) {
    val visual = roadmapVisual(entry.id)
    val color = phaseColor(entry.phase)
    val title = stringResource(visual.titleRes)

    GlassPanel(
        modifier = Modifier.semantics { contentDescription = title },
        padding = PanelPadding.Md,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.Top,
            ) {
                PhaseIconBadge(icon = visual.icon, color = color)
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    PanelTitle(title)
                    Caption(stringResource(visual.descriptionRes))
                }
                Badge(
                    text = stringResource(phaseLabelRes(entry.phase)),
                    variant = phaseVariant(entry.phase),
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                visual.featureRes.forEach { featureRes ->
                    RoadmapFeatureRow(phase = entry.phase, featureRes = featureRes)
                }
            }
        }
    }
}

/** One feature bullet — a phase-keyed status glyph + the feature copy (web `<li>`). */
@Composable
private fun RoadmapFeatureRow(
    phase: RoadmapPhase,
    featureRes: Int,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            featureBulletIcon(phase),
            contentDescription = null,
            size = IconSize.Sm,
            tint = featureBulletColor(phase),
        )
        HelperText(stringResource(featureRes), modifier = Modifier.weight(1f))
    }
}

/** A rounded, phase-tinted container holding the card's lead glyph (web `rounded-xl` icon chip). */
@Composable
private fun PhaseIconBadge(
    icon: ImageVector,
    color: Color,
) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = color.copy(alpha = ICON_BADGE_WASH_ALPHA),
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.padding(Spacing.sm),
            size = IconSize.Lg,
            tint = color,
        )
    }
}

/** The no-data empty-state — the catalog never resolves to empty, but the seam is implemented (web shows nothing). */
@Composable
private fun RoadmapEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = RoadmapGlyphs.Rocket,
    )
}

/** The loading skeletons (the static catalog never actually loads, but the surface is implemented for symmetry). */
@Composable
private fun RoadmapLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(SKELETON_COUNT) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = CardSkeletonHeight, rounded = true)
        }
    }
}

private const val ICON_BADGE_WASH_ALPHA = 0.12f
