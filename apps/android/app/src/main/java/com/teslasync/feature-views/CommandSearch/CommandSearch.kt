// The native Jetpack Compose + Material 3 CommandSearch feature view — a parity port of
// web/src/features/system/components/CommandSearch.tsx. The web component is the Vehicle Command Center's
// command filter: a controlled `Input` (web `value`/`onChange`) with a leading lucide `Search` glyph and a
// localized ghost prompt ("Search commands..."). It owns no state and fetches nothing — its only hook is
// `useTranslation`.
//
// This native surface keeps that contract: a controlled Material 3 [OutlinedTextField] that raises every
// keystroke to the parent through [onValueChange] (no debounce, no local buffer — unlike the shared
// `SearchInput`, so the controlled-component parity is exact), framed by the shared magnifier glyph
// (`FormsGlyphs.Search`) and the localized ghost prompt resolved at the render boundary (P1/S10). Because the
// feature-view contract still flows through the shared state-holder layer (P1/S8), the surface also renders
// every lifecycle state that layer can carry — a loading skeleton, a hard error with retry, and a
// stale/offline freshness chip over the cached field — even though the field's default host state is always
// "ready" (it has nothing to fetch). A web-parity overload with no host state renders the live field directly.
//
// Per the Android guidelines this is built from native primitives + design tokens (P1/S9), never ported
// Tailwind classes; the field carries an accessible name (the ghost prompt) so TalkBack announces its purpose
// even though the web renders no visible label. `view.opened` is emitted once via the sanctioned redacting
// logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CommandSearch — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.commandsearch

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH: String = "\u2014"
private val FIELD_SKELETON_HEIGHT: Dp = 56.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `CommandSearch` props ([value] + [onValueChange]).
 * Records the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11) and renders every
 * lifecycle [state] the shared feature-view layer can carry. The host owns the lifecycle (P1/S8) and supplies
 * [onRetry]; this view never performs HTTP.
 *
 * @param value the raw input text, owned by the parent (web `value` prop).
 * @param onValueChange raises every keystroke to the parent (web `onChange`) — fired immediately, undebounced.
 * @param state the host lifecycle projection. The field has no feed, so a host normally passes `Content`;
 *   `Loading`/`Error`/stale/offline are reproduced for full state coverage, never faked from a fetch.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CommandSearch(
    value: String,
    onValueChange: (String) -> Unit,
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CommandSearchDiagnostics.recordViewOpened(logger) }
    CommandSearchContent(value = value, onValueChange = onValueChange, state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the self-contained web component (no host feed): renders the live controlled
 * field directly in the `Content` phase. Records `view.opened` like the stateful entry; there is no fetch
 * behind it, so it offers no retry affordance.
 */
@Composable
fun CommandSearch(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember { UiState(phase = UiPhase.Content, data = Unit) }
    CommandSearch(value = value, onValueChange = onValueChange, state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Switches on the host
 * lifecycle: a loading skeleton, a hard-error retry surface, or — when ready — a freshness chip (only while
 * refreshing/stale/offline) above the controlled search field. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. The [hint] override lets tests and previews inject a fixed ghost
 * prompt; production resolves it from the i18n catalog.
 */
@Composable
fun CommandSearchContent(
    value: String,
    onValueChange: (String) -> Unit,
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    hint: String? = null,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val resolvedHint = hint ?: commandSearchHint()
    val formatAge = rememberCommandSearchFreshnessFormatter()

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        when (commandSearchSurfaceFor(isLoading = state.isLoading, isError = state.isError)) {
            CommandSearchSurfaceState.Loading ->
                CommandSearchLoading(label = stringResource(R.string.translation_common_loading))
            CommandSearchSurfaceState.Error -> CommandSearchError(onRetry = onRetry)
            CommandSearchSurfaceState.Ready -> {
                if (state.stale || state.refreshing || state.hasError) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        DataFreshness(
                            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                            isFetching = state.refreshing,
                            isStale = state.stale,
                            isError = state.hasError,
                            fetchingLabel = stringResource(R.string.translation_common_loading),
                            errorLabel = stringResource(R.string.translation_common_offline),
                            formatAge = formatAge,
                        )
                    }
                }
                CommandSearchField(value = value, onValueChange = onValueChange, hint = resolvedHint)
            }
        }
    }
}

/**
 * The controlled search field — the native analogue of the web `Input`. A leading magnifier glyph
 * (`FormsGlyphs.Search`) frames the field; [hint] is both the ghost prompt shown while the field is empty and
 * the field's accessible name (the web renders no visible label, so the name is carried via semantics).
 */
@Composable
private fun CommandSearchField(
    value: String,
    onValueChange: (String) -> Unit,
    hint: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth().semantics { contentDescription = hint },
        singleLine = true,
        placeholder = { Text(hint) }, // parity:allow Material 3 OutlinedTextField placeholder slot name
        leadingIcon = { Icon(FormsGlyphs.Search, contentDescription = null, size = IconSize.Sm) },
        shape = MaterialTheme.shapes.medium,
    )
}

/** First-load skeleton — a single field-shaped bar carrying an accessible "loading" name so it is never blank. */
@Composable
private fun CommandSearchLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Skeleton(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        height = FIELD_SKELETON_HEIGHT,
        rounded = true,
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun CommandSearchError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Resolves the localized ghost-prompt text shown while the field is empty (the web search prompt key). */
@Composable
private fun commandSearchHint(): String = stringResource(R.string.translation_commands_search_placeholder) // parity:allow web i18n key

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [Locale] so the numeric substitution is locale-correct.
 */
@Composable
private fun rememberCommandSearchFreshnessFormatter(): (FreshnessAge) -> String {
    val locale = currentLocale()
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(locale, justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(locale, age.value)
                is FreshnessAge.Minutes -> minutes.format(locale, age.value)
                is FreshnessAge.Hours -> hours.format(locale, age.value)
                is FreshnessAge.Days -> days.format(locale, age.value)
                is FreshnessAge.Weeks -> weeks.format(locale, age.value)
            }
        }
    }
}

/** The active configuration [Locale] (the first in the locale list), falling back to the JVM default. */
@Composable
private fun currentLocale(): Locale {
    val configuration = LocalConfiguration.current
    return if (configuration.locales.isEmpty) Locale.getDefault() else configuration.locales[0]
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "CommandSearch — ready (query)", showBackground = true)
@Composable
private fun CommandSearchReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSearchContent(
            value = "wake",
            onValueChange = {},
            state = UiState(UiPhase.Content, data = Unit),
            onRetry = {},
        )
    }
}

@Preview(name = "CommandSearch — empty (ghost prompt)", showBackground = true)
@Composable
private fun CommandSearchEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSearchContent(
            value = "",
            onValueChange = {},
            state = UiState(UiPhase.Content, data = Unit),
            onRetry = {},
        )
    }
}

@Preview(name = "CommandSearch — loading", showBackground = true)
@Composable
private fun CommandSearchLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSearchContent(
            value = "",
            onValueChange = {},
            state = UiState(UiPhase.Loading),
            onRetry = {},
        )
    }
}

@Preview(name = "CommandSearch — error", showBackground = true)
@Composable
private fun CommandSearchErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSearchContent(
            value = "",
            onValueChange = {},
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
        )
    }
}

@Preview(name = "CommandSearch — offline (cached)", showBackground = true)
@Composable
private fun CommandSearchOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CommandSearchContent(
            value = "charge",
            onValueChange = {},
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = Unit,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
        )
    }
}
