// The native Jetpack Compose + Material 3 QueueJobDrawer modal/dialog — a parity port of
// web/src/features/admin/components/QueueJobDrawer.tsx. The web component is a slide-in panel that
// lists the most recent jobs for a single background worker: a titled drawer ("Recent {worker} jobs"
// or "Recent jobs") whose body switches between a loading line, a danger error notice, a friendly
// italic empty state, and a list of job rows. Each row reproduces every datum the web `QueueJobRow`
// renders — the `title || id` label, the colour-toned status word, the "Started {at} · Took {dur}"
// caption, and the optional error block.
//
// The native surface keeps that contract. It performs NO HTTP: it binds the [QueueJobDrawerViewModel]
// (P1/S8) and renders. Every lifecycle state the shared cache-then-network feed can carry is rendered —
// the loading line, the hard-error retry surface, the friendly empty state, and stale/offline "last
// known" with a freshness chip + auto-refresh (the ADR-013 freshness contract the web hook lacks) — so
// the surface is never a blank box. Every string resolves from the generated i18n catalog (P1/S10)
// `translation_queueStatus_*` keys; spacing/colour come from the generated theme tokens (P1/S9).
//
// Tier adaptation (declared, not silent): the web component mounts the shared `<Drawer>` (a focus-
// trapped, Esc-dismissable slide-in). The P3 tier classifies this artifact as a modal/dialog surface
// ("overlay surface with focus trap + dismiss semantics"), so the native surface hosts the same titled
// body in the shared [Modal] shell (platform scrim, outside-tap + system-back dismiss, pane-title for
// TalkBack) and gates it on an `open` flag — the Compose idiom for the web `open` prop the sibling
// SessionExpiringModal / GeofenceDrawer surfaces use. The web Drawer chrome's title + close affordance
// is reproduced inside the self-contained [QueueJobDrawerContent] so it stays trivially UI-testable.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/modals-dialogs/QueueJobDrawer) cannot form a valid Kotlin package and the
// file hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.modalsdialogs.queuejobdrawer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.systemqueues.QueueJobView
import io.teslasync.shared.core.presentation.systemqueues.QueueJobsResponse
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val ROW_BG_ALPHA = 0.4f
private const val ERROR_BG_ALPHA = 0.06f
private const val ERROR_BORDER_ALPHA = 0.3f
private const val ROW_WEIGHT = 1f

/** Absolute "Started {at}" formatter — the parity of the web `formatDateTime` (`MMM d, y, h:mm a`). */
private val STARTED_AT_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/** Stable body test/semantics tag — the native analogue of the web `data-testid="queue-job-drawer-body"`. */
const val QUEUE_JOB_DRAWER_BODY_TAG: String = "queue-job-drawer-body"

/** Per-row test/semantics tag — the native analogue of the web `data-testid="queue-job-row-${id}"`. */
internal fun queueJobRowTestTag(id: String): String = "queue-job-row-$id"

/**
 * The already-localized fixed drawer microcopy the composable reads from the generated i18n catalog
 * (P1/S10). Bundled into one carrier so the stateless [QueueJobDrawerContent] takes plain strings and
 * stays trivially previewable + UI-testable. The argument-bearing title (`Recent {worker} jobs`) is
 * resolved in the stateful entry and handed in as the `title` parameter; the per-row status word and
 * the "Started {at} · Took {dur}" caption are resolved at their row call sites.
 */
data class QueueJobDrawerStrings(
    val title: String,
    val close: String,
    val loading: String,
    val error: String,
    val empty: String,
    val retry: String,
)

/** Resolves every fixed [QueueJobDrawerStrings] entry from the generated catalog keys (P1/S10). */
@Composable
fun rememberQueueJobDrawerStrings(): QueueJobDrawerStrings {
    val title = stringResource(R.string.translation_queueStatus_drawer_title)
    val close = stringResource(R.string.translation_common_close)
    val loading = stringResource(R.string.translation_queueStatus_drawer_loading)
    val error = stringResource(R.string.translation_queueStatus_drawer_error)
    val empty = stringResource(R.string.translation_queueStatus_drawer_empty)
    val retry = stringResource(R.string.translation_common_retry)
    return remember(title, close, loading, error, empty, retry) {
        QueueJobDrawerStrings(
            title = title,
            close = close,
            loading = loading,
            error = error,
            empty = empty,
            retry = retry,
        )
    }
}

/**
 * Stateful entry point — the faithful port of the web `QueueJobDrawer`. Renders the drawer only while
 * [open] (web `open`; when closed it emits nothing and never fetches, like the web `enabled: false`
 * gate). On open it records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and sets the
 * [QueueJobDrawerViewModel]'s fetch target to ([worker], enabled) so the per-worker jobs feed loads.
 * The shared [Modal] maps Esc / back / scrim dismissal to [onClose]. The view performs no HTTP.
 *
 * @param open whether the drawer is shown (web `open`).
 * @param worker the worker whose recent jobs to fetch (web `worker`); `null`/blank keeps the feed disabled.
 * @param onClose dismiss callback for the overlay (web `onClose`).
 * @param viewModel the surface state holder (P1/S8); the host builds it via [QueueJobDrawerViewModel.create].
 * @param displayName human-readable worker label for the title (web `displayName`); falls back to "Recent jobs".
 * @param modifier applied to the modal surface.
 */
@Composable
fun QueueJobDrawer(
    open: Boolean,
    worker: String?,
    onClose: () -> Unit,
    viewModel: QueueJobDrawerViewModel,
    modifier: Modifier = Modifier,
    displayName: String? = null,
) {
    if (!open) return
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    LaunchedEffect(worker) { viewModel.setTarget(worker.orEmpty(), worker != null) }

    val state by viewModel.jobs.collectAsStateWithLifecycle()
    val strings = rememberQueueJobDrawerStrings()
    val context = LocalContext.current
    val title =
        if (QueueJobDrawerProjection.titleHasWorker(displayName)) {
            context.getString(R.string.translation_queueStatus_drawer_titleWithWorker, displayName)
        } else {
            strings.title
        }

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        accessibleName = title,
        dismissOnBackdrop = true,
    ) {
        QueueJobDrawerContent(
            title = title,
            state = state,
            onRetry = viewModel::retry,
            onClose = onClose,
            strings = strings,
        )
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the drawer chrome (title +
 * close affordance) above the body, which switches between every lifecycle state the shared
 * cache-then-network feed can carry: the loading line, a danger error notice with retry, the friendly
 * italic empty state, and the job-row list. Stale/offline (cached) content adds a freshness chip and
 * auto-refreshes, mirroring the ADR-013 freshness contract.
 */
@Composable
fun QueueJobDrawerContent(
    title: String,
    state: UiState<QueueJobsResponse>,
    onRetry: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    strings: QueueJobDrawerStrings = rememberQueueJobDrawerStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        DrawerHeader(title = title, closeLabel = strings.close, onClose = onClose)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Column(
            modifier = Modifier.fillMaxWidth().testTag(QUEUE_JOB_DRAWER_BODY_TAG),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            when {
                state.isLoading -> LoadingBranch(strings)
                state.isError -> ErrorBranch(strings = strings, onRetry = onRetry)
                state.isEmpty -> EmptyBranch(strings)
                else -> ContentBranch(state = state)
            }
        }
    }
}

@Composable
private fun DrawerHeader(
    title: String,
    closeLabel: String,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SectionTitle(title, modifier = Modifier.weight(ROW_WEIGHT))
        IconButton(TeslaGlyphs.Close, contentDescription = closeLabel, onClick = onClose, size = IconSize.Md)
    }
}

@Composable
private fun LoadingBranch(strings: QueueJobDrawerStrings) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.md).testTag("queue-job-drawer-loading"),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spinner(size = SpinnerSize.Sm, accessibleLabel = strings.loading)
        BodyText(strings.loading, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ErrorBranch(
    strings: QueueJobDrawerStrings,
    onRetry: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("queue-job-drawer-error"),
        shape = RoundedCornerShape(Radius.md),
        color = TeslaTokens.status.danger.copy(alpha = ERROR_BG_ALPHA),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.danger)
            Column(modifier = Modifier.weight(ROW_WEIGHT), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                BodyText(strings.error, color = TeslaTokens.status.danger)
                Button(label = strings.retry, onClick = onRetry, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
    }
}

@Composable
private fun EmptyBranch(strings: QueueJobDrawerStrings) {
    Text(
        text = strings.empty,
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm).testTag("queue-job-drawer-empty"),
        style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ContentBranch(state: UiState<QueueJobsResponse>) {
    val rows = remember(state.data) { QueueJobDrawerProjection.projectRows(state.data?.jobs ?: emptyList()) }
    if (state.stale || state.refreshing || state.hasError) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
            horizontalArrangement = Arrangement.End,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberQueueJobFreshnessFormatter(),
            )
        }
    }
    Column(
        modifier = Modifier.fillMaxWidth().testTag("queue-job-drawer-list"),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        rows.forEach { row -> QueueJobRow(row = row) }
    }
}

/**
 * One recent-job row — the native mirror of the web `QueueJobRow`. The `title || id` label sits beside
 * the colour-toned status word; below them the "Started {at} · Took {dur}" caption; and, when the job
 * failed, the error block (an alert-triangle + the message on a danger-tinted card). The whole row
 * carries one merged accessible description so TalkBack announces it as a unit.
 */
@Composable
private fun QueueJobRow(row: QueueJobRowModel) {
    val statusLabel = jobStatusLabel(row.statusWire)
    val metaLine = jobMetaLine(row)
    val description =
        listOf(row.title, statusLabel, metaLine, row.error.orEmpty())
            .filter { it.isNotBlank() }
            .joinToString(", ")
    Surface(
        modifier = Modifier.fillMaxWidth().testTag(queueJobRowTestTag(row.id)),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ROW_BG_ALPHA),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(Spacing.md)
                    .semantics(mergeDescendants = true) { contentDescription = description },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
                Text(
                    text = row.title,
                    modifier = Modifier.weight(ROW_WEIGHT),
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = statusLabel,
                    modifier = Modifier.testTag("queue-job-status-${row.id}"),
                    style = MaterialTheme.typography.labelMedium,
                    color = toneColor(row.tone),
                )
            }
            Caption(metaLine)
            if (row.error != null) {
                QueueJobErrorBlock(id = row.id, error = row.error)
            }
        }
    }
}

@Composable
private fun QueueJobErrorBlock(
    id: String,
    error: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("queue-job-error-$id"),
        shape = RoundedCornerShape(Radius.sm),
        color = TeslaTokens.status.danger.copy(alpha = ERROR_BG_ALPHA),
        border = BorderStroke(1.dp, TeslaTokens.status.danger.copy(alpha = ERROR_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.danger)
            Text(
                text = error,
                style = MaterialTheme.typography.labelMedium,
                color = TeslaTokens.status.danger,
            )
        }
    }
}

/**
 * The "Started {at} · Took {dur}" caption — the web `QueueJobRow` meta line. The absolute start time is
 * formatted at the render boundary (device locale + zone) via [STARTED_AT_FORMATTER]; the duration
 * clause is appended only when the pure [QueueJobRowModel.durationLabel] is non-null (web
 * `durationLabel ? … : ''`).
 */
@Composable
private fun jobMetaLine(row: QueueJobRowModel): String {
    val context = LocalContext.current
    val startedAt = row.startedAtMillis?.let { STARTED_AT_FORMATTER.format(Instant.ofEpochMilli(it)) } ?: QUEUE_JOB_EM_DASH
    val started = context.getString(R.string.translation_queueStatus_jobStarted, startedAt)
    val duration = row.durationLabel ?: return started
    return started + QUEUE_JOB_META_SEPARATOR + context.getString(R.string.translation_queueStatus_jobDuration, duration)
}

/**
 * Status wire value → localized label — the web `t('queueStatus.jobStatus.${status}', status)` with the
 * raw status as the fallback for an unrecognised value.
 */
@Composable
private fun jobStatusLabel(statusWire: String): String =
    when (statusWire) {
        "sent" -> stringResource(R.string.translation_queueStatus_jobStatus_sent)
        "pending" -> stringResource(R.string.translation_queueStatus_jobStatus_pending)
        "deferred_dnd" -> stringResource(R.string.translation_queueStatus_jobStatus_deferred_dnd)
        "failed" -> stringResource(R.string.translation_queueStatus_jobStatus_failed)
        "ready" -> stringResource(R.string.translation_queueStatus_jobStatus_ready)
        "queued" -> stringResource(R.string.translation_queueStatus_jobStatus_queued)
        "processing" -> stringResource(R.string.translation_queueStatus_jobStatus_processing)
        "success" -> stringResource(R.string.translation_queueStatus_jobStatus_success)
        "partial" -> stringResource(R.string.translation_queueStatus_jobStatus_partial)
        "running" -> stringResource(R.string.translation_queueStatus_jobStatus_running)
        "cancelled" -> stringResource(R.string.translation_queueStatus_jobStatus_cancelled)
        "skipped" -> stringResource(R.string.translation_queueStatus_jobStatus_skipped)
        else -> statusWire
    }

/** Tone → colour — the native mirror of the web `STATUS_TONE` toned-down body-text palette. */
@Composable
private fun toneColor(tone: QueueJobTone): Color =
    when (tone) {
        QueueJobTone.Success -> TeslaTokens.status.success
        QueueJobTone.Warning -> TeslaTokens.status.warning
        QueueJobTone.Info -> TeslaTokens.status.info
        QueueJobTone.Danger -> TeslaTokens.status.danger
        QueueJobTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
        QueueJobTone.Neutral -> MaterialTheme.colorScheme.onSurface
    }

/**
 * Localized relative-age formatter for the stale/offline freshness chip (`translation_freshness_*`) —
 * the same render-only concern the sibling surfaces resolve, kept out of the pure projection so the
 * catalog stays the single source of microcopy (P1/S10).
 */
@Composable
private fun rememberQueueJobFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> QUEUE_JOB_EM_DASH
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    QueueJobDrawerStrings(
        title = "Recent jobs",
        close = "Close",
        loading = "Loading recent jobs\u2026",
        error = "Could not load recent jobs. Check API logs and try again.",
        empty = "No recent jobs to show. New jobs will appear here as the worker processes them.",
        retry = "Retry",
    )

private val PREVIEW_JOBS =
    listOf(
        QueueJobView(
            id = "job-1",
            worker = "notification",
            status = "sent",
            title = "Charge complete push",
            startedAt = "2026-06-11T12:00:00Z",
            finishedAt = "2026-06-11T12:00:01Z",
            durationMs = 1240L,
            error = "",
        ),
        QueueJobView(
            id = "job-2",
            worker = "notification",
            status = "processing",
            title = "Geofence arrival alert",
            startedAt = "2026-06-11T11:59:30Z",
            finishedAt = null,
            durationMs = null,
            error = "",
        ),
        QueueJobView(
            id = "job-3",
            worker = "notification",
            status = "failed",
            title = "Weekly summary email",
            startedAt = "2026-06-11T11:58:00Z",
            finishedAt = "2026-06-11T11:58:02Z",
            durationMs = 2010L,
            error = "SMTP timeout after 30s",
        ),
    )

private fun previewState(
    phase: UiPhase,
    jobs: List<QueueJobView>,
): UiState<QueueJobsResponse> = UiState(phase = phase, data = QueueJobsResponse(worker = "notification", jobs = jobs))

@Preview(name = "Content", showBackground = true, widthDp = 360)
@Composable
private fun QueueJobDrawerContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueJobDrawerContent(
            title = "Recent Notification worker jobs",
            state = previewState(UiPhase.Content, PREVIEW_JOBS),
            onRetry = {},
            onClose = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun QueueJobDrawerLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueJobDrawerContent(
            title = "Recent jobs",
            state = UiState.loading(),
            onRetry = {},
            onClose = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 360)
@Composable
private fun QueueJobDrawerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueJobDrawerContent(
            title = "Recent jobs",
            state = UiState(phase = UiPhase.Error),
            onRetry = {},
            onClose = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 360)
@Composable
private fun QueueJobDrawerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueJobDrawerContent(
            title = "Recent jobs",
            state = previewState(UiPhase.Empty, emptyList()),
            onRetry = {},
            onClose = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
