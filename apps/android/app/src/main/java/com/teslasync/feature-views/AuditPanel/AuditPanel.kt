// The native Jetpack Compose + Material 3 AuditPanel feature view — a parity port of
// web/src/features/admin/components/dlq-inspector/AuditPanel.tsx. The web component is purely
// presentational: its parent (the DLQ inspector page) loads the replay-audit `DLQReplayAuditRecord[]`
// via the diagnostics feed and passes it down with a `loading` flag and an optional `scopedDlqId`. The
// component renders the shared `<DataTable>` (replayed_at / actor / dlq_id / result / dst_topic / error /
// trace_id) or a friendly `<EmptyState>` when there are no replay attempts.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its
// only web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10). The host supplies the rows
// through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the
// DLQ replay-audit feed), so this feature view also renders every lifecycle state that layer can carry —
// loading, hard error with retry, empty, content, and stale/offline (cached "last known") — without ever
// fetching. The empty + content branches reproduce the web component exactly. A web-parity overload that
// takes the raw `(rows, loading, scopedDlqId)` props is also provided for hosts that already hold the list.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AuditPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.auditpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The web `DataTable` `pagination={{ defaultPageSize: 25 }}` page size. */
private const val AUDIT_PAGE_SIZE = 25

// Column weights — the relative horizontal share each column gets in the responsive Material table.
// The web `visibleOnMobile` columns (replayed_at, actor, result) are weighted to stay legible first.
private const val WEIGHT_TIME = 1.4f
private const val WEIGHT_ACTOR = 1.1f
private const val WEIGHT_DLQ_ID = 0.6f
private const val WEIGHT_RESULT = 1.0f
private const val WEIGHT_TOPIC = 1.2f
private const val WEIGHT_ERROR = 1.4f
private const val WEIGHT_TRACE = 1.1f

/**
 * The already-localized strings the panel renders. The web component is anonymous — it resolves every
 * label through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary
 * and are passed down, keeping the panel free of any English literal.
 */
data class AuditPanelStrings(
    val replayedAt: String,
    val actor: String,
    val dlqId: String,
    val result: String,
    val dstTopic: String,
    val error: String,
    val traceId: String,
    val emptyTitle: String,
    val emptyScopedMessage: String,
    val emptyGlobalMessage: String,
    val loading: String,
)

/**
 * Stateful entry point for the DLQ replay-audit panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared diagnostics feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the replay-audit `DLQReplayAuditRecord[]`.
 * @param scopedDlqId the entry id when the panel is scoped to one DLQ row, else `null` (web `scopedDlqId`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AuditPanel(
    state: UiState<List<DLQReplayAuditRecord>>,
    scopedDlqId: Long?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAuditPanelOpened(logger) }
    AuditPanelContent(state = state, scopedDlqId = scopedDlqId, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ rows, loading, scopedDlqId })` props, for hosts
 * that already hold the loaded list. Projects them onto a [UiState] via
 * [AuditPanelProjection.projectUiState] (content / loading / empty), then renders. Records `view.opened`
 * like the stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun AuditPanel(
    rows: List<DLQReplayAuditRecord>,
    loading: Boolean,
    scopedDlqId: Long? = null,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(rows, loading) { AuditPanelProjection.projectUiState(rows, loading) }
    AuditPanel(state = state, scopedDlqId = scopedDlqId, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's empty/content branches (an [EmptyState] when there are no replay attempts, otherwise the
 * [DataTable]) and adds the lifecycle chrome the host's feed implies: a "Loading audit log…" table while a
 * first load is in flight, a hard-error retry surface, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [locale]/[zoneId] format each row's `replayed_at` absolutely (web `<TimeStamp format="absolute" />`).
 */
@Composable
fun AuditPanelContent(
    state: UiState<List<DLQReplayAuditRecord>>,
    scopedDlqId: Long?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: AuditPanelStrings = rememberAuditPanelStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatAge = rememberAuditFreshnessFormatter()
    val formatReplayedAt: (String) -> String =
        remember(zoneId, locale) { { iso -> AuditPanelTimeFormatting.format(iso, zoneId, locale) } }

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                AuditPanelTable(
                    rows = emptyList(),
                    strings = strings,
                    formatReplayedAt = formatReplayedAt,
                    emptyText = strings.loading,
                )

            state.isError -> AuditPanelError(onRetry = onRetry)

            state.isEmpty -> AuditPanelEmpty(strings = strings, scoped = AuditPanelProjection.isScoped(scopedDlqId))

            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
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
                AuditPanelTable(
                    rows = state.data ?: emptyList(),
                    strings = strings,
                    formatReplayedAt = formatReplayedAt,
                    emptyText = strings.emptyTitle,
                )
            }
        }
    }
}

/**
 * Builds the seven-column replay-audit table the web component defines. Headers arrive already-localized so
 * this helper carries no English literal. Mono cells (actor / dlq_id / dst_topic / trace_id) use [CodeText]
 * (web `font-mono`); the result chip uses [Badge] with [AuditPanelProjection.resultVariant]; blank values
 * fall back to the em dash via [AuditPanelProjection.valueOrDash] (web `value || '—'`).
 */
private fun auditColumns(
    strings: AuditPanelStrings,
    formatReplayedAt: (String) -> String,
): List<TableColumn<DLQReplayAuditRecord>> =
    listOf(
        TableColumn(key = "replayed_at", header = strings.replayedAt, weight = WEIGHT_TIME) {
            Caption(formatReplayedAt(it.replayedAt))
        },
        TableColumn(key = "actor", header = strings.actor, weight = WEIGHT_ACTOR) {
            CodeText(AuditPanelProjection.valueOrDash(it.actor))
        },
        TableColumn(key = "dlq_id", header = strings.dlqId, weight = WEIGHT_DLQ_ID) {
            CodeText(it.dlqId.toString())
        },
        TableColumn(key = "result", header = strings.result, weight = WEIGHT_RESULT) {
            Badge(text = it.result, variant = AuditPanelProjection.resultVariant(it.result))
        },
        TableColumn(key = "dst_topic", header = strings.dstTopic, weight = WEIGHT_TOPIC) {
            CodeText(AuditPanelProjection.valueOrDash(it.dstTopic))
        },
        TableColumn(key = "error", header = strings.error, weight = WEIGHT_ERROR) {
            HelperText(AuditPanelProjection.valueOrDash(it.error))
        },
        TableColumn(key = "trace_id", header = strings.traceId, weight = WEIGHT_TRACE) {
            CodeText(AuditPanelProjection.valueOrDash(it.traceId))
        },
    )

/**
 * The paginated audit table — the native [DataTable] with a client-side page window (web
 * `pagination.defaultPageSize = 25`). With no rows the table shows [emptyText] beneath its header chrome
 * (the loading message during a first load, or the "no attempts" title), reproducing the web
 * `emptyMessage`. The pagination footer appears only once the row count exceeds a page.
 */
@Composable
private fun AuditPanelTable(
    rows: List<DLQReplayAuditRecord>,
    strings: AuditPanelStrings,
    formatReplayedAt: (String) -> String,
    emptyText: String,
) {
    val columns = remember(strings, formatReplayedAt) { auditColumns(strings, formatReplayedAt) }
    val total = rows.size
    val pageCount = maxOf(1, (total + AUDIT_PAGE_SIZE - 1) / AUDIT_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * AUDIT_PAGE_SIZE
    val visible = if (total == 0) emptyList() else rows.subList(from, minOf(from + AUDIT_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = { it.id },
        modifier = Modifier.fillMaxWidth(),
        emptyText = emptyText,
        footer =
            if (total > AUDIT_PAGE_SIZE) {
                {
                    Pagination(
                        page = current,
                        pageSize = AUDIT_PAGE_SIZE,
                        total = total,
                        onPageChange = { page = it },
                        firstLabel = firstLabel,
                        previousLabel = previousLabel,
                        nextLabel = nextLabel,
                        lastLabel = lastLabel,
                        showingText = { start, end, count ->
                            context.getString(R.string.translation_pagination_showing, start, end, count)
                        },
                    )
                }
            } else {
                null
            },
    )
}

/**
 * Empty state — web parity: the "No replay attempts yet" title with the scoped or global message. A history
 * glyph keeps the panel from collapsing to a blank box; [EmptyState] exposes the title as its accessibility
 * label so the section is announced even when it holds no rows.
 */
@Composable
private fun AuditPanelEmpty(
    strings: AuditPanelStrings,
    scoped: Boolean,
) {
    EmptyState(
        message = if (scoped) strings.emptyScopedMessage else strings.emptyGlobalMessage,
        icon = DataDisplayGlyphs.History,
        title = strings.emptyTitle,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun AuditPanelError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [AuditPanelStrings] from the i18n catalog (P1/S10): the `admin.dlq.audit.*` keys the
 * web component reads through `useTranslation`. Resolved once at the Compose boundary so the rest of the
 * surface stays free of any English literal.
 */
@Composable
private fun rememberAuditPanelStrings(): AuditPanelStrings {
    val replayedAt = stringResource(R.string.translation_admin_dlq_audit_cols_replayedAt)
    val actor = stringResource(R.string.translation_admin_dlq_audit_cols_actor)
    val dlqId = stringResource(R.string.translation_admin_dlq_audit_cols_dlqId)
    val result = stringResource(R.string.translation_admin_dlq_audit_cols_result)
    val dstTopic = stringResource(R.string.translation_admin_dlq_audit_cols_dstTopic)
    val error = stringResource(R.string.translation_admin_dlq_audit_cols_error)
    val traceId = stringResource(R.string.translation_admin_dlq_audit_cols_traceId)
    val emptyTitle = stringResource(R.string.translation_admin_dlq_audit_empty_title)
    val emptyScoped = stringResource(R.string.translation_admin_dlq_audit_empty_scopedMessage)
    val emptyGlobal = stringResource(R.string.translation_admin_dlq_audit_empty_globalMessage)
    val loading = stringResource(R.string.translation_admin_dlq_audit_loading)
    return remember(replayedAt, actor, dlqId, result, dstTopic, error, traceId, emptyTitle, emptyScoped, emptyGlobal, loading) {
        AuditPanelStrings(
            replayedAt = replayedAt,
            actor = actor,
            dlqId = dlqId,
            result = result,
            dstTopic = dstTopic,
            error = error,
            traceId = traceId,
            emptyTitle = emptyTitle,
            emptyScopedMessage = emptyScoped,
            emptyGlobalMessage = emptyGlobal,
            loading = loading,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberAuditFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    AuditPanelStrings(
        replayedAt = "Replayed at",
        actor = "Actor",
        dlqId = "DLQ ID",
        result = "Result",
        dstTopic = "Destination",
        error = "Error",
        traceId = "Trace ID",
        emptyTitle = "No replay attempts yet",
        emptyScopedMessage = "This entry has not been replayed. Use the Replay action above to send it back to its source topic.",
        emptyGlobalMessage = "Replay attempts will appear here once an operator triggers one.",
        loading = "Loading audit log\u2026",
    )

private val PREVIEW_ROWS =
    listOf(
        DLQReplayAuditRecord(
            id = 1,
            replayedAt = "2026-06-11T12:00:00Z",
            actor = "ops@teslasync.io",
            dlqId = 4821,
            result = "ok",
            dstTopic = "telemetry/ingest",
            error = "",
            traceId = "b1dd7ea4",
        ),
        DLQReplayAuditRecord(
            id = 2,
            replayedAt = "2026-06-11T11:30:00Z",
            actor = "",
            dlqId = 4820,
            result = "publish_failed",
            dstTopic = "telemetry/ingest",
            error = "broker publish timeout after 5s",
            traceId = "66b5705c",
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun AuditPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AuditPanelContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_ROWS),
            scopedDlqId = null,
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun AuditPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AuditPanelContent(state = UiState.loading(), scopedDlqId = null, onRetry = {}, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Empty (global)", showBackground = true)
@Composable
private fun AuditPanelEmptyGlobalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AuditPanelContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            scopedDlqId = null,
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty (scoped)", showBackground = true)
@Composable
private fun AuditPanelEmptyScopedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AuditPanelContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            scopedDlqId = 4821,
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun AuditPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AuditPanelContent(
            state = UiState(phase = UiPhase.Error),
            scopedDlqId = null,
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
