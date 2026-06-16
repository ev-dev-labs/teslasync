// The native Jetpack Compose + Material 3 OnboardingPage surface — a parity port of
// web/src/features/onboarding/pages/OnboardingPage.tsx, the first-run setup checklist. It reproduces the page's
// single panel (GlassPanel1 — the sparkle intro header, the three-step checklist rendered through the shared
// Stepper feature view, the footer status line + actions, and the help links), every data state (loading
// spinner → resolved success panel), and every visible string (resolved from the generated res/values catalog,
// ADR-014). None of the gate fields is unit-bearing (two booleans, a count, the server-computed `is_complete`),
// so there is no SI conversion.
//
// Composition: [OnboardingPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the gate feed, and binds the navigation seams);
// [OnboardingPageContent] is the stateless render layer driven entirely by [UiState] + [OnboardingActions]. All
// derivation lives in the framework-free model (OnboardingPageModel.kt) + the shared Stepper projection; this
// file only resolves i18n + draws. No `LocalNavController` is exposed to page hosts (the GlancePage/ArchivedPage
// precedent), so in-app routes open through the registered deep-link scheme and the "continue/skip" actions
// leave the standalone surface via the system back-dispatcher; external docs open in the browser — all through
// the sanctioned [LocalUriHandler] / back-dispatcher seams.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/onboarding) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package io.teslasync.android.onboarding

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.stepper.Stepper
import io.teslasync.android.featureviews.stepper.StepperRow
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus

/** The sparkle-chip side length (web `h-10 w-10`). */
private val INTRO_CHIP_SIZE = 40.dp

/** Tint alpha for the intro chip background (web `bg-cyan-500/10`). */
private const val INTRO_CHIP_ALPHA = 0.12f

/** The page's interaction callbacks, wired to the [OnboardingPageViewModel] + navigation seams (web handlers). */
data class OnboardingActions(
    /** Web tesla `cta.to = /tesla-account` (primary nav) + the footer "Tesla account page" link. */
    val onConnectTesla: () -> Unit,
    /** Web vehicle `cta.onClick` (refetch) + the "Check again" action. */
    val onRefresh: () -> Unit,
    /** Web telemetry `cta.href = /docs/fleet-telemetry-setup` ("Setup guide"). */
    val onOpenSetupGuide: () -> Unit,
    /** Web footer `<a href="/docs/">` ("documentation"). */
    val onOpenDocs: () -> Unit,
    /** Web "Continue to dashboard" — `navigate('/')`; leaves the standalone onboarding surface. */
    val onContinue: () -> Unit,
    /** Web "Skip for now" — `skip()` + `navigate('/')`; leaves the standalone onboarding surface. */
    val onSkip: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [OnboardingPageViewModel] over the supplied [source] (the host wires the shared
 * onboarding gate via [asOnboardingPageSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun OnboardingPage(
    source: OnboardingPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: OnboardingPageViewModel =
        viewModel(
            key = OnboardingPageRegistration.SLUG,
            factory = viewModelFactory { initializer { OnboardingPageViewModel(source, logger) } },
        )
    OnboardingPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic, collects the gate feed, and resolves the
 * navigation seams — in-app routes through the registered deep-link scheme ([LocalUriHandler]), external docs in
 * the browser, and "continue/skip" through the system back-dispatcher (the sanctioned page-host seam; no
 * `LocalNavController` is exposed to hosts) — into the stateless content's [OnboardingActions].
 */
@Composable
fun OnboardingPage(
    viewModel: OnboardingPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.status.collectAsStateWithLifecycle()

    val uriHandler = LocalUriHandler.current
    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    val leaveSurface: () -> Unit = remember(backDispatcher) { { backDispatcher?.onBackPressed() ?: Unit } }

    val actions =
        remember(viewModel, uriHandler, leaveSurface) {
            OnboardingActions(
                onConnectTesla = { openUriSafely(uriHandler, appDeepLink(OnboardingNav.TESLA_ACCOUNT_PATH)) },
                onRefresh = viewModel::refresh,
                onOpenSetupGuide = { openUriSafely(uriHandler, webDocUrl(OnboardingNav.TELEMETRY_DOCS_PATH)) },
                onOpenDocs = { openUriSafely(uriHandler, webDocUrl(OnboardingNav.DOCS_PATH)) },
                onContinue = leaveSurface,
                onSkip = leaveSurface,
            )
        }

    val paneTitleText = stringResource(R.string.translation_onboarding_welcome)
    OnboardingPageContent(
        state = state,
        actions = actions,
        modifier = modifier.semantics { paneTitle = paneTitleText },
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header (web `PageContainer` title/subtitle) above the single
 * surface that switches between the first-load spinner (web `PageContainer loading={isLoading}`) and the
 * resolved checklist panel. The gate carries safe pessimistic defaults, so once a value resolves — even a hard
 * error with no cache — the panel renders every step honestly rather than blanking.
 */
@Composable
fun OnboardingPageContent(
    state: UiState<OnboardingStatus>,
    actions: OnboardingActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        OnboardingHeader()

        if (state.isLoading) {
            OnboardingLoading()
        } else {
            FadeIn {
                OnboardingPanel(
                    status = state.data.orPessimisticDefaults(),
                    isFetching = state.refreshing,
                    actions = actions,
                )
            }
        }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun OnboardingHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_onboarding_welcome))
        BodyText(
            stringResource(R.string.translation_onboarding_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The loading data state — the first-load spinner that replaces the panel (web `PageContainer loading`). */
@Composable
private fun OnboardingLoading(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxWidth().padding(vertical = Spacing.xl3),
        contentAlignment = Alignment.Center,
    ) {
        Spinner(size = SpinnerSize.Lg, label = stringResource(R.string.translation_onboarding_pageTitle))
    }
}

// ── GlassPanel1 — the setup checklist ─────────────────────────────────────────────────────────────────────────

/**
 * The single panel (web `<GlassPanel>`): the sparkle intro header, the three-step checklist (the shared Stepper),
 * a divider, the footer status line + actions, and the help links. This is the success data state — every named
 * region renders from the resolved gate [status].
 */
@Composable
private fun OnboardingPanel(
    status: OnboardingStatus,
    isFetching: Boolean,
    actions: OnboardingActions,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        OnboardingIntro()
        Spacer(Modifier.height(Spacing.lg))
        OnboardingStepper(status = status, isFetching = isFetching, actions = actions)
        Spacer(Modifier.height(Spacing.lg))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(Spacing.lg))
        OnboardingFooter(isComplete = status.isComplete, isFetching = isFetching, actions = actions)
        Spacer(Modifier.height(Spacing.lg))
        OnboardingHelpFooter(actions = actions)
    }
}

/** The intro header: the sparkle chip beside the checklist title + description (web intro block). */
@Composable
private fun OnboardingIntro() {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Box(
            modifier =
                Modifier
                    .size(INTRO_CHIP_SIZE)
                    .clip(MaterialTheme.shapes.medium)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = INTRO_CHIP_ALPHA)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                OnboardingGlyphs.Sparkles,
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(stringResource(R.string.translation_onboarding_intro_title))
            BodyText(
                stringResource(R.string.translation_onboarding_intro_desc),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The three-step checklist, rendered through the shared Stepper with per-step CTAs (web `<Stepper renderCta>`). */
@Composable
private fun OnboardingStepper(
    status: OnboardingStatus,
    isFetching: Boolean,
    actions: OnboardingActions,
) {
    val labels =
        OnboardingStepLabels(
            teslaTitle = stringResource(R.string.translation_onboarding_tesla_title),
            teslaDescription = stringResource(R.string.translation_onboarding_tesla_desc),
            teslaCta = stringResource(R.string.translation_onboarding_tesla_cta),
            vehicleTitle = stringResource(R.string.translation_onboarding_vehicle_title),
            vehicleDescription = stringResource(R.string.translation_onboarding_vehicle_desc),
            vehicleCta = stringResource(R.string.translation_onboarding_vehicle_cta),
            vehicleChecking = stringResource(R.string.translation_onboarding_vehicle_checking),
            telemetryTitle = stringResource(R.string.translation_onboarding_telemetry_title),
            telemetryDescription = stringResource(R.string.translation_onboarding_telemetry_desc),
            telemetryDocs = stringResource(R.string.translation_onboarding_telemetry_docs),
        )
    val steps = remember(status, isFetching, labels) { onboardingSteps(status, isFetching, labels) }
    Stepper(
        steps = steps,
        renderCta = { row -> OnboardingStepCtaButton(row = row, isFetching = isFetching, actions = actions) },
    )
}

/**
 * The current step's CTA, branching exactly like the web `renderCta`: an `to` route renders the primary
 * "Connect Tesla account" navigation button; an `href` renders the outline "Setup guide" link (book icon + an
 * external-link affordance); otherwise the outline "Refresh" action that spins + disables while [isFetching].
 */
@Composable
private fun OnboardingStepCtaButton(
    row: StepperRow,
    isFetching: Boolean,
    actions: OnboardingActions,
) {
    val cta = row.cta ?: return
    when {
        cta.to != null ->
            Button(
                label = cta.label,
                onClick = actions.onConnectTesla,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = OnboardingGlyphs.ArrowRight,
            )

        cta.href != null ->
            Button(
                onClick = actions.onOpenSetupGuide,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
            ) {
                Icon(OnboardingGlyphs.BookOpen, contentDescription = null, size = IconSize.Sm)
                Spacer(Modifier.width(Spacing.sm))
                Text(cta.label, style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.width(Spacing.xs))
                Icon(OnboardingGlyphs.ExternalLink, contentDescription = null, size = IconSize.Xs)
            }

        else ->
            Button(
                label = cta.label,
                onClick = actions.onRefresh,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                enabled = !cta.disabled,
                loading = isFetching,
                leadingIcon = OnboardingGlyphs.RefreshCw,
            )
    }
}

/**
 * The footer: the auto-refresh / all-set status line (web `isComplete ? ready : polling`) and the actions —
 * "Check again" always, "Skip for now" while incomplete, and "Continue to dashboard" once complete.
 */
@Composable
private fun OnboardingFooter(
    isComplete: Boolean,
    isFetching: Boolean,
    actions: OnboardingActions,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        BodyText(
            stringResource(
                if (isComplete) R.string.translation_onboarding_ready else R.string.translation_onboarding_polling,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Button(
                label = stringResource(R.string.translation_onboarding_checkAgain),
                onClick = actions.onRefresh,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = !isFetching,
                loading = isFetching,
                leadingIcon = OnboardingGlyphs.RefreshCw,
            )
            if (!isComplete) {
                Tooltip(text = stringResource(R.string.translation_onboarding_skipHint)) {
                    Button(
                        label = stringResource(R.string.translation_onboarding_skip),
                        onClick = actions.onSkip,
                        variant = ButtonVariant.Outline,
                        size = ButtonSize.Sm,
                        leadingIcon = OnboardingGlyphs.SkipForward,
                    )
                }
            }
            if (isComplete) {
                Button(
                    label = stringResource(R.string.translation_onboarding_continue),
                    onClick = actions.onContinue,
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = OnboardingGlyphs.ArrowRight,
                )
            }
        }
    }
}

/**
 * The help line (web `<p>Need help? See the <Link>…</Link> or the <a>…</a>.</p>`): muted copy with two inline
 * links — the Tesla account page (in-app) and the documentation (external) — wrapped so the sentence reflows on
 * narrow widths.
 */
@Composable
private fun OnboardingHelpFooter(actions: OnboardingActions) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        HelperText(stringResource(R.string.translation_onboarding_footer_help))
        OnboardingLink(
            text = stringResource(R.string.translation_onboarding_footer_account),
            onClick = actions.onConnectTesla,
        )
        HelperText(stringResource(R.string.translation_onboarding_footer_or).trim())
        OnboardingLink(
            text = stringResource(R.string.translation_onboarding_footer_docs),
            onClick = actions.onOpenDocs,
        )
    }
}

/** An inline, underlined, primary-tinted text link (web `text-cyan-300 underline`), announced as a button. */
@Composable
private fun OnboardingLink(
    text: String,
    onClick: () -> Unit,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall.copy(textDecoration = TextDecoration.Underline),
        color = MaterialTheme.colorScheme.primary,
        modifier =
            Modifier
                .clickable(onClick = onClick)
                .semantics { role = Role.Button },
    )
}

// ── Navigation helpers ──────────────────────────────────────────────────────────────────────────────────────

/** The app deep-link URI for an in-app [path] (e.g. `teslasync://app/tesla-account`); routed by the NavHost. */
private fun appDeepLink(path: String): String = "${RouteTable.APP_SCHEME}://app$path"

/** The public web URL for an external doc [path] (e.g. `https://app.teslasync.io/docs/…`); opened in the browser. */
private fun webDocUrl(path: String): String = "https://${RouteTable.APP_HOST}$path"

/**
 * Opens [uri] through the ambient handler, swallowing the rare `IllegalStateException` Android raises when no
 * activity can handle the intent (e.g. no browser installed) so a doc/nav tap can never crash the first-run flow.
 */
private fun openUriSafely(
    uriHandler: androidx.compose.ui.platform.UriHandler,
    uri: String,
) {
    runCatching { uriHandler.openUri(uri) }
}
