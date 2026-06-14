// Native Compose render layer for the ThemeProvider shared surface — the parity port of the web app-wide
// appearance context (web/src/components/ui/ThemeProvider.tsx). It is a thin layer over the pure
// [ThemeProviderProjection] and the [ThemeProviderViewModel]'s [ThemeSelection] / sync feeds: it owns no
// business logic, performs no HTTP or persistence, and does three things the web provider does — resolve the
// active appearance (auto follows the system colour scheme), APPLY it (the native analogue of the web
// `applyThemeCSS`: a Material 3 [androidx.compose.material3.ColorScheme] built from the catalogue colours,
// the CSS-variable analogue), and EXPOSE it to descendants through [useTheme] (the `useTheme()` hook port).
//
// The web provider always renders its children (the appearance applies instantly from the local cache; the
// backend fetch never gates the tree), so this wrapper always renders [content]. The backend settings
// document is a real cache-then-network feed, so its loading / content / empty / error / stale / offline
// states are reproduced by the co-located [ThemeSyncStatus] sub-surface — fully previewed and UI-testable in
// every phase — which a host (or the wrapper, via `showSyncStatus`) can surface. This mirrors the precedent
// for an otherwise-invisible provider (ScrollRestoration): reproduce the real states honestly rather than
// fabricate chrome the web source does not have.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themeprovider

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.LocalStatusColors
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.DarkStatusColors
import io.teslasync.android.ui.theme.generated.GeneratedShapes
import io.teslasync.android.ui.theme.generated.GeneratedTypography
import io.teslasync.android.ui.theme.generated.LightStatusColors
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Test tag on the surface root so on-device UI tests can locate the rendered provider in any state. */
const val THEME_PROVIDER_TEST_TAG: String = "theme-provider"

/** Test tag on the sync-status sub-surface so UI tests can assert each rendered phase. */
const val THEME_SYNC_STATUS_TEST_TAG: String = "theme-sync-status"

private val SYNC_SKELETON_HEIGHT: Dp = 14.dp
private const val SYNC_SKELETON_FRACTION: Float = 0.4f
private const val PREVIEW_STAMP: Long = 1_700_000_000_000L

/**
 * The value `useTheme()` returns — the native port of the web `ThemeContextValue`. Carries the active
 * [themeId] / [modeId] (the selection), the resolved [theme] / [mode] (the applied catalogue entries), the
 * selection-specific [themes] / [modes] catalogues, and the three setters. A fresh instance is provided on
 * every appearance change so readers recompose.
 */
@Immutable
@Suppress("LongParameterList")
class ThemeContext(
    val themeId: ThemeId,
    val modeId: ModeId,
    val theme: ColorTheme,
    val mode: ModeTheme,
    val themes: Map<ThemeId, ColorTheme>,
    val modes: Map<ModeId, ModeTheme>,
    val setTheme: (ThemeId) -> Unit,
    val setMode: (ModeId) -> Unit,
    val setCustomColors: (String, String) -> Unit,
)

/** Ambient appearance context — `null` until a [ThemeProvider] provides it (web `ThemeContext`). */
val LocalThemeContext = compositionLocalOf<ThemeContext?> { null }

/** Ambient resolved palette so descendants can read the raw catalogue colours (the CSS-variable analogue). */
val LocalThemePalette = compositionLocalOf<ThemeResolution?> { null }

/**
 * Reads the ambient appearance context — the native port of the web `useTheme()` hook, including its
 * guard: it throws when called outside a [ThemeProvider] (web `if (!ctx) throw`).
 */
@Composable
fun useTheme(): ThemeContext = LocalThemeContext.current ?: error("useTheme must be used within ThemeProvider")

/**
 * Reads the ambient resolved palette (raw primary/accent/glass/text colours) — the descendant-facing
 * analogue of reading the web `--theme-*` / `--surface-*` CSS variables. Throws outside a [ThemeProvider].
 */
@Composable
fun useThemePalette(): ThemeResolution = LocalThemePalette.current ?: error("useThemePalette must be used within ThemeProvider")

/**
 * Stateful entry point — the parity port of the web `<ThemeProvider>`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, collects the effective [ThemeSelection] + the backend sync
 * [UiState], resolves and applies the active appearance, and provides [useTheme] to [content]. [content] is
 * always rendered (web parity: the appearance applies from the local cache and never gates the tree); set
 * [showSyncStatus] to also surface the backend sync state above the content.
 *
 * @param viewModel the state holder bound to the shared settings + local selection stores.
 * @param showSyncStatus surface the backend-settings sync status above [content] (default off, web parity).
 */
@Composable
fun ThemeProvider(
    viewModel: ThemeProviderViewModel,
    modifier: Modifier = Modifier,
    showSyncStatus: Boolean = false,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val selection by viewModel.selection.collectAsStateWithLifecycle()
    val sync by viewModel.syncState.collectAsStateWithLifecycle()
    val systemDark = isSystemInDarkTheme()
    val resolution = remember(selection, systemDark) { ThemeProviderProjection.resolve(selection, systemDark) }
    val themesFor = remember(selection) { ThemeProviderProjection.themesFor(selection) }
    val context =
        remember(resolution, themesFor, viewModel) {
            ThemeContext(
                themeId = resolution.themeId,
                modeId = resolution.modeId,
                theme = resolution.theme,
                mode = resolution.mode,
                themes = themesFor,
                modes = ThemeProviderProjection.modes,
                setTheme = viewModel::setTheme,
                setMode = viewModel::setMode,
                setCustomColors = viewModel::setCustomColors,
            )
        }
    val strings = rememberThemeProviderStrings()

    AppThemeSurface(resolution) {
        CompositionLocalProvider(LocalThemeContext provides context) {
            Column(modifier = modifier.testTag(THEME_PROVIDER_TEST_TAG)) {
                if (showSyncStatus) {
                    ThemeSyncStatus(
                        state = sync,
                        strings = strings,
                        activeLabel = resolution.label,
                        onRetry = viewModel::retry,
                    )
                }
                content()
            }
        }
    }
}

/**
 * Production overload — builds the [ThemeProviderViewModel] from the app-scoped [LocalDataContainer]
 * (the shared [io.teslasync.shared.core.presentation.settings.SettingsStore] + the sanctioned logger) and a
 * [ThemeSelectionStore] over the device [SharedPreferences][android.content.SharedPreferences]. Mount it once
 * near the app root.
 */
@Composable
fun ThemeProvider(
    modifier: Modifier = Modifier,
    showSyncStatus: Boolean = false,
    content: @Composable () -> Unit,
) {
    val container = LocalDataContainer.current
    val androidContext = LocalContext.current
    val viewModel =
        remember(container, androidContext) {
            ThemeProviderViewModel.create(
                settingsStore = container.settingsStore,
                selectionStore = ThemeSelectionStore.fromContext(androidContext),
                logger = container.logger,
            )
        }
    ThemeProvider(viewModel = viewModel, modifier = modifier, showSyncStatus = showSyncStatus, content = content)
}

/**
 * Applies [resolution] as the ambient Material 3 theme — the native analogue of the web `applyThemeCSS`. The
 * catalogue colours are mapped onto the [ColorScheme] roles (primary/accent → primary/secondary/tertiary,
 * the mode background/surfaces/text → background/surface/onSurface, the glass border → outline) over the
 * matching dark/light base, the generated type ramp + shapes are preserved, and the semantic status palette
 * tracks the mode. [resolution] is also published via [LocalThemePalette] for descendants that read raw
 * colours.
 */
@Composable
private fun AppThemeSurface(
    resolution: ThemeResolution,
    content: @Composable () -> Unit,
) {
    val scheme = rememberAppColorScheme(resolution)
    val statusColors = if (resolution.mode.dark) DarkStatusColors else LightStatusColors
    CompositionLocalProvider(
        LocalThemePalette provides resolution,
        LocalStatusColors provides statusColors,
    ) {
        MaterialTheme(
            colorScheme = scheme,
            typography = GeneratedTypography,
            shapes = GeneratedShapes,
        ) {
            Surface(color = scheme.background, contentColor = scheme.onBackground, content = content)
        }
    }
}

@Composable
private fun rememberAppColorScheme(resolution: ThemeResolution): ColorScheme =
    remember(resolution) {
        val mode = resolution.mode
        val theme = resolution.theme
        val base = if (mode.dark) darkColorScheme() else lightColorScheme()
        base.copy(
            primary = themeColor(theme.primary),
            secondary = themeColor(theme.accent),
            tertiary = themeColor(theme.accent),
            background = themeColor(mode.bg),
            onBackground = themeColor(mode.textPrimary),
            surface = themeColor(mode.surface1),
            surfaceVariant = themeColor(mode.surface2),
            onSurface = themeColor(mode.textPrimary),
            onSurfaceVariant = themeColor(mode.textSecondary),
            outline = themeColor(mode.glassBorder),
            outlineVariant = themeColor(mode.glassBorder),
        )
    }

/**
 * Stateless sync-status sub-surface — renders the backend-settings feed in every phase the prompt's state
 * matrix mandates: loading (a shimmer), content (an in-sync chip showing the applied appearance), the empty
 * branch (a neutral chip — no server-saved appearance, the local/default theme stands), a hard error (a
 * [QueryError] with retry), and the stale/offline freshness envelope (a chip + retry). Hoisted out of the
 * wrapper so it is preview- and screenshot-testable per state; the root carries an `aria-live` landmark so
 * screen readers announce offline ↔ online transitions.
 *
 * @param activeLabel the applied theme + mode label (data, e.g. `"Neon Cyan · Dark"`); not a localized string.
 */
@Composable
fun ThemeSyncStatus(
    state: UiState<JsonElement>,
    strings: ThemeProviderStrings,
    activeLabel: String,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(THEME_SYNC_STATUS_TEST_TAG)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = strings.region
                },
    ) {
        when (state.phase) {
            UiPhase.Loading -> Skeleton(widthFraction = SYNC_SKELETON_FRACTION, height = SYNC_SKELETON_HEIGHT, rounded = true)
            UiPhase.Error ->
                QueryError(
                    kind = ThemeProviderProjection.queryErrorKind(state),
                    resourceName = strings.region,
                    onRetry = onRetry,
                )
            UiPhase.Empty -> StatusPill(text = activeLabel, tone = StatusTone.Neutral)
            UiPhase.Content -> ThemeSyncContent(state, strings, activeLabel, onRetry)
        }
    }
}

/** Content-phase chrome — the in-sync chip, or the stale/offline freshness chip + retry over cached settings. */
@Composable
private fun ThemeSyncContent(
    state: UiState<JsonElement>,
    strings: ThemeProviderStrings,
    activeLabel: String,
    onRetry: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        when (ThemeProviderProjection.freshness(state)) {
            ThemeSyncFreshness.Live -> StatusPill(text = activeLabel, tone = StatusTone.Success)
            ThemeSyncFreshness.Stale -> {
                StatusPill(text = strings.stale, tone = StatusTone.Warning, pulse = true)
                StatusPill(text = activeLabel, tone = StatusTone.Neutral)
            }
            ThemeSyncFreshness.Offline -> {
                StatusPill(text = strings.offline, tone = StatusTone.Danger)
                StatusPill(text = activeLabel, tone = StatusTone.Neutral)
                Button(label = strings.retry, onClick = onRetry, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
    }
}

/** Builds the localized chrome labels from the P1/S10 catalogue; tests pass a deterministic instance. */
@Composable
private fun rememberThemeProviderStrings(): ThemeProviderStrings =
    ThemeProviderStrings(
        region = stringResource(R.string.translation_theme_title),
        syncing = stringResource(R.string.translation_common_loading),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
        retry = stringResource(R.string.translation_common_retry),
    )

private fun themeColor(css: String): Color = Color(ThemeProviderProjection.toArgb(css))

// ── Previews — the sync-status surface in every state, plus the applied appearance for sample themes. ──

private fun previewStrings(): ThemeProviderStrings =
    ThemeProviderStrings(region = "Appearance", syncing = "Loading", stale = "Stale", offline = "Offline", retry = "Retry")

private fun previewDocument(): JsonElement = buildJsonObject { put(ThemeProviderRegistration.SETTINGS_THEME_FIELD, "neon-cyan") }

@Composable
private fun PreviewStatus(state: UiState<JsonElement>) {
    TeslaSyncTheme(dynamicColor = false) {
        ThemeSyncStatus(state = state, strings = previewStrings(), activeLabel = "Neon Cyan · Dark")
    }
}

@Preview(name = "ThemeProvider · sync loading", showBackground = true)
@Composable
private fun ThemeSyncLoadingPreview() = PreviewStatus(UiState.loading())

@Preview(name = "ThemeProvider · sync content", showBackground = true)
@Composable
private fun ThemeSyncContentPreview() = PreviewStatus(UiState(UiPhase.Content, data = previewDocument(), fetchedAt = PREVIEW_STAMP))

@Preview(name = "ThemeProvider · sync empty", showBackground = true)
@Composable
private fun ThemeSyncEmptyPreview() = PreviewStatus(UiState(UiPhase.Empty, data = buildJsonObject { }, fetchedAt = PREVIEW_STAMP))

@Preview(name = "ThemeProvider · sync error", showBackground = true)
@Composable
private fun ThemeSyncErrorPreview() = PreviewStatus(UiState(UiPhase.Error, errorKind = ErrorKind.Unknown))

@Preview(name = "ThemeProvider · sync stale", showBackground = true)
@Composable
private fun ThemeSyncStalePreview() =
    PreviewStatus(UiState(UiPhase.Content, data = previewDocument(), fetchedAt = PREVIEW_STAMP, stale = true, refreshing = true))

@Preview(name = "ThemeProvider · sync offline", showBackground = true)
@Composable
private fun ThemeSyncOfflinePreview() =
    PreviewStatus(
        UiState(
            UiPhase.Content,
            data = previewDocument(),
            fetchedAt = PREVIEW_STAMP,
            stale = true,
            errorKind = ErrorKind.Network,
        ),
    )

@Composable
private fun PreviewThemed(
    themeId: ThemeId,
    modeId: ModeId,
) {
    val selection = ThemeProviderRegistration.DEFAULTS.copy(themeId = themeId, modeId = modeId)
    val resolution = ThemeProviderProjection.resolve(selection, systemDark = true)
    AppThemeSurface(resolution) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PanelTitle(resolution.label)
            Button(label = "Primary", onClick = {}, variant = ButtonVariant.Primary, size = ButtonSize.Sm)
            StatusPill(text = "Accent", tone = StatusTone.Info)
        }
    }
}

@Preview(name = "ThemeProvider · Neon Cyan / Dark", showBackground = true)
@Composable
private fun ThemeProviderNeonDarkPreview() = PreviewThemed(ThemeId.NeonCyan, ModeId.Dark)

@Preview(name = "ThemeProvider · Solar Amber / Light", showBackground = true)
@Composable
private fun ThemeProviderSolarLightPreview() = PreviewThemed(ThemeId.SolarAmber, ModeId.Light)

@Preview(name = "ThemeProvider · Matrix Green / Nord", showBackground = true)
@Composable
private fun ThemeProviderMatrixNordPreview() = PreviewThemed(ThemeId.MatrixGreen, ModeId.Nord)
