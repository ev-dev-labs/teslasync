// The native Jetpack Compose + Material 3 UsersPage admin surface — a parity port of
// web/src/features/admin/pages/UsersPage.tsx, the admin Subjects (impersonation targets) list. It reproduces the
// web page's single GlassPanel and every branch the web component renders inside it: the open-mode notice (web
// `data-testid="users-page-open-mode"`), the loading spinner, the hard-error retry, the no-subjects empty state,
// and the subjects list whose rows pair the opaque subject identifier with the shared UserImpersonateButton
// feature view (web `<UserImpersonateButton subject disabled={active} />`). Every visible string resolves from
// the generated res/values catalog (ADR-014); the opaque subject carries no display-unit fields, so there is no
// SI conversion (S5).
//
// Composition mirrors the sibling admin surfaces: [UsersPage] is the stateful entry (constructs the view-model
// over the host-wired source, records the one-shot `view.opened` diagnostic, collects the feeds);
// [UsersPageContent] is the stateless render layer that draws the title/subtitle header and the panel's
// open-mode / loading / error / empty / success surface. All derivation lives in the framework-free model
// (UsersPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.users

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.userimpersonatebutton.UserImpersonateButton
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidate
import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidatesResponse

// ── Test tags (web `data-testid` parity) ──────────────────────────────────────────────────────────────────────
private const val TAG_OPEN_MODE = "users-page-open-mode"
private const val TAG_LOADING = "users-page-loading"
private const val TAG_ERROR = "users-page-error"
private const val TAG_EMPTY = "users-page-empty"
private const val TAG_LIST = "users-page-list"

private fun rowTag(subject: String): String = "users-page-row-$subject"

/** The page's interaction callbacks, wired to the [UsersPageViewModel] (web event handlers). */
data class UsersPageActions(
    val onStart: (subject: String) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [UsersPageViewModel] over the supplied [source] (the host wires the shared S8
 * [io.teslasync.shared.core.presentation.impersonation.ImpersonationStore] via [asUsersPageSource]). The
 * view-model is keyed by this surface's slug so it is scoped to the navigation entry. [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun UsersPage(
    source: UsersPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: UsersPageViewModel =
        viewModel(
            key = UsersPageRegistration.SLUG,
            factory = viewModelFactory { initializer { UsersPageViewModel(source, logger) } },
        )
    UsersPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: records the one-shot `view.opened` diagnostic and binds the feeds to the stateless content. */
@Composable
fun UsersPage(
    viewModel: UsersPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val openMode by viewModel.isOpenMode.collectAsStateWithLifecycle()
    val active by viewModel.isActive.collectAsStateWithLifecycle()
    val candidatesState by viewModel.candidatesState.collectAsStateWithLifecycle()
    val startingSubject by viewModel.startingSubject.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            UsersPageActions(onStart = viewModel::startImpersonation, onRetry = viewModel::retry)
        }

    UsersPageContent(
        openMode = openMode,
        candidatesState = candidatesState,
        active = active,
        startingSubject = startingSubject,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header (web `PageContainer` chrome) above the single GlassPanel
 * whose content branches exactly as the web component does — open-mode notice first (web `open`), then the
 * candidates feed's loading / error / empty / success surface. The panel keeps no inner padding so each branch
 * owns its own spacing, mirroring the web page's per-branch `p-6` / `p-8` / row `px-4 py-3`.
 */
@Composable
fun UsersPageContent(
    openMode: Boolean,
    candidatesState: UiState<ImpersonationCandidatesResponse>,
    active: Boolean,
    startingSubject: String?,
    actions: UsersPageActions,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        UsersPageHeader()

        GlassPanel(padding = PanelPadding.None) {
            when {
                // GlassPanel1 — open-mode notice (web `open ? <div data-testid="users-page-open-mode">`).
                openMode -> OpenModeNotice()

                // loading (web `candidates.isLoading ? <Spinner />`).
                candidatesState.isLoading -> UsersLoadingState()

                // error (web `candidates.isError ? <ErrorDisplay onRetry={candidates.refetch} />`).
                candidatesState.isError -> UsersErrorState(onRetry = actions.onRetry)

                // empty (web `subjects.length === 0 ? <EmptyState />`).
                candidatesState.isEmpty -> UsersEmptyState()

                // success (web `<ul data-testid="users-page-list">` of subject rows).
                else ->
                    SubjectsList(
                        subjects = candidatesState.data?.subjects() ?: emptyList(),
                        active = active,
                        startingSubject = startingSubject,
                        onStart = actions.onStart,
                    )
            }
        }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun UsersPageHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_impersonation_users_title))
        BodyText(
            stringResource(R.string.translation_impersonation_users_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Panel branches ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Open-mode notice — the install runs without forward-auth, so per-user identity is unavailable (web
 * `impersonation.users.openMode`). Shown in place of the list, never as a blank region.
 */
@Composable
private fun OpenModeNotice() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(TAG_OPEN_MODE)
                .padding(Spacing.lg),
    ) {
        BodyText(
            stringResource(R.string.translation_impersonation_users_openMode),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** First-load surface — a centered spinner so the panel region is never blank (web `<Spinner />`). */
@Composable
private fun UsersLoadingState() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(TAG_LOADING)
                .padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

/** Hard-error surface with a retry affordance (web `<ErrorDisplay error onRetry={candidates.refetch} />`). */
@Composable
private fun UsersErrorState(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth().testTag(TAG_ERROR),
    )
}

/** No-subjects surface — there is no other active subject to impersonate (web `<EmptyState />`). */
@Composable
private fun UsersEmptyState() {
    EmptyState(
        title = stringResource(R.string.translation_impersonation_users_emptyTitle),
        message = stringResource(R.string.translation_impersonation_users_emptyMessage),
        modifier = Modifier.fillMaxWidth().testTag(TAG_EMPTY),
    )
}

/**
 * The subjects list — the web `<ul data-testid="users-page-list">`: each row pairs the monospace subject
 * identifier with the shared UserImpersonateButton, separated by hairline dividers (web `divide-y`). The button
 * is disabled while a session is already active (web `disabled={active}`) and shows its in-flight state for the
 * row whose start is pending (web per-button `startMut.isPending`).
 */
@Composable
private fun SubjectsList(
    subjects: List<ImpersonationCandidate>,
    active: Boolean,
    startingSubject: String?,
    onStart: (subject: String) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(TAG_LIST),
    ) {
        subjects.forEachIndexed { index, candidate ->
            if (index > 0) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            SubjectRow(
                candidate = candidate,
                active = active,
                starting = startingSubject == candidate.subject,
                onStart = onStart,
            )
        }
    }
}

/** One subject row — the monospace identifier beside the per-row impersonate action (web `<li>`). */
@Composable
private fun SubjectRow(
    candidate: ImpersonationCandidate,
    active: Boolean,
    starting: Boolean,
    onStart: (subject: String) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(rowTag(candidate.subject))
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        CodeText(candidate.subject, modifier = Modifier.weight(1f))
        UserImpersonateButton(
            subject = candidate.subject,
            starting = starting,
            onStart = onStart,
            disabled = active,
        )
    }
}
