// The native Jetpack Compose + Material 3 UUID Generator surface — a parity port of the web tool
// (web/src/features/admin/components/devtools/tools/UuidGenerator.tsx). It reproduces the web composition: a
// tool card (purple Fingerprint icon chip + title + description) over a "Generate" button (a RefreshCw icon)
// and a newest-first list of generated UUIDs, each rendered as monospace code with a copy affordance and
// capped at the most recent ten. All data flows through the shared [UuidGeneratorViewModel] (P1/S8); the view
// performs no I/O and the ids are generated on-device, so the surface works fully offline. Every string
// resolves through the i18n facade (P1/S10) — the Generate button via `R.string.translation_Generate`, the
// state chrome via the shared `translation_common_*` / `translation_error_*` keys, and the web tool's own
// card title/description (absent from the shared catalog upstream, exactly as on web) via i18next's
// key-as-fallback, the same approach the sibling HashCalculator surface takes. Every interactive element
// carries an accessibility label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UuidGenerator) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.uuidgenerator

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

private val CHIP_SIZE = 40.dp
private val CHIP_CORNER = Radius.md
private const val CHIP_BG_ALPHA = 0.12f
private const val CHIP_BORDER_ALPHA = 0.28f
private val ROW_CORNER = Radius.md
private const val ROW_BG_ALPHA = 0.5f
private val LIST_MIN_HEIGHT = 96.dp
private const val SKELETON_ROWS = 3
private val SKELETON_ROW_HEIGHT = 28.dp

// The web tool's `t(...)` card title/description keys that the shared catalog (P1/S10) does not define
// upstream. i18next renders the key text itself in that case (the web tool shows exactly these strings), so
// the surface reproduces that key-as-fallback by using the key directly — the same approach the sibling
// HashCalculator surface takes. The Generate button + state chrome below resolve through real catalog entries.
private const val KEY_TITLE = "Uuid Generator"
private const val KEY_DESC = "Uuid Generator Desc"

/**
 * Stateful entry point. Collects the shared [UuidGeneratorViewModel] state, records the one-shot `view.opened`
 * diagnostic (P1/S11), and renders the surface. A host supplies the view-model (wired via
 * [UuidGeneratorViewModel.factory]).
 *
 * @param viewModel the state holder bound to the on-device UUID generator.
 */
@Composable
fun UuidGenerator(
    viewModel: UuidGeneratorViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    UuidGeneratorContent(
        state = state,
        modifier = modifier,
        onGenerate = viewModel::generate,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless UUID Generator surface — renders the always-present tool card (icon + title + description), the
 * Generate button, and the result region for every state: a loading skeleton while the first id generates,
 * the error state + retry (hard failure with nothing to show), the data-empty hint (web `uuids.length === 0`),
 * the generated list + per-row copy (web result rows), plus the stale / offline freshness chip over a
 * last-known list. Hoisted out of the ViewModel so each state is preview- and screenshot-testable with
 * hand-built [UiState] inputs.
 */
@Composable
fun UuidGeneratorContent(
    state: UiState<UuidBatch>,
    modifier: Modifier = Modifier,
    onGenerate: () -> Unit = {},
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        UuidToolHeader()
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (state.stale || state.hasError || state.refreshing) {
                UuidFreshness(state = state, onRefresh = onRefresh)
            }
            Button(
                label = stringResource(R.string.translation_Generate),
                onClick = onGenerate,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                loading = state.isLoading || state.refreshing,
                leadingIcon = FeedbackGlyphs.Refresh,
            )
            UuidResult(state = state, onRetry = onRetry)
        }
    }
}

/** The tool-card header — the purple Fingerprint icon chip + title + description (web `ToolCard` head). */
@Composable
private fun UuidToolHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        UuidIconChip()
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(KEY_TITLE)
            Caption(KEY_DESC)
        }
    }
}

/** The colored, rounded icon chip behind the Fingerprint glyph (web purple `ICON_COLOR_MAP` chip). */
@Composable
private fun UuidIconChip() {
    val color = TeslaTokens.chart.power
    Box(
        modifier =
            Modifier
                .size(CHIP_SIZE)
                .clip(RoundedCornerShape(CHIP_CORNER))
                .background(color.copy(alpha = CHIP_BG_ALPHA))
                .border(1.dp, color.copy(alpha = CHIP_BORDER_ALPHA), RoundedCornerShape(CHIP_CORNER)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = UuidGeneratorGlyphs.Fingerprint, contentDescription = null, size = IconSize.Lg, tint = color)
    }
}

/** The result region — one of loading / error / content / empty, never a blank box. */
@Composable
private fun UuidResult(
    state: UiState<UuidBatch>,
    onRetry: () -> Unit,
) {
    val batch = state.data
    when {
        state.isLoading -> UuidListLoading()
        state.isError -> UuidListError(onRetry = onRetry)
        batch != null && !batch.isBlank -> UuidList(batch = batch)
        else -> UuidListEmpty()
    }
}

/** The generated UUIDs, newest first — each a monospace code row with a copy affordance (web result rows). */
@Composable
private fun UuidList(batch: UuidBatch) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        batch.ids.forEach { id -> UuidRow(id = id) }
    }
}

/** One generated UUID — the mono [id] beside a copy control, on a tinted surface (web overlay row). */
@Composable
private fun UuidRow(id: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(ROW_CORNER))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ROW_BG_ALPHA))
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(text = id, modifier = Modifier.weight(1f))
        CopyButton(
            text = id,
            copyLabel = stringResource(R.string.translation_common_copyButton_copy),
            copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
            iconOnly = true,
        )
    }
}

/** The data-empty hint shown before the first Generate (web hides the list; native shows guidance). */
@Composable
private fun UuidListEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = UuidGeneratorGlyphs.Fingerprint,
        modifier = Modifier.fillMaxWidth().heightIn(min = LIST_MIN_HEIGHT),
    )
}

/** The generating skeleton — shimmering id-row shapes with an accessible "loading" label. */
@Composable
private fun UuidListLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = LIST_MIN_HEIGHT).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        repeat(SKELETON_ROWS) { Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true) }
    }
}

/** The error state — the shared server-error message with a retry affordance (web `QueryError` equivalent). */
@Composable
private fun UuidListError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth().heightIn(min = LIST_MIN_HEIGHT),
    )
}

/** The stale / offline freshness chip + re-generate control, shown only over a degraded last-known list. */
@Composable
private fun UuidFreshness(
    state: UiState<UuidBatch>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
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

// ── Previews — one per rendered state (content / empty / loading / error / offline) ──────────────────────

private val PREVIEW_IDS =
    listOf(
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "9a7b3c2d-1e4f-4a6b-8c9d-0e1f2a3b4c5d",
        "550e8400-e29b-41d4-a716-446655440000",
    )
private val PREVIEW_BATCH = UuidBatch(PREVIEW_IDS)
private const val PREVIEW_NOW = 1_780_000_000_000L

@Preview(name = "UuidGenerator · content", showBackground = true)
@Composable
private fun UuidGeneratorContentPreview() {
    TeslaSyncTheme {
        UuidGeneratorContent(state = UiState(phase = UiPhase.Content, data = PREVIEW_BATCH, fetchedAt = PREVIEW_NOW))
    }
}

@Preview(name = "UuidGenerator · empty", showBackground = true)
@Composable
private fun UuidGeneratorEmptyPreview() {
    TeslaSyncTheme {
        UuidGeneratorContent(state = UiState(phase = UiPhase.Empty, data = UuidBatch.EMPTY, fetchedAt = PREVIEW_NOW))
    }
}

@Preview(name = "UuidGenerator · loading", showBackground = true)
@Composable
private fun UuidGeneratorLoadingPreview() {
    TeslaSyncTheme {
        UuidGeneratorContent(state = UiState.loading())
    }
}

@Preview(name = "UuidGenerator · error", showBackground = true)
@Composable
private fun UuidGeneratorErrorPreview() {
    TeslaSyncTheme {
        UuidGeneratorContent(state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown))
    }
}

@Preview(name = "UuidGenerator · offline", showBackground = true)
@Composable
private fun UuidGeneratorOfflinePreview() {
    TeslaSyncTheme {
        UuidGeneratorContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_BATCH,
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
        )
    }
}
