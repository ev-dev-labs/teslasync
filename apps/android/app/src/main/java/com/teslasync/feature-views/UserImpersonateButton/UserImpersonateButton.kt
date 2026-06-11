// The native Jetpack Compose + Material 3 UserImpersonateButton feature view — a parity port of
// web/src/features/admin/components/UserImpersonateButton.tsx. The web component is a per-row admin action: a
// ghost `<Button>` (UserCog icon) that opens a warning `<ConfirmDialog>` and, on confirm, fires the
// `useStartImpersonation` mutation; while the mutation is pending it shows "Starting…", a spinner, and
// disables itself. Its parent owns the visibility decision, hiding it in open-mode installs
// (`useImpersonationStatus().data?.mode !== 'open'`).
//
// The native surface keeps that contract and performs NO HTTP. The host owns the shared P1/S8 state-holder
// layer and supplies: the impersonation-status feed as a cache-then-network [UiState] (web
// `useImpersonationStatus` / `useImpersonation`), the in-flight [starting] flag and [onStart] action (web
// `useStartImpersonation`), and [onRetry] (the feed's refetch). Because the host's feed carries the full
// lifecycle, this view also renders every state that layer can produce — loading, empty, open-mode, hard
// error with retry, and stale/offline cached views — folding the web parent's status gate into the same
// surface (the data sources this P3 prompt lists). A web-parity overload that takes only the button inputs is
// provided for hosts that already know the session is available.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UserImpersonateButton — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.userimpersonatebutton

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the impersonate action. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle state the host's impersonation-status feed (P1/S8) can carry. The host
 * owns the feed and the start mutation; this view never performs HTTP.
 *
 * @param subject the opaque proxy-issued subject identifier to impersonate (web `subject` prop).
 * @param statusState the cache-then-network projection of `useImpersonationStatus` / `useImpersonation`.
 * @param starting whether the start mutation is in flight (web `useStartImpersonation().isPending`).
 * @param onStart fires the host's start mutation for [subject] (web `startMut.mutate({ subject })`).
 * @param onRetry re-runs the host's status load — wired to the hard-error retry and the stale auto-refresh.
 * @param disabled the parent's disabled-row decision (web `disabled` prop).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun UserImpersonateButton(
    subject: String,
    statusState: UiState<ImpersonationView>,
    starting: Boolean,
    onStart: (subject: String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    disabled: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        UserImpersonateButtonDiagnostics.recordViewOpened(logger)
    }
    UserImpersonateButtonContent(
        subject = subject,
        state = statusState,
        starting = starting,
        onStart = onStart,
        onRetry = onRetry,
        modifier = modifier,
        disabled = disabled,
    )
}

/**
 * Web-parity overload mirroring the web component's minimal `{ subject, disabled }` prop surface, for hosts
 * that already gate visibility on the status mode (as the web parent does) and just need the button + dialog.
 * The status feed defaults to a loaded, inactive session — the button does not re-check the mode, matching the
 * web component's "the parent controls the visibility decision in one place" contract. [starting] / [onStart]
 * are still lifted out of the view so it performs no HTTP.
 */
@Composable
fun UserImpersonateButton(
    subject: String,
    starting: Boolean,
    onStart: (subject: String) -> Unit,
    modifier: Modifier = Modifier,
    disabled: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember {
            UiState(phase = UiPhase.Content, data = ImpersonationView(ImpersonationMode.Inactive))
        }
    UserImpersonateButton(
        subject = subject,
        statusState = state,
        starting = starting,
        onStart = onStart,
        onRetry = {},
        modifier = modifier,
        disabled = disabled,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web button +
 * ConfirmDialog (the [ImpersonateButtonSurface.Idle] branch) and adds the lifecycle chrome the host's feed
 * implies: a busy loading button, a friendly empty/open-mode affordance, a hard-error retry surface, and a
 * stale/offline freshness chip. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun UserImpersonateButtonContent(
    subject: String,
    state: UiState<ImpersonationView>,
    starting: Boolean,
    onStart: (subject: String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    disabled: Boolean = false,
    strings: UserImpersonateButtonStrings = rememberUserImpersonateButtonStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val model = UserImpersonateButtonProjection.project(subject, state, starting, disabled, strings)
    val formatAge = rememberImpersonateFreshnessFormatter()
    var dialogOpen by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        when (model.surface) {
            ImpersonateButtonSurface.Loading -> LoadingButton(model = model, strings = strings)
            ImpersonateButtonSurface.Error -> ImpersonateError(strings = strings, onRetry = onRetry)
            ImpersonateButtonSurface.Empty -> ImpersonateEmpty(strings = strings)
            ImpersonateButtonSurface.OpenMode -> ImpersonateOpenMode(strings = strings)
            ImpersonateButtonSurface.Offline ->
                ImpersonateActionRow(
                    model = model,
                    state = state,
                    strings = strings,
                    formatAge = formatAge,
                    showFreshness = true,
                    onClick = {},
                )
            ImpersonateButtonSurface.Stale ->
                ImpersonateActionRow(
                    model = model,
                    state = state,
                    strings = strings,
                    formatAge = formatAge,
                    showFreshness = true,
                    onClick = { dialogOpen = true },
                )
            ImpersonateButtonSurface.Idle ->
                ImpersonateActionRow(
                    model = model,
                    state = state,
                    strings = strings,
                    formatAge = formatAge,
                    showFreshness = false,
                    onClick = { dialogOpen = true },
                )
        }
    }

    if (dialogOpen) {
        ConfirmDialog(
            title = strings.confirmTitle,
            message = strings.confirmMessage(subject),
            confirmLabel = strings.confirmConfirm,
            cancelLabel = strings.confirmCancel,
            onConfirm = {
                dialogOpen = false
                onStart(subject)
            },
            onCancel = { dialogOpen = false },
            severity = ConfirmSeverity.Warning,
            closeLabel = strings.closeLabel,
        )
    }
}

/** The web content branch: the ghost "Impersonate" button, optionally beside a stale/offline freshness chip. */
@Composable
private fun ImpersonateActionRow(
    model: UserImpersonateButtonModel,
    state: UiState<ImpersonationView>,
    strings: UserImpersonateButtonStrings,
    formatAge: (FreshnessAge) -> String,
    showFreshness: Boolean,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ImpersonateActionButton(
            model = model,
            onClick = onClick,
            accessibleLabel = model.ariaLabel,
            busy = model.loading,
            enabled = model.enabled,
        )
        if (showFreshness) {
            FreshnessChip(state = state, strings = strings, formatAge = formatAge)
        }
    }
}

/** Loading chrome: a disabled, spinning button with an accessible "loading" label so the surface is never blank. */
@Composable
private fun LoadingButton(
    model: UserImpersonateButtonModel,
    strings: UserImpersonateButtonStrings,
) {
    ImpersonateActionButton(
        model = model,
        onClick = {},
        accessibleLabel = strings.loadingLabel,
        busy = true,
        enabled = false,
    )
}

/**
 * The shared ghost button — web `variant="ghost" size="sm"`, the UserCog leading icon, the interpolated
 * aria-label, and the stable web-parity test tag. [busy] drives the spinner (web `loading`), [enabled] the
 * `disabled || isPending` guard.
 */
@Composable
private fun ImpersonateActionButton(
    model: UserImpersonateButtonModel,
    onClick: () -> Unit,
    accessibleLabel: String,
    busy: Boolean,
    enabled: Boolean,
) {
    Button(
        label = model.actionLabel,
        onClick = onClick,
        modifier =
            Modifier
                .testTag(model.testTag)
                .semantics { contentDescription = accessibleLabel },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        enabled = enabled,
        loading = busy,
        leadingIcon = UserImpersonateButtonGlyphs.UserCog,
    )
}

/** Stale/offline freshness chip — maps the feed's freshness onto the shared [DataFreshness] indicator. */
@Composable
private fun FreshnessChip(
    state: UiState<ImpersonationView>,
    strings: UserImpersonateButtonStrings,
    formatAge: (FreshnessAge) -> String,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        fetchingLabel = strings.loadingLabel,
        errorLabel = strings.offlineLabel,
        formatAge = formatAge,
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ImpersonateError(
    strings: UserImpersonateButtonStrings,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty affordance — no actionable subject; never a blank box. */
@Composable
private fun ImpersonateEmpty(strings: UserImpersonateButtonStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = UserImpersonateButtonGlyphs.UserCog,
        title = strings.emptyTitle,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Open-mode affordance — impersonation requires forward-auth; the web parent hides the button here. */
@Composable
private fun ImpersonateOpenMode(strings: UserImpersonateButtonStrings) {
    EmptyState(
        message = strings.openModeMessage,
        icon = UserImpersonateButtonGlyphs.UserCog,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [UserImpersonateButtonStrings] from the i18n catalog (P1/S10): the `impersonation.*`
 * keys the web component reads plus the lifecycle-chrome keys. The interpolated aria-label / confirm message
 * resolve through `Context.getString` so the `%1$s` argument is filled by the catalog.
 */
@Composable
private fun rememberUserImpersonateButtonStrings(): UserImpersonateButtonStrings {
    val context = LocalContext.current
    val start = stringResource(R.string.translation_impersonation_button_start)
    val starting = stringResource(R.string.translation_impersonation_button_starting)
    val confirmTitle = stringResource(R.string.translation_impersonation_confirm_title)
    val confirmConfirm = stringResource(R.string.translation_impersonation_confirm_confirm)
    val confirmCancel = stringResource(R.string.translation_impersonation_confirm_cancel)
    val closeLabel = stringResource(R.string.translation_common_close)
    val emptyTitle = stringResource(R.string.translation_impersonation_users_emptyTitle)
    val emptyMessage = stringResource(R.string.translation_impersonation_users_emptyMessage)
    val openModeMessage = stringResource(R.string.translation_impersonation_users_openMode)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retry = stringResource(R.string.translation_common_retry)
    val loadingLabel = stringResource(R.string.translation_common_loading)
    val offlineLabel = stringResource(R.string.translation_common_offline)
    return remember(context, start, starting, confirmTitle, emptyMessage, openModeMessage, errorMessage) {
        UserImpersonateButtonStrings(
            start = start,
            starting = starting,
            confirmTitle = confirmTitle,
            confirmConfirm = confirmConfirm,
            confirmCancel = confirmCancel,
            closeLabel = closeLabel,
            emptyTitle = emptyTitle,
            emptyMessage = emptyMessage,
            openModeMessage = openModeMessage,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
            loadingLabel = loadingLabel,
            offlineLabel = offlineLabel,
            ariaLabel = { value -> context.getString(R.string.translation_impersonation_button_aria, value) },
            confirmMessage = { value -> context.getString(R.string.translation_impersonation_confirm_message, value) },
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberImpersonateFreshnessFormatter(): (FreshnessAge) -> String {
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
