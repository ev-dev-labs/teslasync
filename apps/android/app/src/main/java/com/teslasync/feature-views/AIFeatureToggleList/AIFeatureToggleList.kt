// The native Jetpack Compose + Material 3 AIFeatureToggleList settings feature view — a parity port of
// web/src/features/settings/components/AIFeatureToggleList.tsx. The web component is purely presentational and
// prop-driven: it takes `values: Record<AiFeatureId, boolean>` + `onToggle`, renders a legend (Subhead), then
// maps over `AI_FEATURE_IDS` (the generated registry `@/ai/features`) to one toggle row per feature — a label
// + description (Caption) + a Toggle whose `checked` is `Boolean(values[id])`. Each row's copy resolves with
// `t('ai.settings.feature.<id>.label', meta.name)` / `t('ai.settings.feature.<id>.description', meta.description)`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host owns the per-feature flags through
// the shared P1/S8 state-holder layer and supplies them as a [UiState] (the cache-then-network projection of
// the AI-settings document), so this feature view renders every lifecycle state that layer can carry — loading
// skeleton, hard error with retry, content, empty (defensive — the registry is static and non-empty), and
// stale/offline ("last known") with auto-refresh — without ever fetching. The legend, the [GlassPanel], the
// [EmptyState], the [ErrorDisplay], and the [DataFreshness] chip are the faithful native counterparts of the
// web shared components; the per-row label/description resolve through the catalog by name with the registry
// text as the fallback, the native analogue of the web `t(key, fallback)`. A web-parity overload taking the
// raw `values` map is provided for hosts that already hold the loaded flags.
//
// Android-idiomatic interaction: each row is one ≥48 dp toggle target (Material `Role.Switch`), the label is
// its accessible name (web `aria-label={label}`), and the row carries the web `data-testid` parity tags. The
// whole-row target is the platform settings convention and a strict superset of the web's toggle-only hit area.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AIFeatureToggleList — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aifeaturetogglelist

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The em dash shown for an unknown freshness age — the shared freshness "no value" fallback. */
private const val EM_DASH: String = "\u2014"

/** Number of shimmer rows the first-load skeleton renders, so the panel is never a blank box. */
private const val SKELETON_ROW_COUNT: Int = 6

/** Minimum height of a toggle row — keeps the whole-row toggle target at/above the 48 dp a11y minimum. */
private val ROW_MIN_HEIGHT: Dp = 48.dp

/** Width of the switch-shaped skeleton block in a loading row. */
private val SKELETON_SWITCH_WIDTH: Dp = 36.dp

/**
 * Stateful entry point for the AI feature toggle list. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared AI-settings feed can carry. The host owns the feed
 * (P1/S8) and supplies [onToggle] (the per-feature write) + [onRetry] (the feed's `refetch`); this view never
 * performs HTTP.
 *
 * @param state the cache-then-network projection of the per-feature enabled flags (web `values`).
 * @param onToggle invoked with the feature id + next value when a row is toggled (web `onToggle`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AIFeatureToggleList(
    state: UiState<Map<String, Boolean>>,
    onToggle: (String, Boolean) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAIFeatureToggleListOpened(logger) }
    AIFeatureToggleListContent(state = state, onToggle = onToggle, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's props — the raw `values` map + `onToggle` — for hosts that
 * already hold the loaded flags. Wraps [values] in a content [UiState]; there is no fetch behind it, so it
 * offers no retry affordance. Records `view.opened` like the stateful entry.
 */
@Composable
fun AIFeatureToggleList(
    values: Map<String, Boolean>,
    onToggle: (String, Boolean) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(values) { UiState(phase = UiPhase.Content, data = values) }
    AIFeatureToggleList(state = state, onToggle = onToggle, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The legend is always
 * visible inside the [GlassPanel] (web parity), then the body: a skeleton list while loading, an [ErrorDisplay]
 * with retry on a hard failure with no cached flags, a defensive [EmptyState] when [rows] is empty (the static
 * registry never is in production), otherwise the toggle rows. A stale/offline snapshot keeps the toggles
 * visible with a freshness chip and auto-refreshes. [rows] is injectable so the empty branch is testable.
 */
@Composable
fun AIFeatureToggleListContent(
    state: UiState<Map<String, Boolean>>,
    onToggle: (String, Boolean) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    rows: List<AiFeatureRow> = AIFeatureToggleListProjection.rows(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val context = LocalContext.current
    val legend = stringResource(R.string.translation_ai_settings_feature_legend)
    val resolved = remember(context, rows) { rows.map { it to it.resolve(context) } }
    val values = state.data ?: emptyMap()

    GlassPanel(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(AIFeatureToggleListProjection.LIST_TEST_TAG)
                .semantics { contentDescription = legend },
    ) {
        Subhead(legend)
        Spacer(Modifier.height(Spacing.sm))
        when {
            state.isLoading -> AiFeatureLoadingList()
            state.isError && !state.hasData -> AiFeatureError(onRetry = onRetry)
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    AiFeatureFreshnessRow(state)
                }
                if (resolved.isEmpty()) {
                    EmptyState(
                        message = stringResource(R.string.translation_common_noData),
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        resolved.forEach { (row, text) ->
                            AiFeatureToggleRow(
                                row = row,
                                label = text.label,
                                description = text.description,
                                checked = AIFeatureToggleListProjection.isEnabled(values, row.id),
                                onToggle = onToggle,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * One toggle row — the native analogue of the web per-feature `<div>`: the label + description on the left and
 * the [Toggle] on the right. The whole row is a single Material `Role.Switch` target (≥48 dp) whose accessible
 * name is [label] (web `aria-label={label}`) and whose [AiFeatureRow.rowTestTag] / [AiFeatureRow.toggleTestTag]
 * mirror the web `data-testid`s. The inner switch is read-only (the row owns the toggle), and the description
 * is only rendered when present so a fallback-less row stays clean.
 */
@Composable
private fun AiFeatureToggleRow(
    row: AiFeatureRow,
    label: String,
    description: String,
    checked: Boolean,
    onToggle: (String, Boolean) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .testTag(row.rowTestTag)
                .toggleable(
                    value = checked,
                    role = Role.Switch,
                    onValueChange = { next -> onToggle(row.id, next) },
                ).padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            BodyText(label)
            if (description.isNotBlank()) {
                Caption(description)
            }
        }
        Toggle(
            checked = checked,
            onCheckedChange = null,
            modifier = Modifier.testTag(row.toggleTestTag),
        )
    }
}

/** First-load skeleton — a list of toggle-shaped shimmer rows so the panel is never blank while flags load. */
@Composable
private fun AiFeatureLoadingList() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROW_COUNT) {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = ROW_MIN_HEIGHT),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Skeleton(widthFraction = 0.45f, height = 14.dp)
                    Skeleton(widthFraction = 0.85f, height = 12.dp)
                }
                Skeleton(modifier = Modifier.width(SKELETON_SWITCH_WIDTH), height = 20.dp, rounded = true)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun AiFeatureError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the rows when cached flags are refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached flags) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun AiFeatureFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the render-only concern
 * the sibling surfaces resolve, kept out of the pure projection so the model carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/** The label + description a row renders, after resolving the catalog keys (with the registry fallbacks). */
private data class ResolvedRowText(
    val label: String,
    val description: String,
)

/**
 * Resolves a row's label + description through the i18n catalog by resource name, falling back to the registry
 * text when the catalog has no entry — the native analogue of the web `t(key, fallback)`.
 */
private fun AiFeatureRow.resolve(context: Context): ResolvedRowText =
    ResolvedRowText(
        label = context.optionalString(labelResourceName) ?: labelFallback,
        description = context.optionalString(descriptionResourceName) ?: descriptionFallback,
    )

/**
 * Optional by-name read from the Android string catalog — the seam that reproduces web `t(key, fallback)`.
 * `getIdentifier` is the only way to attempt a key that may be absent (a compile-time `R.string` reference
 * cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed. Release builds keep
 * resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private fun previewValues(): Map<String, Boolean> =
    mapOf(
        "nl-search" to true,
        "chatbot-llm" to true,
        "drive-coaching" to false,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun AIFeatureToggleListContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIFeatureToggleListContent(
            state = UiState(phase = UiPhase.Content, data = previewValues()),
            onToggle = { _, _ -> },
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun AIFeatureToggleListLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIFeatureToggleListContent(
            state = UiState(phase = UiPhase.Loading),
            onToggle = { _, _ -> },
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun AIFeatureToggleListErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIFeatureToggleListContent(
            state = UiState(phase = UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network),
            onToggle = { _, _ -> },
            onRetry = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun AIFeatureToggleListEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIFeatureToggleListContent(
            state = UiState(phase = UiPhase.Empty, data = emptyMap()),
            onToggle = { _, _ -> },
            onRetry = {},
            rows = emptyList(),
        )
    }
}
