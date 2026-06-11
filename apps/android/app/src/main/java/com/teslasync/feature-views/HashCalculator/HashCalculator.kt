// The native Jetpack Compose + Material 3 Hash Calculator surface — a parity port of the web tool
// (web/src/features/admin/components/devtools/tools/HashCalculator.tsx). It reproduces the web composition: a
// tool card (colored icon chip + title + description) over a labeled multi-line input, a "Compute Sha256"
// button that shows a spinner while the digest runs, and a result row that renders the lowercase hex SHA-256
// with a copy affordance. All data flows through the shared [HashCalculatorViewModel] (P1/S8); the view
// performs no I/O and the digest is computed on-device, so the surface works fully offline. Every string
// resolves through the i18n facade (P1/S10) — the compute button + state chrome via `R.string`, and the web
// tool's own keys (absent from the shared catalog upstream) via i18next's key-as-fallback, exactly as the
// sibling client-utility surfaces do. Every interactive element carries an accessibility label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HashCalculator) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.hashcalculator

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
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
private val RESULT_CORNER = Radius.md
private const val RESULT_BG_ALPHA = 0.5f
private val RESULT_MIN_HEIGHT = 96.dp
private const val SKELETON_LINE_FRACTION = 0.9f
private val SKELETON_LINE_HEIGHT = 14.dp
private const val INPUT_MIN_LINES = 2
private const val INPUT_MAX_LINES = 4

// The web tool's `t(...)` keys that the shared catalog (P1/S10) does not define upstream. i18next renders
// the key text itself in that case, so the surface reproduces that key-as-fallback by using the key directly
// (the same approach the sibling client-utility surfaces take). The compute button + state chrome below
// resolve through real `R.string` catalog entries.
private const val KEY_TITLE = "Hash Calculator"
private const val KEY_DESC = "Hash Calculator Desc"
private const val KEY_INPUT_LABEL = "Hash Input"
private const val KEY_INPUT_HINT = "Hash Placeholder" // parity:allow i18next key-as-fallback (web tool input hint)
private const val KEY_ERROR = "Hash Error"

/**
 * Stateful entry point. Collects the shared [HashCalculatorViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface. A host supplies the view-model (wired via
 * [HashCalculatorViewModel.factory]).
 *
 * @param viewModel the state holder bound to the on-device SHA-256 engine.
 */
@Composable
fun HashCalculator(
    viewModel: HashCalculatorViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    HashCalculatorContent(
        state = state,
        modifier = modifier,
        onCompute = viewModel::compute,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless Hash Calculator surface — renders the always-present tool card (icon + title + description),
 * the labeled input, the compute button, and the result region for every state: a loading skeleton while
 * the digest runs, the error state + retry (web `catch`), the data-empty hint (web `!hashResult`), the
 * computed hash + copy (web result block), plus the stale / offline freshness chip over a last-known digest.
 * The input text is local UI state (web `useState`), handed back on [onCompute]. Hoisted out of the
 * ViewModel so each state is preview- and screenshot-testable with hand-built [UiState] inputs.
 */
@Composable
fun HashCalculatorContent(
    state: UiState<HashDigest>,
    modifier: Modifier = Modifier,
    initialInput: String = "",
    onCompute: (String) -> Unit = {},
    onRetry: (String) -> Unit = {},
    onRefresh: (String) -> Unit = {},
) {
    var input by rememberSaveable { mutableStateOf(initialInput) }
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        HashToolHeader()
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (state.stale || state.hasError || state.refreshing) {
                HashFreshness(state = state, onRefresh = { onRefresh(input) })
            }
            HashInputField(value = input, onValueChange = { input = it })
            Button(
                label = stringResource(R.string.translation_devtools_utils_computeSha256),
                onClick = { onCompute(input) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                loading = state.isLoading || state.refreshing,
                leadingIcon = HashCalculatorGlyphs.Hash,
            )
            HashResult(state = state, onRetry = { onRetry(input) })
        }
    }
}

/** The tool-card header — the red icon chip + title + description (web `ToolCard` head). */
@Composable
private fun HashToolHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        HashIconChip()
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(KEY_TITLE)
            Caption(KEY_DESC)
        }
    }
}

/** The colored, rounded icon chip behind the `#` glyph (web red `ICON_COLOR_MAP` chip). */
@Composable
private fun HashIconChip() {
    val color = TeslaTokens.status.danger
    Box(
        modifier =
            Modifier
                .size(CHIP_SIZE)
                .clip(RoundedCornerShape(CHIP_CORNER))
                .background(color.copy(alpha = CHIP_BG_ALPHA))
                .border(1.dp, color.copy(alpha = CHIP_BORDER_ALPHA), RoundedCornerShape(CHIP_CORNER)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = HashCalculatorGlyphs.Hash, contentDescription = null, size = IconSize.Lg, tint = color)
    }
}

/** The labeled multi-line input (web label span + `Textarea` with its guidance hint). */
@Composable
private fun HashInputField(
    value: String,
    onValueChange: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(KEY_INPUT_LABEL)
        Textarea(
            value = value,
            onValueChange = onValueChange,
            hint = KEY_INPUT_HINT,
            minLines = INPUT_MIN_LINES,
            maxLines = INPUT_MAX_LINES,
        )
    }
}

/** The result region — one of loading / error / content / empty, never a blank box. */
@Composable
private fun HashResult(
    state: UiState<HashDigest>,
    onRetry: () -> Unit,
) {
    val digest = state.data
    when {
        state.isLoading -> HashResultLoading()
        state.isError -> HashResultError(onRetry = onRetry)
        digest != null && !digest.isBlank -> HashResultBlock(digest = digest)
        else -> HashResultEmpty()
    }
}

/** The computed digest + copy affordance (web rose result block). */
@Composable
private fun HashResultBlock(digest: HashDigest) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(RESULT_CORNER))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = RESULT_BG_ALPHA))
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(text = digest.hex, modifier = Modifier.weight(1f))
        CopyButton(
            text = digest.hex,
            copyLabel = stringResource(R.string.translation_common_copyButton_copy),
            copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
            iconOnly = true,
        )
    }
}

/** The data-empty hint shown before a digest exists (web hides the result block; native shows guidance). */
@Composable
private fun HashResultEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = HashCalculatorGlyphs.Hash,
        modifier = Modifier.fillMaxWidth().heightIn(min = RESULT_MIN_HEIGHT),
    )
}

/** The computing skeleton — a shimmering hash-line shape with an accessible "loading" label. */
@Composable
private fun HashResultLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Box(
        modifier = Modifier.fillMaxWidth().heightIn(min = RESULT_MIN_HEIGHT).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Skeleton(widthFraction = SKELETON_LINE_FRACTION, height = SKELETON_LINE_HEIGHT, rounded = true)
    }
}

/** The error state — the web `catch` branch's "Hash Error" message with a retry affordance. */
@Composable
private fun HashResultError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = KEY_ERROR,
        title = KEY_TITLE,
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth().heightIn(min = RESULT_MIN_HEIGHT),
    )
}

/** The stale / offline freshness chip + recompute control, shown only over a degraded last-known digest. */
@Composable
private fun HashFreshness(
    state: UiState<HashDigest>,
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

private const val PREVIEW_HEX = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
private val PREVIEW_DIGEST = HashDigest(HashCalculatorProjection.ALGORITHM, PREVIEW_HEX)
private const val PREVIEW_INPUT = "abc"
private const val PREVIEW_NOW = 1_780_000_000_000L

@Preview(name = "HashCalculator · content", showBackground = true)
@Composable
private fun HashCalculatorContentPreview() {
    TeslaSyncTheme {
        HashCalculatorContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DIGEST, fetchedAt = PREVIEW_NOW),
            initialInput = PREVIEW_INPUT,
        )
    }
}

@Preview(name = "HashCalculator · empty", showBackground = true)
@Composable
private fun HashCalculatorEmptyPreview() {
    TeslaSyncTheme {
        HashCalculatorContent(state = UiState(phase = UiPhase.Empty, data = HashDigest.EMPTY, fetchedAt = PREVIEW_NOW))
    }
}

@Preview(name = "HashCalculator · loading", showBackground = true)
@Composable
private fun HashCalculatorLoadingPreview() {
    TeslaSyncTheme {
        HashCalculatorContent(state = UiState.loading(), initialInput = PREVIEW_INPUT)
    }
}

@Preview(name = "HashCalculator · error", showBackground = true)
@Composable
private fun HashCalculatorErrorPreview() {
    TeslaSyncTheme {
        HashCalculatorContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown),
            initialInput = PREVIEW_INPUT,
        )
    }
}

@Preview(name = "HashCalculator · offline", showBackground = true)
@Composable
private fun HashCalculatorOfflinePreview() {
    TeslaSyncTheme {
        HashCalculatorContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DIGEST,
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            initialInput = PREVIEW_INPUT,
        )
    }
}
