// The native Jetpack Compose + Material 3 AISettings feature view — a parity port of
// web/src/features/settings/components/AISettings.tsx. It reproduces the surface that file owns end to end:
// the branded header (HelixMark + title + subtitle), the three-way mode picker (off / local-only / cloud) with
// per-mode hints and the off banner, the live "today's Helix spend" cost-cap bar (the web `AICostCapSpendBar`),
// and the save button. Every lifecycle state the shared cache-then-network settings feed can carry is rendered
// — loading skeleton chrome, a friendly empty state, a hard-error retry surface, and stale/offline "last
// known" with a freshness chip + auto-refresh — so the panel is never a blank box. The view performs NO HTTP:
// it binds the [AISettingsViewModel] (P1/S8) and renders.
//
// The per-provider section, per-feature toggle list, archive-restore panel, and usage card the web file
// composes are SEPARATE surfaces (`AIProviderSection` / `AIFeatureToggleList` / `AIRestorePanel` /
// `AIUsageCard`) with their own P3 prompts, so they are intentionally not ported here — a deliberate scope
// boundary declared so there is no silent drift. HelixMark has no bundled Android asset, so it is authored as a
// stroked vector in the shared monochrome style (mirroring `components/ui/Logo`), recolored by the icon box.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/AISettings) cannot form a valid Kotlin package and the file hosts
// several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.aisettings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.PI
import kotlin.math.sin

private const val PANEL_FADE_DELAY_MS = 160
private const val SELECTED_BG_ALPHA = 0.12f
private val HELIX_MARK_SIZE = 22.dp
private val SPEND_BAR_HEIGHT = 8.dp
private val MODE_SKELETON_HEIGHT = 58.dp
private val SAVE_SKELETON_HEIGHT = 36.dp
private const val SAVE_SKELETON_WIDTH_FRACTION = 0.45f

// HelixMark geometry (normalized to the canvas' min dimension).
private const val HELIX_TOP = 0.12f
private const val HELIX_BOTTOM = 0.88f
private const val HELIX_AMPLITUDE = 0.24f
private const val HELIX_STROKE = 0.085f
private const val HELIX_RUNG_STROKE = 0.06f
private const val HELIX_TURNS = 1.5f
private const val HELIX_SEGMENTS = 28
private const val HELIX_RUNGS = 3

/**
 * Stateful entry point for the AISettings surface. Binds the [viewModel] (P1/S8), records the one-shot PII-safe
 * `view.opened` diagnostic, and renders every lifecycle state the settings feed can carry. The host constructs
 * the view-model via [AISettingsViewModel.create]; this view never performs HTTP.
 */
@Composable
fun AISettings(
    viewModel: AISettingsViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val settingsState by viewModel.settings.collectAsStateWithLifecycle()
    val usageState by viewModel.usageToday.collectAsStateWithLifecycle()
    val saving by viewModel.saving.collectAsStateWithLifecycle()

    AISettingsContent(
        settingsState = settingsState,
        usageState = usageState,
        saving = saving,
        onSave = viewModel::save,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer of the surface — the unit/UI-test entry point. Reproduces the web layout (header → mode
 * picker → off banner / cost-cap bar → save) and every lifecycle branch: loading skeleton chrome, a hard-error
 * retry surface, a blank-document empty state, and the populated panel with its freshness chip. Stale (non-error)
 * data auto-refreshes via [onRetry], mirroring the sibling surfaces' freshness contract.
 */
@Composable
fun AISettingsContent(
    settingsState: UiState<AiSettingsProjection>,
    usageState: UiState<AiUsageToday>,
    saving: Boolean,
    onSave: (HelixMode) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(settingsState.stale, settingsState.refreshing, settingsState.hasError) {
        if (settingsState.stale && !settingsState.refreshing && !settingsState.hasError) onRetry()
    }

    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            AISettingsHeader()
            Spacer(Modifier.height(Spacing.lg))
            when (settingsState.phase) {
                UiPhase.Loading -> LoadingChrome()
                UiPhase.Error -> ErrorChrome(onRetry)
                UiPhase.Empty -> EmptyChrome()
                UiPhase.Content ->
                    settingsState.data?.let { projection ->
                        LoadedBody(
                            projection = projection,
                            usageState = usageState,
                            offline = settingsState.isOffline,
                            fetchedAt = settingsState.fetchedAt,
                            refreshing = settingsState.refreshing,
                            saving = saving,
                            onSave = onSave,
                        )
                    }
            }
        }
    }
}

// ── Header ─────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun AISettingsHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Primary) {
            HelixMark(tint = iconColorFor(IconBoxTone.Primary), modifier = Modifier.size(HELIX_MARK_SIZE))
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(stringResource(R.string.translation_ai_settings_title))
            Subhead(stringResource(R.string.translation_ai_settings_subtitle))
        }
    }
}

/**
 * The Helix brand mark — two interleaving helix strands joined by rungs, drawn natively with [Canvas] (no SVG)
 * in the shared monochrome style so it recolors with the active theme / icon-box tone. Mirrors web `HelixMark`.
 */
@Composable
private fun HelixMark(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Canvas(modifier = modifier) {
        val side = size.minDimension
        val centerX = size.width / 2f
        val top = side * HELIX_TOP
        val bottom = side * HELIX_BOTTOM
        val amplitude = side * HELIX_AMPLITUDE

        fun strand(phase: Float): Path =
            Path().apply {
                for (i in 0..HELIX_SEGMENTS) {
                    val fraction = i / HELIX_SEGMENTS.toFloat()
                    val y = top + (bottom - top) * fraction
                    val x = centerX + amplitude * sin(fraction * HELIX_TURNS * 2f * PI.toFloat() + phase)
                    if (i == 0) moveTo(x, y) else lineTo(x, y)
                }
            }
        drawPath(strand(0f), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
        drawPath(strand(PI.toFloat()), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
        for (k in 1..HELIX_RUNGS) {
            val fraction = k / (HELIX_RUNGS + 1).toFloat()
            val y = top + (bottom - top) * fraction
            val angle = fraction * HELIX_TURNS * 2f * PI.toFloat()
            drawLine(
                color = tint,
                start = Offset(centerX + amplitude * sin(angle), y),
                end = Offset(centerX + amplitude * sin(angle + PI.toFloat()), y),
                strokeWidth = side * HELIX_RUNG_STROKE,
                cap = StrokeCap.Round,
            )
        }
    }
}

// ── Loaded body ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun LoadedBody(
    projection: AiSettingsProjection,
    usageState: UiState<AiUsageToday>,
    offline: Boolean,
    fetchedAt: Long?,
    refreshing: Boolean,
    saving: Boolean,
    onSave: (HelixMode) -> Unit,
) {
    // Reset the local mode when the underlying document changes value (web's reset on the AI-subtree snapshot),
    // while preserving an in-progress local edit when a refetch returns the same document.
    var mode by remember(projection) { mutableStateOf(projection.mode) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (offline) {
            DataFreshness(
                updatedAtMillis = fetchedAt,
                isFetching = refreshing,
                isStale = true,
                isError = true,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_common_offline),
            )
        }
        ModePicker(selected = mode, onSelect = { mode = it })
        if (mode == HelixMode.Off) {
            HelperText(stringResource(R.string.translation_ai_settings_bannerOff))
        }
        if (mode == HelixMode.Cloud && projection.costCapCents > 0L) {
            CostCapSpendBar(usageState = usageState, capCents = projection.costCapCents)
        }
        SaveRow(saving = saving, onSave = { onSave(mode) })
    }
}

// ── Mode picker ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ModePicker(
    selected: HelixMode,
    onSelect: (HelixMode) -> Unit,
) {
    Column(
        modifier = Modifier.selectableGroup(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(stringResource(R.string.translation_ai_settings_modeLegend))
        ModeOption(
            mode = HelixMode.Off,
            selected = selected,
            onSelect = onSelect,
            label = stringResource(R.string.translation_ai_settings_mode_off),
            hint = stringResource(R.string.translation_ai_settings_mode_offHint),
        )
        ModeOption(
            mode = HelixMode.Local,
            selected = selected,
            onSelect = onSelect,
            label = stringResource(R.string.translation_ai_settings_mode_local),
            hint = stringResource(R.string.translation_ai_settings_mode_localHint),
        )
        ModeOption(
            mode = HelixMode.Cloud,
            selected = selected,
            onSelect = onSelect,
            label = stringResource(R.string.translation_ai_settings_mode_cloud),
            hint = stringResource(R.string.translation_ai_settings_mode_cloudHint),
        )
    }
}

@Composable
private fun ModeOption(
    mode: HelixMode,
    selected: HelixMode,
    onSelect: (HelixMode) -> Unit,
    label: String,
    hint: String,
) {
    val isSelected = mode == selected
    val borderColor = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    val fill = if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = SELECTED_BG_ALPHA) else Color.Transparent
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .selectable(selected = isSelected, role = Role.RadioButton, onClick = { onSelect(mode) })
                .background(fill)
                .border(width = 1.dp, color = borderColor, shape = RoundedCornerShape(Radius.md))
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        RadioButton(selected = isSelected, onClick = null)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(label)
            HelperText(hint)
        }
    }
}

// ── Cost-cap spend bar (web AICostCapSpendBar) ─────────────────────────────────────────────────────────────

@Composable
private fun CostCapSpendBar(
    usageState: UiState<AiUsageToday>,
    capCents: Long,
) {
    val spend = projectCostCapSpend(usageState.data?.costMicroCents ?: 0L, capCents)
    val color = spendColor(spend.level)
    val barLabel = stringResource(R.string.ai_settings_cost_cap_bar_label)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.lg))
                .border(width = 1.dp, color = MaterialTheme.colorScheme.outlineVariant, shape = RoundedCornerShape(Radius.lg))
                .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Caption(stringResource(R.string.ai_settings_cost_cap_today_title))
            Text(
                text =
                    if (usageState.isLoading) {
                        stringResource(R.string.ai_settings_cost_cap_loading)
                    } else {
                        stringResource(R.string.ai_settings_cost_cap_amount, spend.spent, spend.cap)
                    },
                style = MaterialTheme.typography.labelMedium,
                color = color,
            )
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(SPEND_BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .semantics {
                        contentDescription = barLabel
                        progressBarRangeInfo = ProgressBarRangeInfo(spend.percent.toFloat(), 0f..100f)
                    },
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(spend.fraction)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(color),
            )
        }
        when (spend.level) {
            SpendLevel.Critical -> HelperText(stringResource(R.string.ai_settings_cost_cap_critical_hint))
            SpendLevel.Warn -> HelperText(stringResource(R.string.ai_settings_cost_cap_warn_hint))
            SpendLevel.Ok -> Unit
        }
    }
}

@Composable
private fun spendColor(level: SpendLevel): Color =
    when (level) {
        SpendLevel.Ok -> MaterialTheme.colorScheme.primary
        SpendLevel.Warn -> TeslaTokens.status.warning
        SpendLevel.Critical -> TeslaTokens.status.danger
    }

// ── Save row ───────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SaveRow(
    saving: Boolean,
    onSave: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label =
                if (saving) {
                    stringResource(R.string.translation_ai_settings_saving)
                } else {
                    stringResource(R.string.translation_ai_settings_save)
                },
            onClick = onSave,
            variant = ButtonVariant.Primary,
            enabled = !saving,
            loading = saving,
        )
    }
}

// ── State chrome ───────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ColumnScope.LoadingChrome() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(HELIX_RUNGS) { Skeleton(height = MODE_SKELETON_HEIGHT, rounded = true) }
        Skeleton(widthFraction = SAVE_SKELETON_WIDTH_FRACTION, height = SAVE_SKELETON_HEIGHT, rounded = true)
    }
}

@Composable
private fun ErrorChrome(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

@Composable
private fun EmptyChrome() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        title = stringResource(R.string.translation_ai_settings_title),
    )
}

// ── Previews ───────────────────────────────────────────────────────────────────────────────────────────────

@Preview(showBackground = true)
@Composable
private fun AISettingsCloudPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AISettingsContent(
            settingsState = UiState(UiPhase.Content, AiSettingsProjection(HelixMode.Cloud, costCapCents = 500L, present = true)),
            usageState = UiState(UiPhase.Content, AiUsageToday(costMicroCents = 4_200_000L)),
            saving = false,
            onSave = {},
            onRetry = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun AISettingsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AISettingsContent(
            settingsState = UiState(UiPhase.Loading),
            usageState = UiState(UiPhase.Loading),
            saving = false,
            onSave = {},
            onRetry = {},
        )
    }
}
