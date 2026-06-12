// The native Jetpack Compose + Material 3 BackupActionsCard surface — a parity port of
// web/src/features/system/components/status/BackupActionsCard.tsx. It reproduces the web composition: the
// backup-status DefList rows (the `children` the web parent passes — configured schedules, total runs, last
// successful + its size, recent failures) above a divided action row with a primary "Run quick backup now"
// button (disabled + spinning while the mutation is in flight) and a "Manage backups & restore" affordance
// (web `<Link to="/backup">`). Running a backup raises a success toast and refreshes the feed; a 401/403 raises
// a permission toast and any other failure a generic one — the web `onError` branch.
//
// Because the web component's `children` are themselves a data feed (unlike the static ResetSection), this
// surface folds that feed in as a cache-then-network [UiState] (the sibling UserImpersonateButton pattern) and
// therefore renders every state honestly: loading skeletons, content, a friendly empty affordance, a hard-error
// retry surface, and stale/offline cached views with a freshness chip + auto-refresh. All state + the mutation
// flow through the shared [BackupActionsCardViewModel] (P1/S8); the view performs no HTTP (ADR-002). Every
// string resolves through the i18n catalog (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackupActionsCard) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backupactionscard

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.feedback.formatBytes
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val EM_DASH = "\u2014"
private const val FADE_DELAY_MS = 200
private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val SKELETON_ROWS = 5
private val SKELETON_ROW_HEIGHT = 16.dp
private val MIN_TOUCH_TARGET = 44.dp

/** The localized absolute "last successful" timestamp formatter (render-only; API 26+ `java.time`). */
private val LAST_SUCCESS_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/**
 * Stateful entry point. Binds the supplied [source] (P1/S8) into a [BackupActionsCardViewModel], records the
 * one-shot `view.opened` diagnostic, collects the backup-status feed + the run-in-flight flag + the toast
 * stream, and renders the surface. The host owns the shared `AdminStore` and passes
 * `store.asBackupActionsCardSource(triggerQuickBackup)`; this view never performs HTTP.
 *
 * @param source the backup feed + quick-backup mutation seam (web `triggerQuickBackup` + the parent feed).
 * @param onManageBackups navigates to the backup management screen (web `<Link to="/backup">`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BackupActionsCard(
    source: BackupActionsCardSource,
    modifier: Modifier = Modifier,
    onManageBackups: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: BackupActionsCardViewModel =
        viewModel(factory = BackupActionsCardViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    val status by viewModel.status.collectAsStateWithLifecycle()
    val running by viewModel.running.collectAsStateWithLifecycle()

    val context = LocalContext.current
    var toasts by remember { mutableStateOf(emptyList<ToastItem>()) }
    var toastSeq by remember { mutableLongStateOf(0L) }

    LaunchedEffect(viewModel, context) {
        viewModel.events.collect { event ->
            if (event is UiEvent.Message) {
                toastSeq += 1
                val item = ToastItem(id = toastSeq, message = resolveToastMessage(context, event), tone = toneOf(event.severity))
                toasts = enqueueToast(toasts, item, MAX_TOASTS)
            }
        }
    }
    LaunchedEffect(toasts) {
        if (toasts.isNotEmpty()) {
            delay(TOAST_DURATION_MS)
            toasts = toasts.drop(1)
        }
    }

    BackupActionsCardContent(
        status = status,
        running = running,
        onRunBackup = viewModel::runQuickBackup,
        onManageBackups = onManageBackups,
        onRetry = viewModel::retry,
        toasts = toasts,
        onToastDismiss = { id -> toasts = dismissToast(toasts, id) },
        modifier = modifier,
    )
}

/**
 * Stateless surface — the unit/UI-test + preview entry point. Renders the faded-in glass card: a header, the
 * per-state backup-status body (skeletons / DefList rows / empty / error / stale+offline with a freshness
 * chip), and the always-present action row, plus the bottom-anchored toast host. Hoisted out of the ViewModel
 * so each state is preview- and screenshot-testable with hand-built inputs.
 */
@Composable
fun BackupActionsCardContent(
    status: UiState<BackupStatus>,
    running: Boolean,
    onRunBackup: () -> Unit,
    onManageBackups: () -> Unit,
    onRetry: () -> Unit,
    toasts: List<ToastItem>,
    onToastDismiss: (Long) -> Unit,
    modifier: Modifier = Modifier,
    strings: BackupActionsCardStrings = rememberBackupActionsCardStrings(),
) {
    LaunchedEffect(status.stale, status.refreshing, status.hasError) {
        if (status.stale && !status.refreshing && !status.hasError) onRetry()
    }
    val surface = BackupActionsCardProjection.selectSurface(status)
    val formatAge = rememberFreshnessFormatter()

    Box(modifier = modifier.fillMaxWidth()) {
        FadeIn(delayMs = FADE_DELAY_MS) {
            GlassPanel(modifier = Modifier.fillMaxWidth()) {
                CardHeader(
                    strings = strings,
                    state = status,
                    showFreshness = surface == BackupActionsSurface.Stale || surface == BackupActionsSurface.Offline,
                    formatAge = formatAge,
                )
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    StatusBody(surface = surface, status = status, strings = strings, onRetry = onRetry)
                    if (surface != BackupActionsSurface.Error) {
                        ActionRow(running = running, strings = strings, onRunBackup = onRunBackup, onManageBackups = onManageBackups)
                    }
                }
            }
        }
        ToastHost(toasts = toasts, onDismiss = onToastDismiss, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

/** The card header: a tinted Database IconBox beside the title + subtitle, with an optional freshness chip. */
@Composable
private fun CardHeader(
    strings: BackupActionsCardStrings,
    state: UiState<BackupStatus>,
    showFreshness: Boolean,
    formatAge: (FreshnessAge) -> String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info, size = IconBoxSize.Md) {
            Icon(BackupActionsCardGlyphs.Database, contentDescription = null, size = IconSize.Lg)
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Heading(strings.title, level = HeadingLevel.Section, modifier = Modifier.semantics { heading() })
            HelperText(strings.subtitle)
        }
        if (showFreshness) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = strings.loading,
                errorLabel = strings.offline,
                formatAge = formatAge,
            )
        }
    }
}

/** The per-state backup-status body — never a blank box. */
@Composable
private fun StatusBody(
    surface: BackupActionsSurface,
    status: UiState<BackupStatus>,
    strings: BackupActionsCardStrings,
    onRetry: () -> Unit,
) {
    when (surface) {
        BackupActionsSurface.Loading -> LoadingRows()
        BackupActionsSurface.Empty -> BackupEmpty(strings = strings)
        BackupActionsSurface.Error ->
            ErrorDisplay(
                message = strings.errorMessage,
                title = strings.errorTitle,
                onRetry = onRetry,
                retryLabel = strings.retry,
                modifier = Modifier.fillMaxWidth(),
            )

        BackupActionsSurface.Content,
        BackupActionsSurface.Stale,
        BackupActionsSurface.Offline,
        -> StatusRows(status = status.data, strings = strings)
    }
}

/** The DefList rows (web `children`) — configured schedules, total runs, last successful + size, failures. */
@Composable
private fun StatusRows(
    status: BackupStatus?,
    strings: BackupActionsCardStrings,
) {
    val rows =
        buildList {
            add(KVItem(strings.rowConfiguredSchedules, (status?.configuredSchedules ?: 0).toString()))
            add(KVItem(strings.rowTotalRuns, (status?.totalRuns ?: 0).toString()))
            add(KVItem(strings.rowLastSuccessful, formatLastSuccessful(status?.lastSuccessfulAtMillis, strings.emDash)))
            add(KVItem(strings.rowLastSuccessfulSize, formatBytes(status?.lastSuccessfulSizeBytes) ?: strings.emDash))
            add(KVItem(strings.rowFailures, (status?.recentFailures ?: 0).toString()))
        }
    KVList(items = rows, modifier = Modifier.fillMaxWidth())
}

/** Loading chrome: shimmering skeleton rows so the surface is never blank while the first load is in flight. */
@Composable
private fun LoadingRows() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(widthFraction = 1f, height = SKELETON_ROW_HEIGHT)
        }
    }
}

/** Empty affordance — nothing configured and nothing run yet; the run button below is the primary CTA. */
@Composable
private fun BackupEmpty(strings: BackupActionsCardStrings) {
    EmptyState(
        message = strings.emptyMessage,
        title = strings.emptyTitle,
        icon = BackupActionsCardGlyphs.Database,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The always-present action row (web's bottom bar): a primary run button + a ghost manage-backups affordance. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActionRow(
    running: Boolean,
    strings: BackupActionsCardStrings,
    onRunBackup: () -> Unit,
    onManageBackups: () -> Unit,
) {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    val runLabel = if (running) strings.running else strings.runBackup
    FlowRow(
        modifier = Modifier.fillMaxWidth().heightIn(min = MIN_TOUCH_TARGET).padding(top = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Button(
            label = runLabel,
            onClick = onRunBackup,
            modifier =
                Modifier
                    .testTag(BackupActionsCardProjection.RUN_BACKUP_TEST_TAG)
                    .semantics { contentDescription = runLabel },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = !running,
            loading = running,
            leadingIcon = BackupActionsCardGlyphs.Play,
        )
        Button(
            label = strings.manageBackups,
            onClick = onManageBackups,
            modifier =
                Modifier
                    .testTag(BackupActionsCardProjection.MANAGE_BACKUPS_TEST_TAG)
                    .semantics { contentDescription = strings.manageBackups },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = BackupActionsCardGlyphs.ExternalLink,
        )
    }
}

/** Formats the last-successful timestamp at the render boundary, or the em-dash when there is none. */
private fun formatLastSuccessful(
    millis: Long?,
    emDash: String,
): String = millis?.let { LAST_SUCCESS_FORMATTER.format(Instant.ofEpochMilli(it)) } ?: emDash

/**
 * Builds the localized [BackupActionsCardStrings] from the i18n catalog (P1/S10). The web component hard-codes
 * its English copy, so the closest existing catalog keys are reused (e.g. `backup.quickBackup`, `backup.title`,
 * `backup.totalConfigs`/`totalBackups`/`lastBackup`/`size`/`recentErrors`); no string is authored in native
 * code. `strings.xml` is outside this surface's allowed files, so no new key is added.
 */
@Composable
private fun rememberBackupActionsCardStrings(): BackupActionsCardStrings {
    val title = stringResource(R.string.translation_backup_title)
    val subtitle = stringResource(R.string.translation_backup_subtitle)
    val runBackup = stringResource(R.string.translation_backup_quickBackup)
    val running = stringResource(R.string.translation_common_loading)
    val manageBackups = stringResource(R.string.translation_backup_history)
    val rowConfiguredSchedules = stringResource(R.string.translation_backup_totalConfigs)
    val rowTotalRuns = stringResource(R.string.translation_backup_totalBackups)
    val rowLastSuccessful = stringResource(R.string.translation_backup_lastBackup)
    val rowLastSuccessfulSize = stringResource(R.string.translation_backup_size)
    val rowFailures = stringResource(R.string.translation_backup_recentErrors)
    val emptyTitle = stringResource(R.string.translation_backup_noRuns)
    val emptyMessage = stringResource(R.string.translation_backup_noRunsMessage)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retry = stringResource(R.string.translation_common_retry)
    val loading = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    return remember(title, subtitle, runBackup, manageBackups, rowLastSuccessful, emptyMessage, errorMessage) {
        BackupActionsCardStrings(
            title = title,
            subtitle = subtitle,
            runBackup = runBackup,
            running = running,
            manageBackups = manageBackups,
            rowConfiguredSchedules = rowConfiguredSchedules,
            rowTotalRuns = rowTotalRuns,
            rowLastSuccessful = rowLastSuccessful,
            rowLastSuccessfulSize = rowLastSuccessfulSize,
            rowFailures = rowFailures,
            emptyTitle = emptyTitle,
            emptyMessage = emptyMessage,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
            loading = loading,
            offline = offline,
            emDash = EM_DASH,
        )
    }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — a render-only concern. */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Resolves a [UiEvent.Message] toast to its localized text (ADR-014 — the render boundary owns the lookup). */
private fun resolveToastMessage(
    context: Context,
    event: UiEvent.Message,
): String =
    when (event.messageKey) {
        BACKUP_STARTED_KEY -> context.getString(R.string.translation_backup_quickStarted)
        BACKUP_FAILED_KEY -> context.getString(R.string.translation_backup_quickFailed)
        BACKUP_PERMISSION_KEY -> context.getString(R.string.translation_error_unauthorized_message)
        else -> context.getString(R.string.translation_error_serverError_message)
    }

/** Maps a [UiEvent.Severity] onto the feedback-layer [Tone] the toast renders with. */
private fun toneOf(severity: UiEvent.Severity): Tone =
    when (severity) {
        UiEvent.Severity.Success -> Tone.Success
        UiEvent.Severity.Warning -> Tone.Warning
        UiEvent.Severity.Error -> Tone.Danger
        UiEvent.Severity.Info -> Tone.Info
    }

// ── Previews — one per rendered state (content / empty / loading / error / offline) ──────────────────────

private fun previewStatus(
    phase: UiPhase,
    data: BackupStatus? = InMemoryBackupActionsCardSource.SAMPLE_STATUS,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<BackupStatus> =
    UiState(phase = phase, data = data, fetchedAt = if (data != null) 1L else null, stale = stale, errorKind = errorKind)

@Composable
private fun PreviewSurface(status: UiState<BackupStatus>) {
    TeslaSyncTheme(dynamicColor = false) {
        BackupActionsCardContent(
            status = status,
            running = false,
            onRunBackup = {},
            onManageBackups = {},
            onRetry = {},
            toasts = emptyList(),
            onToastDismiss = {},
        )
    }
}

@Preview(name = "BackupActionsCard · content", showBackground = true)
@Composable
private fun BackupActionsCardContentPreview() {
    PreviewSurface(previewStatus(UiPhase.Content))
}

@Preview(name = "BackupActionsCard · empty", showBackground = true)
@Composable
private fun BackupActionsCardEmptyPreview() {
    PreviewSurface(previewStatus(UiPhase.Empty, data = BackupStatus(0, 0, null, null, 0)))
}

@Preview(name = "BackupActionsCard · loading", showBackground = true)
@Composable
private fun BackupActionsCardLoadingPreview() {
    PreviewSurface(previewStatus(UiPhase.Loading, data = null))
}

@Preview(name = "BackupActionsCard · error", showBackground = true)
@Composable
private fun BackupActionsCardErrorPreview() {
    PreviewSurface(previewStatus(UiPhase.Error, data = null, errorKind = ErrorKind.Network))
}

@Preview(name = "BackupActionsCard · offline", showBackground = true)
@Composable
private fun BackupActionsCardOfflinePreview() {
    PreviewSurface(previewStatus(UiPhase.Content, stale = true, errorKind = ErrorKind.Network))
}
