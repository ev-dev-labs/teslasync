// The native Jetpack Compose + Material 3 BackgroundWorkSegment shared surface — a parity port of
// web/src/components/layout/status-bar/BackgroundWorkSegment.tsx. The web component is a footer status-bar
// segment that surfaces in-flight background work (CSV exports, settings saves, ad-hoc registered jobs): a
// spinning Loader2 + a "1 task" / "{{count}} tasks" summary, wrapped in a Tooltip, that opens a "Running"
// popover listing every job (an icon by kind, the label, an optional description, and a per-row spinner). The
// web hides the whole segment when nothing runs.
//
// This surface is the native equivalent. All data flows through the shared [BackgroundWorkSegmentViewModel]
// over the [BackgroundExportsSource] export seam + the [BackgroundJobRegistry] (P1/S8) — the view performs NO
// HTTP and reads no store directly. Every derivation flows through the pure [foldBackgroundWork] /
// [BackgroundWorkState]; the composable is a thin render layer. The faithful mapping of the web behaviour:
//   • `useBackgroundJobs()` (exports ⊕ mutations ⊕ custom) → [BackgroundWorkSegmentViewModel.state].
//   • the spinning `Loader2` + `KIND_ICON` (FileDown / Save / Sparkles) → the spinning [FeedbackGlyphs.Refresh]
//     and the per-kind row glyph ([FeedbackGlyphs.Download] / [SaveGlyph] / [SparklesGlyph]), suppressed under
//     reduced motion.
//   • the count summary `count === 1 ? '1 task' : '{{count}} tasks'` → [summaryText].
//   • the `iconOnly` prop → the trigger hides the summary text.
//   • the Tooltip (`{tooltip} · {summary}`) → the Material 3 [Tooltip] over the trigger.
//   • the click-toggled, click-outside / Escape-dismissed `role="dialog"` popover with the "Running" heading →
//     the [Popover] with the heading + the job rows.
//   • the `aria-label` (`{aria}: {summary}`) → a single merged semantics node with a polite live region.
//
// States reproduced (every one renders a non-blank, labelled surface — never a hidden box): content (the
// running list, with a stale / offline chip over aged cached export rows), loading (a first export fetch with
// nothing yet — a spinning idle trigger), empty (no work and nothing registered — a friendly idle chip + an
// "all caught up" popover), and error (a hard export-feed failure with no cache — a retry surface). The
// one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BackgroundWorkSegment) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, glyphs, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.backgroundworksegment

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the trigger container — used by the instrumented per-state + a11y UI tests. */
const val BACKGROUND_WORK_SEGMENT_TEST_TAG: String = "background-work-segment"

/** Test tag identifying the open popover surface — used by the instrumented UI tests. */
const val BACKGROUND_WORK_POPOVER_TEST_TAG: String = "background-work-popover"

/** The running-list popover's minimum width (web `min-w-[260px]`). */
private val POPOVER_MIN_WIDTH = 260.dp

/** The running-list popover's maximum height before it scrolls (web `max-h-[280px] overflow-y-auto`). */
private val POPOVER_MAX_HEIGHT = 280.dp

private const val SPIN_PERIOD_MS = 1_000
private const val FULL_ROTATION_DEG = 360f

/**
 * Stateful entry point bound to the shared work signals — the faithful port of the web `BackgroundWorkSegment`
 * over its `useBackgroundJobs()` hook. Binds the [BackgroundWorkSegmentViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11), collects the live [BackgroundWorkState], and hands it to the stateless
 * renderer. The export seam is host-wired (an `ExportsStore.asBackgroundExportsSource()` adapter); the
 * mutation + custom registry defaults to the process-wide [backgroundJobs].
 *
 * @param source the cache-then-network export seam (a `ExportsStore` adapter the host wires).
 * @param modifier optional layout modifier for the trigger container.
 * @param iconOnly hides the count summary text, showing only the spinner glyph (web `iconOnly`).
 * @param registry the mutation + custom-job store (defaults to the process-wide [backgroundJobs]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun BackgroundWorkSegment(
    source: BackgroundExportsSource,
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    registry: BackgroundJobRegistry = backgroundJobs,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val model: BackgroundWorkSegmentViewModel =
        viewModel(
            key = BackgroundWorkSegmentRegistration.ID,
            factory = BackgroundWorkSegmentViewModel.factory(source, logger, registry),
        )
    LaunchedEffect(model) { model.onViewOpened() }
    val state by model.state.collectAsStateWithLifecycle()
    BackgroundWorkSegmentContent(state = state, modifier = modifier, iconOnly = iconOnly, onRetry = model::retry)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the status-bar trigger (a spinner +
 * count summary, an idle chip, or an error glyph by phase) wrapped in a [Tooltip], and the click-toggled
 * "Running" [Popover] listing the work. The trigger is a single accessibility node with a polite live region
 * (web `aria-label`); the popover dismisses on an outside tap / Back. Never blank — every phase renders a
 * labelled trigger, and the popover always shows content (the list, a loading row, an empty state, or a retry).
 *
 * @param state the folded work state to paint.
 * @param modifier optional layout modifier for the trigger container.
 * @param iconOnly hides the count summary text (web `iconOnly`).
 * @param onRetry invoked from the error surface's retry affordance; `null` disables it (previews).
 */
@Composable
fun BackgroundWorkSegmentContent(
    state: BackgroundWorkState,
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    onRetry: (() -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    val reduceMotion = rememberReducedMotion()

    // Web closes the popover when nothing is running (`if (!hasJobs) setOpen(false)`); the native loading /
    // empty phases have no list to act on, so the popover collapses there while staying open-able on content /
    // error (the latter exposing the retry).
    LaunchedEffect(state.phase) {
        if (state.phase == WorkPhase.Empty || state.phase == WorkPhase.Loading) open = false
    }

    Box(modifier = modifier) {
        SegmentTrigger(
            state = state,
            iconOnly = iconOnly,
            reduceMotion = reduceMotion,
            onToggle = { open = !open },
        )
        WorkPopover(
            state = state,
            expanded = open,
            reduceMotion = reduceMotion,
            onDismiss = { open = false },
            onRetry = onRetry,
        )
    }
}

/** The status-bar trigger: a phase-tinted glyph (spinning while work runs) plus the optional summary text. */
@Composable
private fun SegmentTrigger(
    state: BackgroundWorkState,
    iconOnly: Boolean,
    reduceMotion: Boolean,
    onToggle: () -> Unit,
) {
    val aria = stringResource(R.string.translation_statusBar_background_aria)
    val visual = triggerVisual(state)
    val stateLabel = triggerStateLabel(state)
    val tooltip = triggerTooltip(state)

    Tooltip(text = tooltip) {
        Row(
            modifier =
                Modifier
                    .testTag(BACKGROUND_WORK_SEGMENT_TEST_TAG)
                    .clickable(onClickLabel = stateLabel) { onToggle() }
                    .semantics(mergeDescendants = true) {
                        contentDescription = "$aria: $stateLabel"
                        role = Role.Button
                        liveRegion = LiveRegionMode.Polite
                    }.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (visual.spin) {
                SpinningGlyph(visual.glyph, visual.color, IconSize.Xs, reduceMotion)
            } else {
                Icon(visual.glyph, contentDescription = null, size = IconSize.Xs, tint = visual.color)
            }
            if (!iconOnly && visual.text != null) {
                Text(
                    text = visual.text,
                    style = MaterialTheme.typography.labelSmall,
                    color = visual.color,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** The "Running" popover: the work list (with a stale / offline chip), or the loading / empty / error surface. */
@Composable
private fun WorkPopover(
    state: BackgroundWorkState,
    expanded: Boolean,
    reduceMotion: Boolean,
    onDismiss: () -> Unit,
    onRetry: (() -> Unit)?,
) {
    val aria = stringResource(R.string.translation_statusBar_background_aria)
    Popover(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.widthIn(min = POPOVER_MIN_WIDTH).testTag(BACKGROUND_WORK_POPOVER_TEST_TAG),
        alignment = Alignment.TopEnd,
        accessibleName = aria,
    ) {
        when (state.phase) {
            WorkPhase.Content -> RunningList(state = state, reduceMotion = reduceMotion)
            WorkPhase.Loading -> LoadingRow(reduceMotion = reduceMotion)
            WorkPhase.Empty -> EmptyState(message = stringResource(R.string.translation_notifications_bellPopover_emptyTitle))
            WorkPhase.Error -> ErrorBlock(onRetry = onRetry)
        }
    }
}

/** The heading + optional stale/offline chip + one [JobRow] per running job (web the popover body). */
@Composable
private fun RunningList(
    state: BackgroundWorkState,
    reduceMotion: Boolean,
) {
    Column(
        modifier = Modifier.heightIn(max = POPOVER_MAX_HEIGHT).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(stringResource(R.string.translation_statusBar_background_heading))
        if (state.offline || state.stale) {
            FreshnessChip(offline = state.offline)
        }
        state.jobs.forEach { job ->
            JobRow(job = job, reduceMotion = reduceMotion)
        }
    }
}

/** One running-job row: the kind glyph, the label + optional description, and the trailing in-flight spinner. */
@Composable
private fun JobRow(
    job: BackgroundJob,
    reduceMotion: Boolean,
) {
    val label = rowLabel(job)
    val description = rowDescription(job)
    val spoken = listOfNotNull(label, description).joinToString(separator = ". ")
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = spoken }
                .padding(horizontal = Spacing.xs, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            kindGlyph(job.kind),
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (description != null) {
                Text(
                    text = description,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        SpinningGlyph(FeedbackGlyphs.Refresh, TeslaTokens.status.warning, IconSize.Xs, reduceMotion)
    }
}

/** The "offline / last known" or "stale" chip shown above the list when the cached export rows are aged. */
@Composable
private fun FreshnessChip(offline: Boolean) {
    val text =
        if (offline) {
            stringResource(R.string.translation_common_offline)
        } else {
            stringResource(R.string.translation_insights_stale)
        }
    Row(
        modifier = Modifier.padding(horizontal = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            FeedbackGlyphs.WifiOff,
            contentDescription = null,
            size = IconSize.Xs,
            tint = TeslaTokens.status.warning,
        )
        Caption(text)
    }
}

/** The popover's first-load surface: a spinner + "Loading…" (web the segment before any job resolves). */
@Composable
private fun LoadingRow(reduceMotion: Boolean) {
    Row(
        modifier = Modifier.padding(Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SpinningGlyph(FeedbackGlyphs.Refresh, TeslaTokens.status.warning, IconSize.Sm, reduceMotion)
        Caption(stringResource(R.string.translation_common_loading))
    }
}

/** The popover's hard-error surface: the failure title and a retry affordance (the web has no such state). */
@Composable
private fun ErrorBlock(onRetry: (() -> Unit)?) {
    Column(
        modifier = Modifier.padding(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                FeedbackGlyphs.WifiOff,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.danger,
            )
            Caption(stringResource(R.string.translation_queryError_title))
        }
        if (onRetry != null) {
            Button(
                stringResource(R.string.translation_queryError_retry),
                onClick = onRetry,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** A glyph that spins while work is in flight (web `animate-spin`), held still under reduced motion. */
@Composable
private fun SpinningGlyph(
    icon: ImageVector,
    color: Color,
    size: IconSize,
    reduceMotion: Boolean,
) {
    val rotation =
        if (reduceMotion) {
            0f
        } else {
            val transition = rememberInfiniteTransition(label = "backgroundWorkSpin")
            val degrees by transition.animateFloat(
                initialValue = 0f,
                targetValue = FULL_ROTATION_DEG,
                animationSpec = infiniteRepeatable(tween(SPIN_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
                label = "spinDegrees",
            )
            degrees
        }
    Icon(icon, contentDescription = null, modifier = Modifier.rotate(rotation), size = size, tint = color)
}

// ── Pure render helpers (resolve the model's semantic state to localized strings + colors) ──────────────────

/** The trigger's glyph + color + summary text + spin flag for the current phase. */
private data class TriggerVisual(
    val glyph: ImageVector,
    val color: Color,
    val text: String?,
    val spin: Boolean,
)

@Composable
private fun triggerVisual(state: BackgroundWorkState): TriggerVisual =
    when (state.phase) {
        WorkPhase.Content ->
            TriggerVisual(FeedbackGlyphs.Refresh, TeslaTokens.status.warning, summaryText(state.count), spin = true)
        WorkPhase.Loading ->
            TriggerVisual(
                glyph = FeedbackGlyphs.Refresh,
                color = TeslaTokens.status.warning,
                text = stringResource(R.string.translation_common_loading),
                spin = true,
            )
        WorkPhase.Empty ->
            TriggerVisual(TeslaGlyphs.Check, MaterialTheme.colorScheme.onSurfaceVariant, text = null, spin = false)
        WorkPhase.Error ->
            TriggerVisual(
                glyph = FeedbackGlyphs.WifiOff,
                color = TeslaTokens.status.danger,
                text = stringResource(R.string.translation_queryError_title),
                spin = false,
            )
    }

/** The PII-free state word interpolated into the trigger's `{aria}: {state}` accessibility label. */
@Composable
private fun triggerStateLabel(state: BackgroundWorkState): String =
    when (state.phase) {
        WorkPhase.Content -> summaryText(state.count)
        WorkPhase.Loading -> stringResource(R.string.translation_common_loading)
        WorkPhase.Empty -> stringResource(R.string.translation_Idle)
        WorkPhase.Error -> stringResource(R.string.translation_queryError_title)
    }

/** The Tooltip text — the web `{tooltip} · {summary}` for content, a phase word otherwise. */
@Composable
private fun triggerTooltip(state: BackgroundWorkState): String =
    when (state.phase) {
        WorkPhase.Content ->
            stringResource(R.string.translation_statusBar_background_tooltip) + " · " + summaryText(state.count)
        WorkPhase.Loading -> stringResource(R.string.translation_common_loading)
        WorkPhase.Empty -> stringResource(R.string.translation_Idle)
        WorkPhase.Error -> stringResource(R.string.translation_queryError_title)
    }

/** The count summary — web `count === 1 ? '1 task' : '{{count}} tasks'`. */
@Composable
private fun summaryText(count: Int): String =
    if (count == 1) {
        stringResource(R.string.translation_statusBar_background_one)
    } else {
        stringResource(R.string.translation_statusBar_background_many, count)
    }

/** The row title — the caller-localized / server label, falling back to a localized [BackgroundJobKind] default. */
@Composable
private fun rowLabel(job: BackgroundJob): String =
    job.label?.takeUnless { it.isBlank() } ?: when (job.kind) {
        BackgroundJobKind.Export -> stringResource(R.string.translation_export_jobDrawer_recentLabel)
        BackgroundJobKind.Mutation -> stringResource(R.string.translation_common_saving)
        BackgroundJobKind.Custom -> stringResource(R.string.translation_common_loading)
    }

/** The row's secondary line — the localized export progress, else the caller-localized description, else none. */
@Composable
private fun rowDescription(job: BackgroundJob): String? =
    when (job.detail) {
        ExportProgress.Queued -> stringResource(R.string.translation_export_status_queued)
        ExportProgress.Processing -> stringResource(R.string.translation_export_status_processing)
        ExportProgress.None -> job.description?.takeUnless { it.isBlank() }
    }

/** Maps the work kind to its row glyph — web `KIND_ICON` (export → FileDown, mutation → Save, custom → Sparkles). */
private fun kindGlyph(kind: BackgroundJobKind): ImageVector =
    when (kind) {
        BackgroundJobKind.Export -> FeedbackGlyphs.Download
        BackgroundJobKind.Mutation -> SaveGlyph
        BackgroundJobKind.Custom -> SparklesGlyph
    }

// ── Local glyphs (the web lucide Save + Sparkles; authored here as 24×24 stroked vectors like the sibling
// glyph sets, recolored at render time by the Icon tint — neither TeslaGlyphs nor FeedbackGlyphs ships them). ─

/** The "save" glyph (the web lucide `Save` — the mutation kind icon): a disk body with a slot + label panel. */
private val SaveGlyph: ImageVector =
    strokedGlyph("Save") {
        moveTo(5f, 4f)
        lineTo(16f, 4f)
        lineTo(20f, 8f)
        lineTo(20f, 20f)
        lineTo(4f, 20f)
        lineTo(4f, 5f)
        close()
        moveTo(8f, 4f)
        lineTo(8f, 8f)
        lineTo(14f, 8f)
        lineTo(14f, 4f)
        moveTo(7f, 20f)
        lineTo(7f, 13f)
        lineTo(17f, 13f)
        lineTo(17f, 20f)
    }

/** The "sparkles" glyph (the web lucide `Sparkles` — the custom kind icon): a four-point star plus a small one. */
private val SparklesGlyph: ImageVector =
    strokedGlyph("Sparkles") {
        moveTo(11f, 3f)
        lineTo(12.4f, 8.6f)
        lineTo(18f, 10f)
        lineTo(12.4f, 11.4f)
        lineTo(11f, 17f)
        lineTo(9.6f, 11.4f)
        lineTo(4f, 10f)
        lineTo(9.6f, 8.6f)
        close()
        moveTo(18f, 15f)
        lineTo(18.6f, 17.4f)
        lineTo(21f, 18f)
        lineTo(18.6f, 18.6f)
        lineTo(18f, 21f)
        lineTo(17.4f, 18.6f)
        lineTo(15f, 18f)
        lineTo(17.4f, 17.4f)
        close()
    }

/** Builds a 24×24 monochrome stroked [ImageVector] (the sibling [FeedbackGlyphs] authoring convention). */
private fun strokedGlyph(
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

// ── Previews — one per phase plus the icon-only and offline branches (tooling-only sample data). ────────────

private const val PREVIEW_START_A = "2026-06-13T10:00:00Z"
private const val PREVIEW_START_B = "2026-06-13T10:01:00Z"

private val previewExportJob =
    BackgroundJob(
        id = "export:42",
        kind = BackgroundJobKind.Export,
        startedAtIso = PREVIEW_START_A,
        label = "drives-2026-06.csv",
        detail = ExportProgress.Processing,
    )
private val previewMutationJob =
    BackgroundJob(
        id = "tanstack-mutations",
        kind = BackgroundJobKind.Mutation,
        startedAtIso = PREVIEW_START_B,
        label = "Saving…",
    )
private val previewCustomJob =
    BackgroundJob(
        id = "backup",
        kind = BackgroundJobKind.Custom,
        startedAtIso = PREVIEW_START_B,
        label = "Generating backup",
        description = "Bundling your account data",
    )

@Preview(name = "Content — one task", showBackground = true)
@Composable
private fun BackgroundWorkOnePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkSegmentContent(state = BackgroundWorkState(WorkPhase.Content, listOf(previewExportJob)))
    }
}

@Preview(name = "Content — many tasks", showBackground = true)
@Composable
private fun BackgroundWorkManyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkSegmentContent(
            state = BackgroundWorkState(WorkPhase.Content, listOf(previewExportJob, previewMutationJob, previewCustomJob)),
        )
    }
}

@Preview(name = "Content — offline (last known)", showBackground = true)
@Composable
private fun BackgroundWorkOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkSegmentContent(
            state = BackgroundWorkState(WorkPhase.Content, listOf(previewExportJob), stale = true, offline = true),
        )
    }
}

@Preview(name = "Content — icon only", showBackground = true)
@Composable
private fun BackgroundWorkIconOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkSegmentContent(
            state = BackgroundWorkState(WorkPhase.Content, listOf(previewExportJob, previewMutationJob)),
            iconOnly = true,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun BackgroundWorkLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkSegmentContent(state = BackgroundWorkState.loading())
    }
}

@Preview(name = "Empty — all caught up", showBackground = true)
@Composable
private fun BackgroundWorkEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkSegmentContent(state = BackgroundWorkState(WorkPhase.Empty, emptyList()))
    }
}

@Preview(name = "Error — retry", showBackground = true)
@Composable
private fun BackgroundWorkErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkSegmentContent(
            state = BackgroundWorkState(WorkPhase.Error, emptyList(), errorKind = ErrorKind.Network),
            onRetry = {},
        )
    }
}
