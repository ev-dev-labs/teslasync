// The native Jetpack Compose + Material 3 AIPiiRedactionSharedExports shared surface — a parity port of
// web/src/components/ai/AIPiiRedactionSharedExports.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel`
// scaffold it renders. The web surface is a "header + export-type Select + Suggest-redactions button + streaming
// output" AI card: a Helix-branded title + badge + description, an export-type dropdown, an action button that
// opens an SSE stream to /ai/exports/redaction/draft, and an output panel that shows an animated thinking
// indicator until the first delta, then the streamed redaction plan (or an inline error). The whole card is
// wrapped by `withAiFeature('pii-redaction-shared-exports', …)`, which renders nothing when AI is gated off.
//
// There is no native AIFeatureCard / withAiFeature atom (atomic AI components are the out-of-scope P3
// component-library bundle), so the card scaffold + gate are composed here from the shared atoms (GlassPanel,
// Select, Button, typography, EmptyState, ErrorText) — the same approach the sibling AINLAlertBuilder takes. All
// data flows through the shared [AIPiiRedactionSharedExportsViewModel] (P1/S8); the view performs NO HTTP. Every
// visible string resolves through the i18n catalog (P1/S10) and the surfaces carry merged TalkBack descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is off —
// reproduced as the early return on [RedactionSurface.Hidden]. Every other state renders a non-blank surface
// (the resting card, the thinking indicator, the streamed plan, a friendly empty body, a stale/offline
// last-known body, or a QueryError-equivalent with retry), folding the useAiStream lifecycle onto the P3
// loading / empty / content / error / stale / offline contract (see AIPiiRedactionSharedExportsModel.kt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipiiredactionsharedexports

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `border` on the output panel — a 1px hairline. */
private val OUTPUT_BORDER_WIDTH: Dp = 1.dp

/** Web `bg-white/[0.02]` faint output-panel fill, applied to the neutral surface tint. */
private const val OUTPUT_BG_ALPHA: Float = 0.04f

/** The Helix badge pill's low-alpha accent wash (mirrors the shared Badge wash). */
private const val BADGE_WASH_ALPHA: Float = 0.16f

/**
 * Stateful entry point — the faithful port of the web `AIPiiRedactionSharedExports` surface. Binds the AI gate +
 * plan stream via [source] into an [AIPiiRedactionSharedExportsViewModel], records the one-shot `view.opened`
 * diagnostic, collects the live state, and renders the card. The surface performs no HTTP; [logger] defaults to
 * the process logger and [instanceKey] scopes the ViewModel per placement.
 */
@Composable
fun AIPiiRedactionSharedExports(
    source: AIPiiRedactionSharedExportsSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_PII_REDACTION_SHARED_EXPORTS_SLUG,
) {
    val viewModel: AIPiiRedactionSharedExportsViewModel =
        viewModel(key = instanceKey, factory = AIPiiRedactionSharedExportsViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AIPiiRedactionSharedExportsContent(
        state = state,
        modifier = modifier,
        onExportTypeChange = viewModel::setExportType,
        onGenerate = viewModel::generate,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into a
 * [RedactionSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + export-type Select + action) is
 * always present when the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AIPiiRedactionSharedExportsContent(
    state: AiRedactionPlanState,
    modifier: Modifier = Modifier,
    onExportTypeChange: (String) -> Unit = {},
    onGenerate: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyRedaction(state, nowMs())
    if (surface is RedactionSurface.Hidden) return
    PlanCard(
        surface = surface,
        exportType = state.exportType,
        canStart = state.canStart,
        streaming = state.isStreaming,
        onExportTypeChange = onExportTypeChange,
        onGenerate = onGenerate,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/** The web AIFeatureCard scaffold: a GlassPanel with the header, the Select input, the action row, the output. */
@Composable
private fun PlanCard(
    surface: RedactionSurface,
    exportType: String,
    canStart: Boolean,
    streaming: Boolean,
    onExportTypeChange: (String) -> Unit,
    onGenerate: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            PlanHeader(canStart = canStart)
            ExportTypeField(exportType = exportType, onExportTypeChange = onExportTypeChange)
            PlanActionRow(canStart = canStart, streaming = streaming, onGenerate = onGenerate)
            PlanOutput(surface = surface, onRetry = onRetry)
        }
    }
}

/**
 * The web card header: the title + the Helix badge on one row, then the description, plus the web `emptyHint`
 * ("Pick an export type to enable Helix.") shown until an export type is chosen. Merged for TalkBack.
 */
@Composable
private fun PlanHeader(canStart: Boolean) {
    val title = stringResource(R.string.translation_exports_aiRedaction_title)
    val badge = stringResource(R.string.translation_exports_aiRedaction_badge)
    val description = stringResource(R.string.translation_exports_aiRedaction_description)
    val hint = stringResource(R.string.translation_exports_aiRedaction_noTypeHint)
    val announced = if (canStart) description else "$description $hint"
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = headerAccessibilityLabel(title, badge, announced)
                },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PanelTitle(title)
            HelixBadge(badge)
        }
        BodyText(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!canStart) {
            Caption(hint)
        }
    }
}

/** The web `AIBadge` cyan "Helix" pill: a Helix glyph + label on an info-tinted wash. */
@Composable
private fun HelixBadge(label: String) {
    val accent = TeslaTokens.status.info
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = accent,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(AiRedactionGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The web AIFeatureCard input slot: the export-type Select bound to the surface state (web `exportType` /
 * `setExportType`). It carries a merged TalkBack description (the field's purpose plus its empty-state hint) so
 * the interactive element announces what the dropdown selects.
 */
@Composable
private fun ExportTypeField(
    exportType: String,
    onExportTypeChange: (String) -> Unit,
) {
    val label = stringResource(R.string.translation_exports_aiRedaction_exportTypeLabel)
    val emptyLabel =
        stringResource(R.string.translation_exports_aiRedaction_exportTypePlaceholder) // parity:allow web Select placeholder prop
    Select(
        options = rememberExportTypeOptions(),
        selectedValue = exportType.ifBlank { null },
        onSelect = onExportTypeChange,
        modifier =
            Modifier.semantics(mergeDescendants = true) {
                contentDescription = exportTypeAccessibilityLabel(label, emptyLabel)
            },
        label = label,
        emptyLabel = emptyLabel,
    )
}

/**
 * Resolves the localized [SelectOption]s for the canonical [SHARED_EXPORT_TYPES] catalog. Labels come from the
 * per-type i18n keys (web `t('exports.aiRedaction.exportType.{slug}', …)`); the option value stays the canonical
 * English slug the backend redaction-plan catalog gates on, exactly as the web Select does.
 */
@Composable
private fun rememberExportTypeOptions(): List<SelectOption> {
    val drives = stringResource(R.string.translation_exports_aiRedaction_exportType_drives)
    val charging = stringResource(R.string.translation_exports_aiRedaction_exportType_charging)
    val trips = stringResource(R.string.translation_exports_aiRedaction_exportType_trips)
    val analytics = stringResource(R.string.translation_exports_aiRedaction_exportType_analytics)
    val backup = stringResource(R.string.translation_exports_aiRedaction_exportType_backup)
    val account = stringResource(R.string.translation_exports_aiRedaction_exportType_account)
    return SHARED_EXPORT_TYPES.map { type ->
        val typeLabel =
            when (type) {
                SharedExportType.Drives -> drives
                SharedExportType.Charging -> charging
                SharedExportType.Trips -> trips
                SharedExportType.Analytics -> analytics
                SharedExportType.Backup -> backup
                SharedExportType.Account -> account
            }
        SelectOption(value = type.slug, label = typeLabel)
    }
}

/**
 * The right-aligned "Suggest redactions" action — the web AIFeatureCard button. Disabled until an export type is
 * chosen (web `canStart`) or while a stream is open; the in-flight spinner is the native counterpart of the web
 * "Helix is thinking…" busy label.
 */
@Composable
private fun PlanActionRow(
    canStart: Boolean,
    streaming: Boolean,
    onGenerate: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_exports_aiRedaction_button),
            onClick = onGenerate,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
            leadingIcon = AiRedactionGlyphs.Helix,
        )
    }
}

/**
 * The web AiOutputPanel: the bordered output region. Renders nothing while resting (the web panel is absent until
 * a stream runs) and otherwise a bordered panel carrying the per-state body + a polite live-region announcement
 * so TalkBack reads streamed/failed output as it changes.
 */
@Composable
private fun PlanOutput(
    surface: RedactionSurface,
    onRetry: () -> Unit,
) {
    if (surface is RedactionSurface.Resting || surface is RedactionSurface.Hidden) return
    val labels =
        RedactionOutputLabels(
            working = stringResource(R.string.translation_chatbot_thinking),
            empty = stringResource(R.string.translation_common_noData),
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
        )
    OutputPanel(accessibilityLabel = outputAccessibilityLabel(surface, labels)) {
        when (surface) {
            RedactionSurface.Working -> ThinkingIndicator()
            is RedactionSurface.Live -> PlanProse(surface.text)
            is RedactionSurface.Ready -> ReadyBody(text = surface.text, stale = surface.stale)
            RedactionSurface.Empty -> EmptyBody()
            is RedactionSurface.Cached -> CachedBody(text = surface.text, offline = surface.offline, onRetry = onRetry)
            is RedactionSurface.Failed -> FailedBody(offline = surface.offline, onRetry = onRetry)
            RedactionSurface.Hidden, is RedactionSurface.Resting -> Unit
        }
    }
}

/** The bordered output container — the web `rounded-lg border bg-white/[0.02] p-4` panel. */
@Composable
private fun OutputPanel(
    accessibilityLabel: String?,
    content: @Composable () -> Unit,
) {
    val described =
        if (accessibilityLabel != null) {
            Modifier.semantics {
                liveRegion = LiveRegionMode.Polite
                contentDescription = accessibilityLabel
            }
        } else {
            Modifier
        }
    Surface(
        modifier = Modifier.fillMaxWidth().then(described),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OUTPUT_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(OUTPUT_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) { content() }
    }
}

/**
 * The web AIThinkingIndicator: a Helix glyph + the localized "Helix is thinking…" label, with shimmering
 * skeleton lines beneath it while the first delta is awaited. The shimmer is suppressed under reduced motion (the
 * label alone conveys the state); the label is always present for TalkBack.
 */
@Composable
private fun ThinkingIndicator() {
    val accent = TeslaTokens.status.info
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(AiRedactionGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = 3)
        }
    }
}

/** The streamed redaction-plan prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun PlanProse(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/** The completed plan, preceded by a stale chip when the fetch is older than the freshness window. */
@Composable
private fun ReadyBody(
    text: String,
    stale: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false)
        }
        PlanProse(text)
    }
}

/** The friendly empty body shown when a plan completed with no text (never a blank box). */
@Composable
private fun EmptyBody() {
    EmptyState(message = stringResource(R.string.translation_common_noData))
}

/** A failed re-plan that keeps the last-known plan visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    text: String,
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessChip(offline = offline)
        PlanProse(text)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            RetryButton(onRetry)
        }
    }
}

/** The web error branch with no last-known output — a danger Helix glyph, a localized title, and retry. */
@Composable
private fun FailedBody(
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            AiRedactionGlyphs.Helix,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.danger,
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (offline) {
                FreshnessChip(offline = true)
            }
            ErrorText(stringResource(R.string.translation_queryError_title))
            RetryButton(onRetry)
        }
    }
}

/** The stale/offline freshness chip — the web "last known / offline" affordance. */
@Composable
private fun FreshnessChip(offline: Boolean) {
    val label =
        if (offline) {
            stringResource(R.string.translation_common_offline)
        } else {
            stringResource(R.string.translation_mqtt_stale)
        }
    val accent = TeslaTokens.status.warning
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = accent,
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

/** The shared retry affordance backing the error/offline surfaces. */
@Composable
private fun RetryButton(onRetry: () -> Unit) {
    Button(
        label = stringResource(R.string.translation_common_retry),
        onClick = onRetry,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = FeedbackGlyphs.Refresh,
    )
}

/**
 * The locally authored Helix mark — a four-point sparkle, the AI/Helix brand glyph the web renders as
 * `HelixMark`. It is absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and outside
 * this surface's allowed-files scope, so it is drawn here as a 24×24 stroked [ImageVector] recolored at render
 * time by the [Icon] tint — exactly as the sibling AINLAlertBuilder authors its Helix mark.
 */
private object AiRedactionGlyphs {
    val Helix: ImageVector =
        stroked("AIPiiRedactionHelix") {
            // Four-point concave star centered at (12, 12).
            moveTo(12f, 3f)
            lineTo(13.6f, 10.4f)
            lineTo(21f, 12f)
            lineTo(13.6f, 13.6f)
            lineTo(12f, 21f)
            lineTo(10.4f, 13.6f)
            lineTo(3f, 12f)
            lineTo(10.4f, 10.4f)
            close()
            // Small accent sparkle (cross) at the upper-right.
            moveTo(19f, 3f)
            lineTo(19f, 7f)
            moveTo(21f, 5f)
            lineTo(17f, 5f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each rendered state) ──────────────────────

private const val PREVIEW_NOW_MS = 10_000_000L
private const val PREVIEW_STALE_FETCHED_AT = 1_000L
private const val PREVIEW_FRESH_FETCHED_AT = PREVIEW_NOW_MS - 1_000L
private const val PREVIEW_EXPORT_TYPE = "drives"
private const val PREVIEW_PLAN =
    "Redaction plan for a Drives export — highly recommended: precise GPS coordinates, home/work geofence " +
        "names, charging-site addresses. Optional (consent-gated): VIN, odometer, license plate. Apply by " +
        "toggling the matching options in your export request before sharing."

@Preview(name = "Resting — ready to plan", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsRestingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state = AiRedactionPlanState(exportType = PREVIEW_EXPORT_TYPE),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Resting — needs an export type", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsEmptyInputsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state = AiRedactionPlanState(exportType = ""),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsWorkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state = AiRedactionPlanState(exportType = PREVIEW_EXPORT_TYPE, phase = RedactionPhase.Streaming),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Live — streaming plan", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state =
                AiRedactionPlanState(
                    exportType = PREVIEW_EXPORT_TYPE,
                    phase = RedactionPhase.Streaming,
                    streamingText = PREVIEW_PLAN,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — fresh", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsReadyFreshPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state =
                AiRedactionPlanState(
                    exportType = PREVIEW_EXPORT_TYPE,
                    phase = RedactionPhase.Done,
                    committedText = PREVIEW_PLAN,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — stale", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsReadyStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state =
                AiRedactionPlanState(
                    exportType = PREVIEW_EXPORT_TYPE,
                    phase = RedactionPhase.Done,
                    committedText = PREVIEW_PLAN,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Empty — blank result", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsEmptyResultPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state =
                AiRedactionPlanState(
                    exportType = PREVIEW_EXPORT_TYPE,
                    phase = RedactionPhase.Done,
                    committedText = "",
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Cached — offline last-known", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsCachedOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state =
                AiRedactionPlanState(
                    exportType = PREVIEW_EXPORT_TYPE,
                    phase = RedactionPhase.Failed,
                    committedText = PREVIEW_PLAN,
                    errorKind = ErrorKind.Network,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Failed — offline, no last-known", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsFailedOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state =
                AiRedactionPlanState(
                    exportType = PREVIEW_EXPORT_TYPE,
                    phase = RedactionPhase.Failed,
                    errorKind = ErrorKind.Network,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Failed — server error", showBackground = true)
@Composable
private fun AIPiiRedactionSharedExportsFailedHttpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIPiiRedactionSharedExportsContent(
            state =
                AiRedactionPlanState(
                    exportType = PREVIEW_EXPORT_TYPE,
                    phase = RedactionPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}
