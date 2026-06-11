// The native Jetpack Compose + Material 3 Onboarding Checklist dashboard surface — a parity port of
// web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx. It reproduces the web composition: a
// "Get started" header (rocket icon + dismiss affordance), a progress header (a `{{done}}/{{total}}
// complete` count + percentage + a gradient bar), the task list (each row a complete/incomplete marker, a
// per-task glyph, a title that strikes through when done, a one-line description, and — while incomplete —
// a CTA that navigates), and the celebratory completion footer at 100%. The two short-footprint surfaces
// are reproduced too: the "No setup steps available right now." empty state, and the hidden/dismissed
// state with a Restart affordance. All data flows through the shared [OnboardingChecklistWidgetViewModel];
// the view never performs HTTP. Every string resolves through the i18n catalog (P1/S10) and every
// interactive control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/OnboardingChecklistWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.onboardingchecklist

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 4
private const val PERCENT_DENOMINATOR = 100f
private val PROGRESS_BAR_HEIGHT = 6.dp
private val TASK_GLYPH_BOX = 28.dp
private const val STROKE_WIDTH = 2f

/**
 * Stateful entry point. Binds the aggregated checklist feed via [source] and the persisted [preferences]
 * into an [OnboardingChecklistWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders
 * the surface. A dashboard host supplies [source] (an adapter over the shared S8 Vehicles / Notifications /
 * Settings data layer + the persisted checklist flags), [preferences] (the same persisted-flag port), a
 * unique [instanceKey] per placement, and [onNavigate] (the host's router, which also intercepts the
 * [COMMAND_PALETTE_CTA] sentinel — the web `handleCta`).
 *
 * @param source the cache-then-network checklist-input seam (a [StoreOnboardingChecklistSource] adapter).
 * @param preferences the persisted dismiss / restart / completion write port.
 * @param onNavigate invoked with a task's `ctaTo` when its CTA is tapped (web `navigate` / palette toggle).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun OnboardingChecklistWidget(
    source: OnboardingChecklistSource,
    preferences: OnboardingChecklistPreferences,
    modifier: Modifier = Modifier,
    onNavigate: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = OnboardingChecklistRegistration.ID,
) {
    val viewModel: OnboardingChecklistWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { OnboardingChecklistWidgetViewModel(source, preferences, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    OnboardingChecklistWidgetContent(
        state = state,
        onDismiss = viewModel::dismiss,
        onRestart = viewModel::restart,
        onRefresh = viewModel::refresh,
        onNavigate = onNavigate,
        modifier = modifier,
    )
}

/**
 * Stateless renderer keyed on the [UiState] phase — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (a first load with nothing cached → skeleton; a hard error with no cached
 * fallback → retry) and otherwise projects the inputs and renders the checklist body. [nowMs] is the clock
 * used for the 24h celebration window; it defaults to the wall clock and is overridable in tests.
 */
@Composable
fun OnboardingChecklistWidgetContent(
    state: UiState<OnboardingChecklistInputs>,
    onDismiss: () -> Unit,
    onRestart: () -> Unit,
    onRefresh: () -> Unit,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
    nowMs: Long = System.currentTimeMillis(),
) {
    val strings = rememberOnboardingChecklistStrings()
    val inputs = state.data
    when {
        state.isError -> ErrorChrome(onRefresh, modifier)
        state.isLoading || inputs == null -> LoadingChrome(modifier)
        else -> {
            val resolvedNow = remember { nowMs }
            val data =
                remember(inputs, strings, resolvedNow) {
                    OnboardingChecklistProjection.project(inputs, strings, resolvedNow)
                }
            OnboardingChecklistBody(
                data = data,
                state = state,
                strings = strings,
                onDismiss = onDismiss,
                onRestart = onRestart,
                onNavigate = onNavigate,
                modifier = modifier,
            )
        }
    }
}

/**
 * Stateless body over the already-projected [data] — the render of the web component's three top-level
 * branches in their exact precedence: the hidden/dismissed state first (web `if (hidden)`), then the
 * "no setup steps" empty state (web `totalCount === 0`), otherwise the progress header + task list + the
 * celebratory completion footer. Exposed (not private) so the UI test can exercise the empty branch, which
 * the live projection never produces (every task is always visible, the web `visibleTasks = tasks`).
 */
@Composable
fun OnboardingChecklistBody(
    data: OnboardingChecklistData,
    state: UiState<OnboardingChecklistInputs>,
    strings: OnboardingChecklistStrings,
    onDismiss: () -> Unit,
    onRestart: () -> Unit,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        ChecklistHeader(state = state, strings = strings, showDismiss = !data.hidden, onDismiss = onDismiss)
        if (data.hidden) {
            ChecklistHiddenState(data = data, strings = strings, onRestart = onRestart)
            return@Column
        }
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            ChecklistProgress(data = data, strings = strings)
            if (data.tasks.isEmpty()) {
                ChecklistEmptyState(strings)
            } else {
                data.tasks.forEach { task -> ChecklistTaskRow(task = task, onNavigate = onNavigate) }
            }
            if (data.allComplete) {
                ChecklistCompletionFooter(strings = strings, onDismiss = onDismiss)
            }
        }
    }
}

@Composable
private fun ChecklistHeader(
    state: UiState<OnboardingChecklistInputs>,
    strings: OnboardingChecklistStrings,
    showDismiss: Boolean,
    onDismiss: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(FeedbackGlyphs.Rocket, contentDescription = null, size = IconSize.Sm, tint = ProgressPalette.Cyan)
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        if (state.refreshing || state.stale || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
                fetchingLabel = strings.refreshingLabel,
                errorLabel = strings.offlineLabel,
                formatAge = strings.formatRelative,
            )
        }
        if (showDismiss) {
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = strings.dismiss,
                onClick = onDismiss,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun ChecklistProgress(
    data: OnboardingChecklistData,
    strings: OnboardingChecklistStrings,
) {
    val progressText = strings.progress(data.completeCount, data.totalCount)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(progressText)
            Caption("${data.progressPct}%")
        }
        ProgressBar(progressPct = data.progressPct, allComplete = data.allComplete, accessibleLabel = progressText)
    }
}

@Composable
private fun ProgressBar(
    progressPct: Int,
    allComplete: Boolean,
    accessibleLabel: String,
) {
    val fraction = (progressPct.coerceIn(0, 100)) / PERCENT_DENOMINATOR
    val brush =
        if (allComplete) {
            Brush.horizontalGradient(listOf(ProgressPalette.Emerald, ProgressPalette.Cyan))
        } else {
            Brush.horizontalGradient(listOf(ProgressPalette.Cyan, ProgressPalette.Indigo))
        }
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(PROGRESS_BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .semantics { contentDescription = accessibleLabel },
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(fraction)
                    .height(PROGRESS_BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(brush),
        )
    }
}

@Composable
private fun ChecklistTaskRow(
    task: OnboardingTask,
    onNavigate: (String) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = TASK_ROW_ALPHA))
                .padding(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (task.complete) {
            Icon(DataDisplayGlyphs.CheckCircle, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.success)
        } else {
            Icon(
                OnboardingChecklistGlyphs.Circle,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box(
            modifier =
                Modifier
                    .size(TASK_GLYPH_BOX)
                    .clip(RoundedCornerShape(Radius.sm))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = TASK_GLYPH_ALPHA)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                glyphVector(task.glyph),
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            TaskTitle(text = task.title, complete = task.complete)
            HelperText(task.description)
        }
        if (!task.complete) {
            Button(
                onClick = { onNavigate(task.ctaTo) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            ) {
                Text(task.ctaLabel, style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.size(Spacing.xs))
                Icon(DataDisplayGlyphs.ArrowRight, contentDescription = null, size = IconSize.Sm)
            }
        }
    }
}

@Composable
private fun TaskTitle(
    text: String,
    complete: Boolean,
) {
    // Strikethrough is a completion-state decoration, not a typography role — render through the same M3
    // body slot the typography wrappers use so theme color + the type ramp still apply.
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (complete) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        textDecoration = if (complete) TextDecoration.LineThrough else TextDecoration.None,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ChecklistCompletionFooter(
    strings: OnboardingChecklistStrings,
    onDismiss: () -> Unit,
) {
    val shape = RoundedCornerShape(Radius.md)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(shape)
                .border(1.dp, ProgressPalette.Emerald.copy(alpha = FOOTER_BORDER_ALPHA), shape)
                .background(ProgressPalette.Emerald.copy(alpha = FOOTER_BG_ALPHA))
                .padding(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(OnboardingChecklistGlyphs.Sparkles, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.success)
        Text(
            text = strings.completeMessage,
            style = MaterialTheme.typography.bodyMedium,
            color = TeslaTokens.status.success,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Button(onClick = onDismiss, variant = ButtonVariant.Ghost, size = ButtonSize.Sm) {
            Icon(FeedbackGlyphs.Refresh, contentDescription = null, size = IconSize.Sm)
            Spacer(Modifier.size(Spacing.xs))
            Text(strings.dismiss, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun ChecklistHiddenState(
    data: OnboardingChecklistData,
    strings: OnboardingChecklistStrings,
    onRestart: () -> Unit,
) {
    EmptyState(
        message = strings.dismissedMessage,
        icon = OnboardingChecklistGlyphs.Sparkles,
        title = if (data.allComplete) strings.completeMessage else strings.dismissedTitle,
        action = EmptyStateAction(label = strings.restart, onClick = onRestart),
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun ChecklistEmptyState(strings: OnboardingChecklistStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = DataDisplayGlyphs.CheckCircle,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

/**
 * Builds the localized [OnboardingChecklistStrings] from the i18n catalog (P1/S10): the header + footer +
 * empty + dismissed microcopy, the seven task title/description/CTA triples, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip.
 */
@Composable
private fun rememberOnboardingChecklistStrings(): OnboardingChecklistStrings {
    val title = stringResource(R.string.translation_checklist_title)
    val dismiss = stringResource(R.string.translation_checklist_dismiss)
    val completeMessage = stringResource(R.string.translation_checklist_completeMessage)
    val dismissedTitle = stringResource(R.string.translation_checklist_dismissedTitle)
    val dismissedMessage = stringResource(R.string.translation_checklist_dismissedMessage)
    val restart = stringResource(R.string.translation_checklist_restart)
    val emptyMessage = stringResource(R.string.translation_checklist_empty)
    val progressTemplate = stringResource(R.string.translation_checklist_progress)
    val offline = stringResource(R.string.translation_common_offline)
    val refreshing = stringResource(R.string.translation_common_loading)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    val tasks = rememberTaskCopy()
    return remember(
        title,
        dismiss,
        completeMessage,
        dismissedTitle,
        dismissedMessage,
        restart,
        emptyMessage,
        progressTemplate,
        offline,
        refreshing,
        tasks,
    ) {
        OnboardingChecklistStrings(
            title = title,
            dismiss = dismiss,
            completeMessage = completeMessage,
            dismissedTitle = dismissedTitle,
            dismissedMessage = dismissedMessage,
            restart = restart,
            emptyMessage = emptyMessage,
            offlineLabel = offline,
            refreshingLabel = refreshing,
            progress = { done, total -> String.format(progressTemplate, done, total) },
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
            tasks = tasks,
        )
    }
}

/** The seven task title/description/CTA triples, resolved from the catalog and memoized by their values. */
@Composable
private fun rememberTaskCopy(): Map<OnboardingTaskId, OnboardingTaskCopy> {
    val connectTitle = stringResource(R.string.translation_checklist_tasks_connectVehicle_title)
    val connectDesc = stringResource(R.string.translation_checklist_tasks_connectVehicle_description)
    val connectCta = stringResource(R.string.translation_checklist_tasks_connectVehicle_cta)
    val themeTitle = stringResource(R.string.translation_checklist_tasks_pickTheme_title)
    val themeDesc = stringResource(R.string.translation_checklist_tasks_pickTheme_description)
    val themeCta = stringResource(R.string.translation_checklist_tasks_pickTheme_cta)
    val alertTitle = stringResource(R.string.translation_checklist_tasks_firstAlert_title)
    val alertDesc = stringResource(R.string.translation_checklist_tasks_firstAlert_description)
    val alertCta = stringResource(R.string.translation_checklist_tasks_firstAlert_cta)
    val notifyTitle = stringResource(R.string.translation_checklist_tasks_notify_title)
    val notifyDesc = stringResource(R.string.translation_checklist_tasks_notify_description)
    val notifyCta = stringResource(R.string.translation_checklist_tasks_notify_cta)
    val paletteTitle = stringResource(R.string.translation_checklist_tasks_commandPalette_title)
    val paletteDesc = stringResource(R.string.translation_checklist_tasks_commandPalette_description)
    val paletteCta = stringResource(R.string.translation_checklist_tasks_commandPalette_cta)
    val pushTitle = stringResource(R.string.translation_checklist_tasks_enablePush_title)
    val pushDesc = stringResource(R.string.translation_checklist_tasks_enablePush_description)
    val pushCta = stringResource(R.string.translation_checklist_tasks_enablePush_cta)
    val customizeTitle = stringResource(R.string.translation_checklist_tasks_customizeDashboard_title)
    val customizeDesc = stringResource(R.string.translation_checklist_tasks_customizeDashboard_description)
    val customizeCta = stringResource(R.string.translation_checklist_tasks_customizeDashboard_cta)
    return remember(connectTitle, themeTitle, alertTitle, notifyTitle, paletteTitle, pushTitle, customizeTitle) {
        mapOf(
            OnboardingTaskId.ConnectVehicle to OnboardingTaskCopy(connectTitle, connectDesc, connectCta),
            OnboardingTaskId.PickTheme to OnboardingTaskCopy(themeTitle, themeDesc, themeCta),
            OnboardingTaskId.FirstAlert to OnboardingTaskCopy(alertTitle, alertDesc, alertCta),
            OnboardingTaskId.NotificationChannel to OnboardingTaskCopy(notifyTitle, notifyDesc, notifyCta),
            OnboardingTaskId.CommandPalette to OnboardingTaskCopy(paletteTitle, paletteDesc, paletteCta),
            OnboardingTaskId.EnablePush to OnboardingTaskCopy(pushTitle, pushDesc, pushCta),
            OnboardingTaskId.CustomizeDashboard to OnboardingTaskCopy(customizeTitle, customizeDesc, customizeCta),
        )
    }
}

/** Map an [OnboardingTaskGlyph] to a concrete icon at the render boundary. */
private fun glyphVector(glyph: OnboardingTaskGlyph): ImageVector =
    when (glyph) {
        OnboardingTaskGlyph.Car -> OnboardingChecklistGlyphs.Car
        OnboardingTaskGlyph.Palette -> OnboardingChecklistGlyphs.Palette
        OnboardingTaskGlyph.Bell -> FeedbackGlyphs.Bell
        OnboardingTaskGlyph.Send -> OnboardingChecklistGlyphs.Send
        OnboardingTaskGlyph.Command -> FeedbackGlyphs.Keyboard
        OnboardingTaskGlyph.BellPlus -> OnboardingChecklistGlyphs.BellPlus
        OnboardingTaskGlyph.Grid -> OnboardingChecklistGlyphs.Grid
    }

/** The fixed gradient/accent hues, matching the web source's Tailwind `*-400` classes verbatim. */
private object ProgressPalette {
    val Cyan = Color(0xFF22D3EE)
    val Indigo = Color(0xFF818CF8)
    val Emerald = Color(0xFF34D399)
}

private const val TASK_ROW_ALPHA = 0.25f
private const val TASK_GLYPH_ALPHA = 0.5f
private const val FOOTER_BORDER_ALPHA = 0.4f
private const val FOOTER_BG_ALPHA = 0.12f

/**
 * Line-style checklist glyphs the shared icon set does not provide, authored here as 24x24 stroked vectors
 * — the same approach the navigation + UI layers use (`NavGlyphs` / `TeslaGlyphs`), since Android has no
 * bundled `lucide-react` equivalent without the frozen `material-icons-extended` artifact. The generic
 * Rocket / CheckCircle / ArrowRight / Close / Refresh / Bell / Keyboard glyphs are reused from the shared
 * `components/` sets; these five fill the gap for the web `Circle` / `Sparkles` / `Car` / `Palette` /
 * `Send` / `Grid` / `BellPlus` icons.
 */
private object OnboardingChecklistGlyphs {
    /** Hollow ring (web `Circle`, incomplete-task marker). */
    val Circle: ImageVector = stroked("Circle") { circle(12f, 12f, 8f) }

    /** Four-point star (web `Sparkles`, the celebratory completion marker). */
    val Sparkles: ImageVector =
        stroked("Sparkles") {
            moveTo(12f, 3f)
            lineTo(14.5f, 9.5f)
            lineTo(21f, 12f)
            lineTo(14.5f, 14.5f)
            lineTo(12f, 21f)
            lineTo(9.5f, 14.5f)
            lineTo(3f, 12f)
            lineTo(9.5f, 9.5f)
            close()
        }

    /** Car silhouette (web `Car`, connect-vehicle): a cabin, a body, and two wheels. */
    val Car: ImageVector =
        stroked("Car") {
            moveTo(4f, 14f)
            lineTo(6f, 8f)
            lineTo(18f, 8f)
            lineTo(20f, 14f)
            lineTo(20f, 17f)
            lineTo(4f, 17f)
            close()
            dot(7.5f, 17f)
            dot(16.5f, 17f)
        }

    /** Artist palette (web `Palette`, pick-theme): a disc, three paint wells, and a thumb hole. */
    val Palette: ImageVector =
        stroked("Palette") {
            circle(12f, 12f, 8f)
            dot(9f, 9f)
            dot(15f, 9f)
            dot(9f, 15f)
            circle(14.5f, 14.5f, 1.4f)
        }

    /** Paper plane (web `Send`, notification-channel): an outline plane with a fold seam. */
    val Send: ImageVector =
        stroked("Send") {
            moveTo(22f, 2f)
            lineTo(2f, 9f)
            lineTo(11f, 13f)
            lineTo(15f, 22f)
            lineTo(22f, 2f)
            close()
            moveTo(22f, 2f)
            lineTo(11f, 13f)
        }

    /** Bell with a plus (web `BellPlus`, enable-push): a bell body, clapper, and a small plus badge. */
    val BellPlus: ImageVector =
        stroked("BellPlus") {
            moveTo(8f, 16f)
            lineTo(8f, 11f)
            curveTo(8f, 7f, 16f, 7f, 16f, 11f)
            lineTo(16f, 16f)
            close()
            moveTo(6f, 16f)
            lineTo(18f, 16f)
            dot(12f, 18.5f)
            line(16.5f, 5f, 20.5f, 5f)
            line(18.5f, 3f, 18.5f, 7f)
        }

    /** Four-cell grid (web `LayoutGrid`, customize-dashboard). */
    val Grid: ImageVector =
        stroked("Grid") {
            rect(4f, 4f, 10f, 10f)
            rect(14f, 4f, 20f, 10f)
            rect(4f, 14f, 10f, 20f)
            rect(14f, 14f, 20f, 20f)
        }
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
                strokeLineWidth = STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Axis-aligned closed rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** Straight segment from ([x1], [y1]) to ([x2], [y2]). */
private fun PathBuilder.line(
    x1: Float,
    y1: Float,
    x2: Float,
    y2: Float,
) {
    moveTo(x1, y1)
    lineTo(x2, y2)
}

/** A tiny filled dot, drawn as a very short rounded segment so the stroke cap renders a point. */
private fun PathBuilder.dot(
    cx: Float,
    cy: Float,
) {
    moveTo(cx, cy)
    lineTo(cx + DOT_EPSILON, cy)
}

/** Closed circle of radius [r] centred at ([cx], [cy]), approximated with four cubic Béziers. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    val k = r * CIRCLE_KAPPA
    moveTo(cx, cy - r)
    curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    close()
}

private const val CIRCLE_KAPPA = 0.5523f
private const val DOT_EPSILON = 0.1f
