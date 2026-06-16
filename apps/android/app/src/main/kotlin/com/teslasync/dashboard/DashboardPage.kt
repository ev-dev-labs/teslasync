// The native Jetpack Compose + Material 3 DashboardPage command-center surface — a parity port of
// web/src/features/dashboard/pages/DashboardPage.tsx. The web page is a large layout host (widget grid, kiosk
// mode, undo/redo, templates); the parity manifest distils it to its first-run onboarding/auth surface plus the
// page chrome. This port reproduces the page header (title + subtitle), the view/edit-mode action toolbars, the
// theme/error/auth/customize/edit banners, and the two GlassPanels — GlassPanel 1 (the onboarding/welcome panel
// whose copy + primary action switch on whether the Tesla account is connected) and GlassPanel 2 (the four
// capability feature tiles) — across every data state (loading skeleton / hard-error retry / content). Every
// visible string resolves from the generated res/values catalog (ADR-014).
//
// Composition: [DashboardPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, folds the auth-status snapshot + sync-in-flight flag);
// [DashboardPageContent] is the stateless render layer that owns only ephemeral view state (edit mode, banner
// dismissals, the reset-confirm dialog). The bound [DashboardPageViewModel.state] — `UiState<AuthStatus>`, the
// fold of the web page's `useAuthStatus` query — drives the onboarding panel + auth banner, exactly as the web
// page threads `auth?.authenticated` into its onboarding copy.
//
// Scope boundary (see the evidence log): the web dashboard's full layout/widget/kiosk/undo-redo engine and the
// cross-page connect navigation are NOT in this parity unit. The toolbar renders the chrome strings for header
// parity; the edit-mode toggle, the Sync action, and the reset-confirm dialog are functional, undo/redo are
// correctly disabled (web `canUndo`/`canRedo` are false with no edits), and the remaining layout/connect
// affordances emit a PII-safe diagnostic. The parity unit is the onboarding/auth surface + the chrome strings.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package io.teslasync.android.dashboard.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.AuthStatus

/** Stagger between the body sections' entrance fades (web `FadeIn`). */
private const val FADE_STEP_MS = 50

/** The onboarding panel loading-skeleton heights + widths (the welcome heading / body / action skeleton bars). */
private val ONBOARDING_TITLE_SKELETON_HEIGHT = 28.dp
private val ONBOARDING_BODY_SKELETON_HEIGHT = 16.dp
private val ONBOARDING_ACTION_SKELETON_HEIGHT = 40.dp
private const val ONBOARDING_TITLE_SKELETON_FRACTION = 0.6f
private const val ONBOARDING_BODY_SKELETON_FRACTION = 0.9f
private const val ONBOARDING_ACTION_SKELETON_FRACTION = 0.45f

/** Stable diagnostic keys for the chrome affordances whose full engine is outside this parity unit. */
private const val CHROME_CONNECT = "onboarding.connect"
private const val CHROME_ADD_WIDGET = "dashboard.addWidget"
private const val CHROME_AUTO_ARRANGE = "dashboard.autoArrange"
private const val CHROME_TEMPLATES = "dashboard.templates"
private const val CHROME_NEW_DASHBOARD = "dashboard.newDashboard"
private const val CHROME_KIOSK = "dashboard.kiosk"
private const val CHROME_PRINT = "dashboard.printSnapshot"
private const val CHROME_THEME_OPEN = "theme.firstRunOpen"

/** The page's interaction callbacks, wired to the [DashboardPageViewModel]. */
data class DashboardActions(
    val onSync: () -> Unit,
    val onRetry: () -> Unit,
    val onChrome: (String) -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DashboardPageViewModel] over the supplied [source] (the host wires the shared
 * S8 Settings + Vehicles stores via [dashboardPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun DashboardPage(
    source: DashboardPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DashboardPageViewModel =
        viewModel(
            key = DashboardPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DashboardPageViewModel(source, logger) } },
        )
    DashboardPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] auth snapshot + sync-in-flight flag + callbacks to the stateless content. */
@Composable
fun DashboardPage(
    viewModel: DashboardPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val syncing by viewModel.syncing.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            DashboardActions(
                onSync = viewModel::syncVehicles,
                onRetry = viewModel::retry,
                onChrome = viewModel::recordChromeAction,
            )
        }

    DashboardPageContent(state = state, syncing = syncing, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the page chrome (title + subtitle), the view/edit action toolbars, the four banners
 * (theme first-run / load error / auth-not-connected / customize hint), the edit hint, and the two always-visible
 * GlassPanels (onboarding + feature tiles). Owns only ephemeral view state (edit mode, banner dismissals, the
 * reset-confirm dialog); the auth snapshot comes entirely from [state].
 */
@Composable
fun DashboardPageContent(
    state: UiState<AuthStatus>,
    syncing: Boolean,
    actions: DashboardActions,
    modifier: Modifier = Modifier,
) {
    var editMode by rememberSaveable { mutableStateOf(false) }
    var themeDismissed by rememberSaveable { mutableStateOf(false) }
    var hintDismissed by rememberSaveable { mutableStateOf(false) }
    var showResetConfirm by remember { mutableStateOf(false) }

    val authenticated = authenticatedOrDefault(state.data)

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DashboardHeader()

        DashboardActionsToolbar(
            editMode = editMode,
            onEnterEdit = { editMode = true },
            onExitEdit = { editMode = false },
            onReset = { showResetConfirm = true },
            onChrome = actions.onChrome,
        )

        if (!themeDismissed) {
            ThemeFirstRunBanner(onOpen = { actions.onChrome(CHROME_THEME_OPEN); themeDismissed = true }, onDismiss = { themeDismissed = true })
        }

        if (state.hasError) {
            LoadErrorBanner()
        }

        if (state.isContent && !authenticated) {
            AuthNotConnectedBanner()
        }

        if (!hintDismissed && !editMode) {
            CustomizeHintBanner(onAdd = { actions.onChrome(CHROME_ADD_WIDGET); hintDismissed = true }, onDismiss = { hintDismissed = true })
        }

        if (editMode) {
            EditModeHint()
        }

        FadeIn { DashboardOnboardingPanel(state = state, authenticated = authenticated, syncing = syncing, actions = actions) }
    }

    if (showResetConfirm) {
        ResetConfirmDialog(
            onConfirm = { actions.onChrome(CHROME_NEW_DASHBOARD); showResetConfirm = false },
            onCancel = { showResetConfirm = false },
        )
    }
}

/** The page chrome — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun DashboardHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_title))
        BodyText(
            stringResource(R.string.translation_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The header action toolbar (web `headerActions`). In view mode it shows Customize / Kiosk / Print-snapshot; in
 * edit mode it swaps to Undo / Redo / Add-Widget / Auto-Arrange / Templates / New-Dashboard / Reset / Done. Undo
 * and Redo are disabled, mirroring the web's `disabled={!canUndo}` with no edits applied yet.
 */
@Composable
private fun DashboardActionsToolbar(
    editMode: Boolean,
    onEnterEdit: () -> Unit,
    onExitEdit: () -> Unit,
    onReset: () -> Unit,
    onChrome: (String) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (editMode) {
            ToolbarButton(label = stringResource(R.string.translation_dashboard_undo), enabled = false, onClick = {})
            ToolbarButton(label = stringResource(R.string.translation_dashboard_redo), enabled = false, onClick = {})
            ToolbarButton(label = stringResource(R.string.translation_dashboard_addWidget), icon = TeslaGlyphs.Plus, onClick = { onChrome(CHROME_ADD_WIDGET) })
            ToolbarButton(label = stringResource(R.string.translation_dashboard_autoArrange), icon = NavGlyphs.Dashboard, onClick = { onChrome(CHROME_AUTO_ARRANGE) })
            ToolbarButton(label = stringResource(R.string.translation_dashboard_templates), onClick = { onChrome(CHROME_TEMPLATES) })
            ToolbarButton(label = stringResource(R.string.translation_dashboard_newDashboard), onClick = { onChrome(CHROME_NEW_DASHBOARD) })
            ToolbarButton(label = stringResource(R.string.translation_dashboard_reset), icon = FeedbackGlyphs.Refresh, onClick = onReset)
            ToolbarButton(label = stringResource(R.string.translation_dashboard_done), variant = ButtonVariant.Primary, icon = TeslaGlyphs.Check, onClick = onExitEdit)
        } else {
            ToolbarButton(label = stringResource(R.string.translation_dashboard_customize), icon = NavGlyphs.Gear, onClick = onEnterEdit)
            ToolbarButton(label = stringResource(R.string.translation_dashboard_kiosk), icon = TeslaGlyphs.Fullscreen, onClick = { onChrome(CHROME_KIOSK) })
            ToolbarButton(label = stringResource(R.string.translation_dashboard_printSnapshot), icon = TeslaGlyphs.Printer, onClick = { onChrome(CHROME_PRINT) })
        }
    }
}

/** A single ghost-by-default toolbar action (web header `<Button variant="ghost" size="sm">`). */
@Composable
private fun ToolbarButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    Button(
        label = label,
        onClick = onClick,
        modifier = modifier,
        variant = variant,
        size = size,
        enabled = enabled,
        leadingIcon = icon,
    )
}

/** The theme first-run prompt (web `ThemeFirstRunBanner`). Dismissable; both actions also dismiss it. */
@Composable
private fun ThemeFirstRunBanner(
    onOpen: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertBanner(
        message = stringResource(R.string.translation_theme_firstRunBody),
        tone = Tone.Info,
        title = stringResource(R.string.translation_theme_firstRunTitle),
        action = BannerAction(label = stringResource(R.string.translation_theme_firstRunOpen), onClick = onOpen),
        secondaryAction = BannerAction(label = stringResource(R.string.translation_theme_firstRunLater), onClick = onDismiss),
        onClose = onDismiss,
    )
}

/** The data-load error banner (web `anyError` AlertBanner). Shown whenever the auth-status read has failed. */
@Composable
private fun LoadErrorBanner() {
    AlertBanner(
        message = stringResource(R.string.translation_error_loadFailed),
        tone = Tone.Danger,
    )
}

/**
 * The Tesla-account-not-connected warning (web `auth && !auth.authenticated` AlertBanner). The message joins the
 * web's three fragments — "Connect your account in" + "Settings" + "to start tracking." — verbatim, exactly as
 * the web renders them inline around the Settings link.
 */
@Composable
private fun AuthNotConnectedBanner() {
    val connectPrompt = stringResource(R.string.translation_auth_connectPrompt)
    val settings = stringResource(R.string.translation_auth_settings)
    val toStart = stringResource(R.string.translation_auth_toStart)
    AlertBanner(
        message = "$connectPrompt $settings $toStart",
        tone = Tone.Warning,
        title = stringResource(R.string.translation_auth_notConnected),
    )
}

/** The soft "you can customize this dashboard" hint (web `hintReady` AlertBanner). Dismissable. */
@Composable
private fun CustomizeHintBanner(
    onAdd: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertBanner(
        message = stringResource(R.string.translation_dashboard_customizeHint),
        tone = Tone.Info,
        action = BannerAction(label = stringResource(R.string.translation_dashboard_customizeHintCta), onClick = onAdd),
        onClose = onDismiss,
    )
}

/** The edit-mode helper line (web `editMode` dashed hint box). */
@Composable
private fun EditModeHint() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        BodyText(
            stringResource(R.string.translation_dashboard_editHint),
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * GlassPanel 1 — the onboarding/welcome panel (web `EmptyOnboarding`). On the first auth-status load it shows a
 * skeleton; on a hard error it shows the retry surface; once loaded it shows the connected-vs-disconnected copy:
 * connected ⇒ "Sync Your Vehicles" + the Sync action (spinner driven by [syncing]); not connected ⇒ "Welcome to
 * TeslaSync" + the Connect action. The four feature tiles (GlassPanel 2) render below in the content state.
 */
@Composable
private fun DashboardOnboardingPanel(
    state: UiState<AuthStatus>,
    authenticated: Boolean,
    syncing: Boolean,
    actions: DashboardActions,
) {
    val sectionTitle =
        if (authenticated) {
            stringResource(R.string.translation_onboarding_syncTitle)
        } else {
            stringResource(R.string.translation_onboarding_title)
        }
    GlassPanel(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = sectionTitle },
        padding = PanelPadding.Lg,
    ) {
        when {
            state.isLoading -> OnboardingSkeleton()
            state.isError -> OnboardingError(onRetry = actions.onRetry)
            else -> OnboardingContent(authenticated = authenticated, syncing = syncing, actions = actions)
        }
    }
}

/** The loaded onboarding content — the title, the description, the primary action, and the feature tiles. */
@Composable
private fun OnboardingContent(
    authenticated: Boolean,
    syncing: Boolean,
    actions: DashboardActions,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Heading(
            text =
                if (authenticated) {
                    stringResource(R.string.translation_onboarding_syncTitle)
                } else {
                    stringResource(R.string.translation_onboarding_title)
                },
            level = HeadingLevel.Page,
        )
        BodyText(
            text =
                if (authenticated) {
                    stringResource(R.string.translation_onboarding_syncDesc)
                } else {
                    stringResource(R.string.translation_onboarding_desc)
                },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (authenticated) {
            Button(
                label = stringResource(R.string.translation_onboarding_sync),
                onClick = actions.onSync,
                variant = ButtonVariant.Primary,
                loading = syncing,
                leadingIcon = FeedbackGlyphs.Refresh,
            )
        } else {
            Button(
                label = stringResource(R.string.translation_onboarding_connect),
                onClick = { actions.onChrome(CHROME_CONNECT) },
                variant = ButtonVariant.Primary,
                leadingIcon = DataDisplayGlyphs.ArrowRight,
            )
        }
        DashboardFeatureTiles()
    }
}

/** GlassPanel 2 (×4) — the capability feature tiles (web `EmptyOnboarding` feature grid). */
@Composable
private fun DashboardFeatureTiles() {
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        DashboardFeatureTile(
            label = stringResource(R.string.translation_onboarding_tracking),
            icon = DataDisplayGlyphs.Gauge,
            tint = TeslaTokens.status.info,
        )
        DashboardFeatureTile(
            label = stringResource(R.string.translation_onboarding_drives),
            icon = NavGlyphs.Route,
            tint = MaterialTheme.colorScheme.primary,
        )
        DashboardFeatureTile(
            label = stringResource(R.string.translation_onboarding_charging),
            icon = DataDisplayGlyphs.BatteryCharging,
            tint = TeslaTokens.status.success,
        )
        DashboardFeatureTile(
            label = stringResource(R.string.translation_onboarding_control),
            icon = DataDisplayGlyphs.Shield,
            tint = TeslaTokens.status.danger,
        )
    }
}

/** One capability tile — a small GlassPanel with a tinted glyph above its label (web feature `GlassPanel`). */
@Composable
private fun DashboardFeatureTile(
    label: String,
    icon: ImageVector,
    tint: Color,
) {
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = label },
        padding = PanelPadding.Md,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Lg, tint = tint)
            Caption(label)
        }
    }
}

/** The onboarding panel's first-load skeleton (web `LoadingSkeleton`). */
@Composable
private fun OnboardingSkeleton() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = ONBOARDING_TITLE_SKELETON_FRACTION, height = ONBOARDING_TITLE_SKELETON_HEIGHT)
        Skeleton(widthFraction = ONBOARDING_BODY_SKELETON_FRACTION, height = ONBOARDING_BODY_SKELETON_HEIGHT)
        Skeleton(widthFraction = ONBOARDING_ACTION_SKELETON_FRACTION, height = ONBOARDING_ACTION_SKELETON_HEIGHT, rounded = true)
    }
}

/** The onboarding panel's hard-error surface — a localized retry-able error (web `anyError`; ADR-011). */
@Composable
private fun OnboardingError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * The reset confirmation (web `window.confirm(t('layout.resetMessage'))` in the command-palette reset handler).
 * Renders the reset message verbatim and, on confirm, falls back to creating a fresh "New Dashboard" — the web
 * blank-template path — recorded as a diagnostic since the layout engine is outside this parity unit.
 */
@Composable
private fun ResetConfirmDialog(
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    ConfirmDialog(
        title = stringResource(R.string.translation_dashboard_reset),
        message = stringResource(R.string.translation_layout_resetMessage),
        confirmLabel = stringResource(R.string.translation_common_confirm),
        cancelLabel = stringResource(R.string.translation_common_cancel),
        onConfirm = onConfirm,
        onCancel = onCancel,
        severity = ConfirmSeverity.Warning,
    )
}
