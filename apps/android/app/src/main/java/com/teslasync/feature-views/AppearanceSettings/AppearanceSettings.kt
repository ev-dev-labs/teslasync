// The native Jetpack Compose + Material 3 AppearanceSettings feature view — a parity port of
// web/src/features/settings/components/AppearanceSettings.tsx. The web component renders a GlassPanel titled
// "Appearance" containing, top to bottom: the shared ThemePicker, an information-density picker (with mini
// glyphs + a live preview), a sidebar-style picker (with silhouette swatches), a default-time-format picker, a
// chart-palette picker (with color swatches), a footer status-bar card (two toggles), an achievement
// celebration card (four toggles), and a product-tours card (replay + reset buttons). This native port keeps
// that composition and additionally surfaces the cache-then-network states the P3 contract mandates for the
// three server-backed pickers (density / time-format / chart-palette, driven by the `/settings` document):
// a skeleton covers loading, a `QueryError` covers a hard failure with no cache, a freshness chip + auto-refresh
// covers stale/offline, and an empty document still renders the editor showing the defaults (never a blank box).
// The device-local sections (theme, sidebar, status bar, celebration, tours) always render. The view performs
// NO HTTP and never persists directly — it binds an [AppearanceSettingsViewModel] (P1/S8) and renders. Every
// visible string resolves through the i18n catalog (P1/S10): the present keys at compile time, the
// catalog-absent sidebar-style + chart-palette-help keys via the by-name `t(key, default)` facade.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/AppearanceSettings) cannot form a valid Kotlin package and the file
// hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.appearancesettings

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.ThemePicker
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The web `<FadeIn delay={0.15}>` entry stagger (150 ms). */
private const val FADE_DELAY_MS = 150

/** Tailwind `sm` (640px) breakpoint — the web `grid-cols-1 sm:grid-cols-N` reflow (1 column below, N at/above). */
private val GRID_SM_BREAKPOINT: Dp = 640.dp

/** Loading-skeleton height, sized to a populated choice grid so the layout does not jump on load. */
private val CHOICE_SKELETON_HEIGHT: Dp = 112.dp

/** Opacity of a control disabled because settings have not loaded / the dependent toggle is off (web `opacity-50`). */
private const val DISABLED_ALPHA = 0.5f

/** Maximum simultaneously-stacked toasts (web caps the toast region). */
private const val MAX_TOASTS = 3

/** Toast visible duration before auto-dismiss. */
private const val TOAST_DURATION_MS = 4_000L

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/** Shared name for the device-local appearance prefs store (the native analogue of the web localStorage bucket). */
private const val APPEARANCE_PREFS_NAME = "appearance-settings"

/**
 * Stateful entry point for the AppearanceSettings surface. Binds the [source] (the shared S8 settings feed +
 * device-local prefs) into an [AppearanceSettingsViewModel], records the one-shot PII-safe `view.opened`
 * diagnostic, owns the toast queue, and renders every section + lifecycle state. A host may inject [source]
 * (e.g. a test/preview fake); by default it is built from the ambient [LocalDataContainer]'s SettingsStore plus
 * a [SharedPreferences]-backed local store. This view performs no HTTP.
 */
@Composable
fun AppearanceSettings(
    modifier: Modifier = Modifier,
    source: AppearanceSettingsSource = rememberAppearanceSettingsSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AppearanceSettingsRegistration.SLUG,
) {
    val viewModel: AppearanceSettingsViewModel =
        viewModel(key = instanceKey, factory = AppearanceSettingsViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val serverState by viewModel.serverPrefs.collectAsStateWithLifecycle()
    val statusBar by viewModel.statusBar.collectAsStateWithLifecycle()
    val celebration by viewModel.celebration.collectAsStateWithLifecycle()
    val sidebarStyle by viewModel.sidebarStyle.collectAsStateWithLifecycle()
    val saving by viewModel.saving.collectAsStateWithLifecycle()

    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    AppearanceToastPresenter(viewModel, toastQueue)

    Box(modifier = modifier.fillMaxWidth()) {
        AppearanceSettingsContent(
            serverState = serverState,
            statusBar = statusBar,
            celebration = celebration,
            sidebarStyle = sidebarStyle,
            saving = saving,
            onDensityChange = viewModel::setDensity,
            onTimeFormatChange = viewModel::setTimeFormat,
            onChartPaletteChange = viewModel::setChartPalette,
            onSidebarStyleChange = viewModel::setSidebarStyle,
            onStatusBarEnabledChange = viewModel::setStatusBarEnabled,
            onStatusBarIconOnlyChange = viewModel::setStatusBarIconOnly,
            onCelebrationShowToastsChange = viewModel::setCelebrationShowToasts,
            onCelebrationPlaySoundChange = viewModel::setCelebrationPlaySound,
            onCelebrationShowOnDashboardChange = viewModel::setCelebrationShowOnDashboard,
            onCelebrationPushOnUnlockChange = viewModel::setCelebrationPushOnUnlock,
            onReplayTour = viewModel::replayTour,
            onResetAllTours = viewModel::resetAllTours,
            onRetry = viewModel::retry,
        )
        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Builds the production [AppearanceSettingsSource] from the ambient data layer: the shared S8 SettingsStore for
 * the `/settings` document and a [SharedPreferencesAppearanceLocalStore] for the device-local prefs (the native
 * analogue of the web localStorage hooks). Remembered so the surface keeps one stable source across recompositions.
 */
@Composable
fun rememberAppearanceSettingsSource(): AppearanceSettingsSource {
    val container = LocalDataContainer.current
    val context = LocalContext.current
    return remember(container, context) {
        val prefs = context.getSharedPreferences(APPEARANCE_PREFS_NAME, Context.MODE_PRIVATE)
        bindAppearanceSettingsSource(container.settingsStore, SharedPreferencesAppearanceLocalStore(prefs))
    }
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Always renders the
 * "Appearance" header, the shared ThemePicker, and the device-local sections; the three server-backed pickers
 * reflect [serverState] (skeleton while loading, retry on hard error, controls otherwise, disabled until
 * settings resolve or while [saving]). A stale/offline settings snapshot shows a freshness chip and auto-refreshes.
 */
@Composable
fun AppearanceSettingsContent(
    serverState: UiState<AppearanceServerPrefs>,
    statusBar: StatusBarPrefs,
    celebration: CelebrationPrefs,
    sidebarStyle: SidebarStyle,
    saving: Boolean,
    modifier: Modifier = Modifier,
    onDensityChange: (DensityId) -> Unit = {},
    onTimeFormatChange: (TimeFormatId) -> Unit = {},
    onChartPaletteChange: (ChartPaletteId) -> Unit = {},
    onSidebarStyleChange: (SidebarStyle) -> Unit = {},
    onStatusBarEnabledChange: (Boolean) -> Unit = {},
    onStatusBarIconOnlyChange: (Boolean) -> Unit = {},
    onCelebrationShowToastsChange: (Boolean) -> Unit = {},
    onCelebrationPlaySoundChange: (Boolean) -> Unit = {},
    onCelebrationShowOnDashboardChange: (Boolean) -> Unit = {},
    onCelebrationPushOnUnlockChange: (Boolean) -> Unit = {},
    onReplayTour: (ProductTour) -> Unit = {},
    onResetAllTours: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(serverState.stale, serverState.refreshing, serverState.isError) {
        if (serverState.stale && !serverState.refreshing && !serverState.isError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                AppearanceHeader()
                if (serverState.fetchedAt != null || serverState.refreshing || serverState.hasError) {
                    FreshnessRow(serverState)
                }
                ThemePicker(modifier = Modifier.fillMaxWidth())
                DensitySection(serverState, saving, onDensityChange, onRetry)
                SidebarSection(sidebarStyle, onSidebarStyleChange)
                TimeFormatSection(serverState, saving, onTimeFormatChange, onRetry)
                ChartPaletteSection(serverState, saving, onChartPaletteChange, onRetry)
                StatusBarSection(statusBar, onStatusBarEnabledChange, onStatusBarIconOnlyChange)
                CelebrationSection(
                    celebration,
                    onCelebrationShowToastsChange,
                    onCelebrationPlaySoundChange,
                    onCelebrationShowOnDashboardChange,
                    onCelebrationPushOnUnlockChange,
                )
                ToursSection(onReplayTour, onResetAllTours)
            }
        }
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun AppearanceHeader() {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
        IconBox(tone = IconBoxTone.Primary, size = IconBoxSize.Md) {
            Icon(AppearanceSettingsGlyphs.Palette, contentDescription = null, size = IconSize.Lg)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            SectionTitle(stringResource(R.string.translation_theme_title))
            HelperText(stringResource(R.string.translation_theme_subtitle))
        }
    }
}

// ── Density ──────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun DensitySection(
    state: UiState<AppearanceServerPrefs>,
    saving: Boolean,
    onChange: (DensityId) -> Unit,
    onRetry: () -> Unit,
) {
    val label = stringResource(R.string.translation_theme_density_label)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(
            icon = AppearanceSettingsGlyphs.Rows3,
            label = label,
            helpText = stringResource(R.string.translation_help_fields_settings_appearanceDensity),
            helpContentDescription = label,
        )
        val specs =
            listOf(
                ChoiceSpec(
                    DensityId.Compact,
                    stringResource(R.string.translation_theme_density_compact),
                    stringResource(R.string.translation_theme_density_compactHelp),
                    leading = { DensityGlyph(DensityId.Compact) },
                ),
                ChoiceSpec(
                    DensityId.Comfortable,
                    stringResource(R.string.translation_theme_density_comfortable),
                    stringResource(R.string.translation_theme_density_comfortableHelp),
                    leading = { DensityGlyph(DensityId.Comfortable) },
                ),
                ChoiceSpec(
                    DensityId.Spacious,
                    stringResource(R.string.translation_theme_density_spacious),
                    stringResource(R.string.translation_theme_density_spaciousHelp),
                    leading = { DensityGlyph(DensityId.Spacious) },
                ),
            )
        ServerChoiceContainer(state, saving, label, onRetry) { prefs, enabled ->
            ChoiceGrid(specs, prefs.density, enabled, columnsWide = 3, onSelect = onChange)
        }
        HelperText(stringResource(R.string.translation_theme_density_help))
        DensityPreview()
    }
}

@Composable
private fun DensityPreview() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.lg)),
    ) {
        Box(modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm)) {
            Caption(stringResource(R.string.translation_theme_density_previewTitle))
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        val rows =
            listOf(
                stringResource(R.string.translation_theme_density_previewRow1),
                stringResource(R.string.translation_theme_density_previewRow2),
                stringResource(R.string.translation_theme_density_previewRow3),
            )
        rows.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm)) {
                BodyText(row)
            }
        }
    }
}

@Composable
private fun DensityGlyph(density: DensityId) {
    val bars =
        when (density) {
            DensityId.Compact -> 4
            DensityId.Comfortable -> 3
            DensityId.Spacious -> 2
        }
    val barHeight =
        when (density) {
            DensityId.Compact -> 2.dp
            DensityId.Comfortable -> 3.dp
            DensityId.Spacious -> 5.dp
        }
    Box(
        modifier =
            Modifier
                .size(32.dp)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.sm)),
        contentAlignment = Alignment.Center,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            repeat(bars) {
                Box(
                    modifier =
                        Modifier
                            .width(16.dp)
                            .height(barHeight)
                            .clip(RoundedCornerShape(1.dp))
                            .background(MaterialTheme.colorScheme.onSurfaceVariant),
                )
            }
        }
    }
}

// ── Sidebar style (device-local) ─────────────────────────────────────────────────────────────────────────

@Composable
private fun SidebarSection(
    selected: SidebarStyle,
    onChange: (SidebarStyle) -> Unit,
) {
    val context = LocalContext.current
    val label =
        resolveOptional({ context.optionalString(it) }, AppearanceSettingsKeys.SIDEBAR_LABEL, AppearanceSettingsDefaults.SIDEBAR_LABEL)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(icon = AppearanceSettingsGlyphs.Sidebar, label = label)
        val specs =
            listOf(
                ChoiceSpec(
                    SidebarStyle.Linear,
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.SIDEBAR_LINEAR,
                        AppearanceSettingsDefaults.SIDEBAR_LINEAR,
                    ),
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.SIDEBAR_LINEAR_HELP,
                        AppearanceSettingsDefaults.SIDEBAR_LINEAR_HELP,
                    ),
                    leading = { SidebarStyleSwatch(SidebarStyle.Linear) },
                ),
                ChoiceSpec(
                    SidebarStyle.Notion,
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.SIDEBAR_NOTION,
                        AppearanceSettingsDefaults.SIDEBAR_NOTION,
                    ),
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.SIDEBAR_NOTION_HELP,
                        AppearanceSettingsDefaults.SIDEBAR_NOTION_HELP,
                    ),
                    leading = { SidebarStyleSwatch(SidebarStyle.Notion) },
                ),
                ChoiceSpec(
                    SidebarStyle.Legacy,
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.SIDEBAR_LEGACY,
                        AppearanceSettingsDefaults.SIDEBAR_LEGACY,
                    ),
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.SIDEBAR_LEGACY_HELP,
                        AppearanceSettingsDefaults.SIDEBAR_LEGACY_HELP,
                    ),
                    leading = { SidebarStyleSwatch(SidebarStyle.Legacy) },
                ),
            )
        ChoiceGrid(specs, selected, enabled = true, columnsWide = 3, onSelect = onChange)
        HelperText(
            resolveOptional({ context.optionalString(it) }, AppearanceSettingsKeys.SIDEBAR_HELP, AppearanceSettingsDefaults.SIDEBAR_HELP),
        )
    }
}

@Composable
private fun SidebarStyleSwatch(style: SidebarStyle) {
    Column(
        modifier =
            Modifier
                .size(width = 36.dp, height = 48.dp)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.sm))
                .padding(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        val muted = MaterialTheme.colorScheme.onSurfaceVariant
        val primary = MaterialTheme.colorScheme.primary
        when (style) {
            SidebarStyle.Linear -> {
                SwatchBar(muted, widthFraction = 1f)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    Box(modifier = Modifier.size(width = 2.dp, height = 6.dp).clip(RoundedCornerShape(1.dp)).background(primary))
                    SwatchBar(primary, widthFraction = 1f)
                }
                SwatchBar(muted, widthFraction = 0.7f)
            }
            SidebarStyle.Notion -> repeat(4) { SwatchBar(muted, widthFraction = 1f) }
            SidebarStyle.Legacy ->
                listOf(MaterialTheme.colorScheme.primary, muted, muted).forEach { tint ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        Box(modifier = Modifier.size(6.dp).clip(RoundedCornerShape(1.dp)).background(tint))
                        SwatchBar(muted, widthFraction = 1f)
                    }
                }
        }
    }
}

@Composable
private fun SwatchBar(
    color: Color,
    widthFraction: Float,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth(widthFraction)
                .height(3.dp)
                .clip(RoundedCornerShape(1.dp))
                .background(color),
    )
}

// ── Time format ──────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun TimeFormatSection(
    state: UiState<AppearanceServerPrefs>,
    saving: Boolean,
    onChange: (TimeFormatId) -> Unit,
    onRetry: () -> Unit,
) {
    val label = stringResource(R.string.translation_theme_timeFormat_label)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(
            icon = AppearanceSettingsGlyphs.Clock,
            label = label,
            helpText = stringResource(R.string.translation_help_fields_settings_timeFormat),
            helpContentDescription = label,
        )
        val specs =
            listOf(
                ChoiceSpec(
                    TimeFormatId.Relative,
                    stringResource(R.string.translation_theme_timeFormat_relative),
                    stringResource(R.string.translation_theme_timeFormat_relativeHelp),
                ),
                ChoiceSpec(
                    TimeFormatId.Absolute,
                    stringResource(R.string.translation_theme_timeFormat_absolute),
                    stringResource(R.string.translation_theme_timeFormat_absoluteHelp),
                ),
            )
        ServerChoiceContainer(state, saving, label, onRetry) { prefs, enabled ->
            ChoiceGrid(specs, prefs.timeFormat, enabled, columnsWide = 2, onSelect = onChange)
        }
        HelperText(stringResource(R.string.translation_theme_timeFormat_help))
    }
}

// ── Chart palette ────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ChartPaletteSection(
    state: UiState<AppearanceServerPrefs>,
    saving: Boolean,
    onChange: (ChartPaletteId) -> Unit,
    onRetry: () -> Unit,
) {
    val context = LocalContext.current
    val label = stringResource(R.string.translation_theme_chartPalette_label)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(
            icon = AppearanceSettingsGlyphs.Eye,
            label = label,
            helpText = stringResource(R.string.translation_help_fields_settings_chartPalette),
            helpContentDescription = label,
        )
        val specs =
            listOf(
                ChoiceSpec(
                    ChartPaletteId.CbSafe,
                    stringResource(R.string.translation_theme_chartPalette_cbSafe),
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.PALETTE_CB_SAFE_HELP,
                        AppearanceSettingsDefaults.PALETTE_CB_SAFE_HELP,
                    ),
                    belowHelp = { PaletteSwatches(ChartPaletteId.CbSafe) },
                ),
                ChoiceSpec(
                    ChartPaletteId.Neon,
                    stringResource(R.string.translation_theme_chartPalette_neon),
                    resolveOptional(
                        { context.optionalString(it) },
                        AppearanceSettingsKeys.PALETTE_NEON_HELP,
                        AppearanceSettingsDefaults.PALETTE_NEON_HELP,
                    ),
                    belowHelp = { PaletteSwatches(ChartPaletteId.Neon) },
                ),
            )
        ServerChoiceContainer(state, saving, label, onRetry) { prefs, enabled ->
            ChoiceGrid(specs, prefs.chartPalette, enabled, columnsWide = 2, onSelect = onChange)
        }
        HelperText(stringResource(R.string.translation_theme_chartPalette_help))
    }
}

@Composable
private fun PaletteSwatches(palette: ChartPaletteId) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        AppearanceSettingsProjection.swatchesFor(palette).forEach { hex ->
            Box(
                modifier =
                    Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(parseHexColor(hex))
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape),
            )
        }
    }
}

// ── Status bar (device-local) ────────────────────────────────────────────────────────────────────────────

@Composable
private fun StatusBarSection(
    prefs: StatusBarPrefs,
    onEnabledChange: (Boolean) -> Unit,
    onIconOnlyChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(icon = AppearanceSettingsGlyphs.PanelBottom, label = stringResource(R.string.translation_theme_statusBar_label))
        PrefCard {
            ToggleRow(
                label = stringResource(R.string.translation_theme_statusBar_show),
                help = stringResource(R.string.translation_theme_statusBar_showHelp),
                checked = prefs.enabled,
                onCheckedChange = onEnabledChange,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ToggleRow(
                label = stringResource(R.string.translation_theme_statusBar_iconOnly),
                help = stringResource(R.string.translation_theme_statusBar_iconOnlyHelp),
                checked = prefs.iconOnly,
                onCheckedChange = onIconOnlyChange,
                enabled = prefs.enabled,
            )
        }
    }
}

// ── Achievement celebration (device-local) ───────────────────────────────────────────────────────────────

@Composable
private fun CelebrationSection(
    prefs: CelebrationPrefs,
    onShowToastsChange: (Boolean) -> Unit,
    onPlaySoundChange: (Boolean) -> Unit,
    onShowOnDashboardChange: (Boolean) -> Unit,
    onPushOnUnlockChange: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(icon = AppearanceSettingsGlyphs.Trophy, label = stringResource(R.string.translation_achievements_celebrationSettings))
        PrefCard {
            ToggleRow(
                label = stringResource(R.string.translation_achievements_showToasts),
                help = stringResource(R.string.translation_achievements_showToastsHelp),
                checked = prefs.showToasts,
                onCheckedChange = onShowToastsChange,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ToggleRow(
                label = stringResource(R.string.translation_achievements_playSound),
                help = stringResource(R.string.translation_achievements_playSoundHelp),
                checked = prefs.playSound,
                onCheckedChange = onPlaySoundChange,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ToggleRow(
                label = stringResource(R.string.translation_achievements_showOnDashboard),
                help = stringResource(R.string.translation_achievements_showOnDashboardHelp),
                checked = prefs.showOnDashboard,
                onCheckedChange = onShowOnDashboardChange,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ToggleRow(
                label = stringResource(R.string.translation_achievements_pushOnUnlock),
                help = stringResource(R.string.translation_achievements_pushOnUnlockHelp),
                checked = prefs.pushOnUnlock,
                onCheckedChange = onPushOnUnlockChange,
            )
        }
    }
}

// ── Product tours (device-local) ─────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ToursSection(
    onReplay: (ProductTour) -> Unit,
    onReset: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(icon = AppearanceSettingsGlyphs.PlayCircle, label = stringResource(R.string.translation_settings_tours_label))
        PrefCard {
            BodyText(stringResource(R.string.translation_settings_tours_title))
            HelperText(stringResource(R.string.translation_settings_tours_body))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Button(
                    label = stringResource(R.string.translation_settings_tours_replayMain),
                    onClick = { onReplay(ProductTour.Main) },
                    leadingIcon = AppearanceSettingsGlyphs.PlayCircle,
                )
                Button(
                    label = stringResource(R.string.translation_settings_tours_replayDebugger),
                    onClick = { onReplay(ProductTour.Debugger) },
                    variant = ButtonVariant.Ghost,
                )
                Button(
                    label = stringResource(R.string.translation_settings_tours_replayAutomations),
                    onClick = { onReplay(ProductTour.Automations) },
                    variant = ButtonVariant.Ghost,
                )
                Button(
                    label = stringResource(R.string.translation_settings_tours_resetAll),
                    onClick = onReset,
                    variant = ButtonVariant.Danger,
                    leadingIcon = AppearanceSettingsGlyphs.RotateCcw,
                )
            }
        }
    }
}

// ── Shared building blocks ───────────────────────────────────────────────────────────────────────────────

/** One choice in a picker grid — id + label + help + optional leading glyph/swatch + optional below-help slot. */
private data class ChoiceSpec<T>(
    val id: T,
    val label: String,
    val help: String,
    val leading: (@Composable () -> Unit)? = null,
    val belowHelp: (@Composable () -> Unit)? = null,
)

/**
 * The responsive picker grid — the native analogue of the web `grid-cols-1 sm:grid-cols-N`. Picks 1 column
 * below the `sm` breakpoint and [columnsWide] at/above it, as a [selectableGroup] of [ChoiceCard]s (the web
 * `role="radiogroup"`); a short final row is padded with empty weighted slots to keep uniform card widths.
 */
@Composable
private fun <T> ChoiceGrid(
    specs: List<ChoiceSpec<T>>,
    selected: T,
    enabled: Boolean,
    columnsWide: Int,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_BREAKPOINT) columnsWide else 1
        Column(
            modifier = Modifier.selectableGroup(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            specs.chunked(columns).forEach { rowSpecs ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowSpecs.forEach { spec ->
                        ChoiceCard(
                            label = spec.label,
                            help = spec.help,
                            selected = spec.id == selected,
                            enabled = enabled,
                            onClick = { onSelect(spec.id) },
                            leading = spec.leading,
                            belowHelp = spec.belowHelp,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowSpecs.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun ChoiceCard(
    label: String,
    help: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    belowHelp: (@Composable () -> Unit)? = null,
) {
    val borderColor = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    val container = if (selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface
    Surface(
        shape = RoundedCornerShape(Radius.lg),
        color = container,
        border = BorderStroke(1.dp, borderColor),
        modifier =
            modifier
                .fillMaxWidth()
                .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
                .alpha(if (enabled) 1f else DISABLED_ALPHA),
    ) {
        Row(
            modifier = Modifier.padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            leading?.invoke()
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(label)
                HelperText(help)
                belowHelp?.invoke()
            }
            if (selected) {
                Icon(
                    AppearanceSettingsGlyphs.CheckCircle,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

/** A section's label row: a muted leading glyph, the uppercase-style [label], and an optional help tooltip. */
@Composable
private fun SectionHeader(
    icon: ImageVector,
    label: String,
    helpText: String? = null,
    helpContentDescription: String? = null,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        MetricLabel(label)
        if (helpText != null && helpContentDescription != null) {
            HelpIcon(text = helpText, contentDescription = helpContentDescription)
        }
    }
}

/** The bordered card the device-local toggle groups sit in (web `rounded-xl border bg-surface-2 p-4`). */
@Composable
private fun PrefCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.lg))
                .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** A label + help + trailing switch row; the whole switch carries the label for TalkBack (web settings row). */
@Composable
private fun ToggleRow(
    label: String,
    help: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    enabled: Boolean = true,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(
            modifier = Modifier.weight(1f).alpha(if (enabled) 1f else DISABLED_ALPHA),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(label)
            HelperText(help)
        }
        Spacer(modifier = Modifier.width(Spacing.sm))
        Toggle(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = enabled,
            modifier = Modifier.semantics { contentDescription = label },
        )
    }
}

/** A right-aligned settings-feed freshness chip (loading / refreshing / stale / offline), web parity. */
@Composable
private fun FreshnessRow(state: UiState<AppearanceServerPrefs>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing || state.isLoading,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

@Composable
private fun ServerChoiceContainer(
    state: UiState<AppearanceServerPrefs>,
    saving: Boolean,
    sectionTitle: String,
    onRetry: () -> Unit,
    content: @Composable (prefs: AppearanceServerPrefs, enabled: Boolean) -> Unit,
) {
    when {
        state.isLoading ->
            Skeleton(modifier = Modifier.fillMaxWidth(), height = CHOICE_SKELETON_HEIGHT, rounded = true)
        state.isError && !state.hasData ->
            QueryError(
                kind = queryErrorKindOf(state),
                resourceName = sectionTitle,
                onRetry = onRetry,
                modifier = Modifier.fillMaxWidth(),
            )
        else -> content(state.data ?: AppearanceServerPrefs(), state.hasData && !saving)
    }
}

/** Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through. */
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
                FreshnessAge.Unknown -> "\u2014"
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

/** Collects the view-model's toast stream, localizes + tones each, and feeds the bottom [ToastHost] queue. */
@Composable
private fun AppearanceToastPresenter(
    viewModel: AppearanceSettingsViewModel,
    queue: androidx.compose.runtime.snapshots.SnapshotStateList<ToastItem>,
) {
    val shown = stringResource(R.string.translation_theme_statusBar_shownToast)
    val hidden = stringResource(R.string.translation_theme_statusBar_hiddenToast)
    val toursReset = stringResource(R.string.translation_settings_tours_resetDone)
    val scope = rememberCoroutineScope()
    var seq by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, shown, hidden, toursReset) {
        viewModel.toasts.collect { toast ->
            val item =
                when (toast) {
                    AppearanceToast.StatusBarShown -> ToastItem(seq++, shown, Tone.Info)
                    AppearanceToast.StatusBarHidden -> ToastItem(seq++, hidden, Tone.Info)
                    AppearanceToast.ToursReset -> ToastItem(seq++, toursReset, Tone.Success)
                }
            queue.add(item)
            if (queue.size > MAX_TOASTS) queue.removeAt(0)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

/** Classify a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/** Parses a `#RRGGBB` palette hex (web `CHART_COLORS_*`) into a Compose [Color]. */
private fun parseHexColor(hex: String): Color = Color(android.graphics.Color.parseColor(hex))

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)` for the keys the P1/S10 catalog does not yet define. `getIdentifier` is the only way to
 * attempt a key that may be absent, so `DiscouragedApi` is suppressed; release builds keep resource names
 * (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ───────────────────────────

private fun previewContentState(present: Boolean = true): UiState<AppearanceServerPrefs> =
    UiState(
        phase = if (present) UiPhase.Content else UiPhase.Empty,
        data =
            AppearanceServerPrefs(
                density = DensityId.Comfortable,
                timeFormat = TimeFormatId.Relative,
                chartPalette = ChartPaletteId.CbSafe,
                present = present,
            ),
        fetchedAt = 1L,
    )

@Preview(name = "Content — loaded", showBackground = true)
@Composable
private fun AppearanceContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AppearanceSettingsContent(
            serverState = previewContentState(),
            statusBar = StatusBarPrefs(),
            celebration = CelebrationPrefs(),
            sidebarStyle = SidebarStyle.Linear,
            saving = false,
        )
    }
}

@Preview(name = "Loading — skeleton pickers", showBackground = true)
@Composable
private fun AppearanceLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AppearanceSettingsContent(
            serverState = UiState.loading(),
            statusBar = StatusBarPrefs(),
            celebration = CelebrationPrefs(),
            sidebarStyle = SidebarStyle.Notion,
            saving = false,
        )
    }
}

@Preview(name = "Error — pickers retry", showBackground = true)
@Composable
private fun AppearanceErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AppearanceSettingsContent(
            serverState = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            statusBar = StatusBarPrefs(enabled = false),
            celebration = CelebrationPrefs(),
            sidebarStyle = SidebarStyle.Legacy,
            saving = false,
        )
    }
}
