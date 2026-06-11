// The native Jetpack Compose + Material 3 ChangesPanel feature view — a parity port of
// web/src/features/admin/components/feature-flags/ChangesPanel.tsx. The web component is purely
// presentational: its parent (the Feature-Flags page, `useFlagChanges`) loads the `FeatureFlagChange[]` and
// passes it down with a `loading` flag and an optional `scopedKey`, and it renders one of two branches — a
// friendly `<EmptyState>` when the load resolved with zero rows, otherwise a paginated `<DataTable>` whose
// `emptyMessage` reads "Loading audit log…" while the parent feed is still in flight.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). The host supplies the rows through
// the shared P1/S8 state-holder layer (`FeatureFlagsStore.flagChanges`) as a [UiState], so this feature view
// also renders every lifecycle state that layer can carry — loading, hard error with retry, empty,
// content, and stale/offline ("last known" + auto-refresh) — without ever fetching. The empty + table
// branches reproduce the web component exactly (scoped vs. global empty copy, the seven columns, the
// 25-row page size). A web-parity overload that takes the raw `rows`/`loading`/`scopedKey` props is also
// provided for hosts that already hold the loaded list.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChangesPanel) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.changespanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagChange
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/** The web `DataTable` `pagination={{ defaultPageSize: 25 }}` page size. */
private const val CHANGES_PAGE_SIZE: Int = 25

private const val CHANGED_AT_WEIGHT: Float = 1.6f
private const val FLAG_KEY_WEIGHT: Float = 1.3f
private const val OPERATION_WEIGHT: Float = 0.8f
private const val VALUE_WEIGHT: Float = 1.2f
private const val REASON_WEIGHT: Float = 1.3f

/**
 * Stateful entry point for the flag-change audit panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared flag-change feed can carry. The host
 * owns the feed (P1/S8 `FeatureFlagsStore.flagChanges`) and supplies [onRetry] (the feed's `refetch`); this
 * view never performs HTTP.
 *
 * @param state the cache-then-network projection of the audit feed (web `useFlagChanges`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param scopedKey when non-blank, the single flag whose history is shown (web `scopedKey`); tailors the
 *   empty-state copy.
 */
@Composable
fun ChangesPanel(
    state: UiState<List<FeatureFlagChange>>,
    onRetry: () -> Unit,
    scopedKey: String? = null,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordChangesPanelOpened(logger) }
    ChangesPanelContent(state = state, onRetry = onRetry, scopedKey = scopedKey, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `{ rows, loading, scopedKey }` props, for hosts that
 * already hold the loaded list. Maps the props onto a [UiState] with the web's branch precedence — a
 * non-empty list is content (shown even while refreshing), an empty list is loading while `loading` is set
 * and the empty state once it resolves (web `!loading && rows.length === 0`). Records `view.opened` like the
 * stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ChangesPanel(
    rows: List<FeatureFlagChange>,
    loading: Boolean,
    scopedKey: String? = null,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(rows, loading) {
            val phase =
                when {
                    rows.isNotEmpty() -> UiPhase.Content
                    loading -> UiPhase.Loading
                    else -> UiPhase.Empty
                }
            UiState(phase = phase, data = rows)
        }
    ChangesPanel(state = state, onRetry = {}, scopedKey = scopedKey, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * empty/table branches (a scoped-or-global [EmptyState] when the load resolved with no rows, otherwise the
 * paginated audit table) and adds the lifecycle chrome the host's feed implies: a hard-error retry surface
 * and a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale]/[zoneId] format each row's `changed_at`.
 */
@Composable
fun ChangesPanelContent(
    state: UiState<List<FeatureFlagChange>>,
    onRetry: () -> Unit,
    scopedKey: String? = null,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: ChangesPanelStrings = rememberChangesPanelStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    when {
        state.isError -> ChangesPanelError(onRetry = onRetry, modifier = modifier)
        state.isEmpty -> ChangesPanelEmpty(scopedKey = scopedKey, labels = strings.empty, modifier = modifier)
        else -> ChangesPanelData(state = state, strings = strings, locale = locale, zoneId = zoneId, modifier = modifier)
    }
}

/**
 * The loading + content branch — the web `<DataTable>` arm. Projects the feed's rows, shows a
 * refreshing/stale/offline freshness chip above the table when relevant, and renders the paginated audit
 * table. While a first load is in flight with no rows yet, the table's empty body reads "Loading audit log…"
 * (web `emptyMessage={loading ? … : …}`).
 */
@Composable
private fun ChangesPanelData(
    state: UiState<List<FeatureFlagChange>>,
    strings: ChangesPanelStrings,
    locale: Locale,
    zoneId: ZoneId,
    modifier: Modifier = Modifier,
) {
    val rows =
        remember(state.data, locale, zoneId) {
            ChangesPanelProjection.project(state.data ?: emptyList()) { iso ->
                ChangesPanelTimeFormatting.format(iso, zoneId, locale)
            }
        }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (state.stale || state.refreshing || state.hasError) {
            ChangesFreshnessRow(state)
        }
        ChangesTable(
            rows = rows,
            labels = strings.columns,
            emptyText = if (state.isLoading) strings.empty.loadingLabel else strings.empty.title,
        )
    }
}

/** The refreshing/stale/offline freshness chip — the honest "last known + auto-refresh" affordance. */
@Composable
private fun ChangesFreshnessRow(state: UiState<List<FeatureFlagChange>>) {
    val formatAge = rememberChangesFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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

/**
 * The paginated audit table — the web `<DataTable>` with its seven columns and 25-row pages. Pages locally
 * over the projected [rows]; the footer pager is shown only when there is at least one row (an empty load /
 * loading body has nothing to page). The native shared [Pagination] is a first/prev/next/last pager — the
 * web `pageSizeOptions` selector has no shared-component equivalent, so the default page size is fixed.
 */
@Composable
private fun ChangesTable(
    rows: List<FlagChangeRow>,
    labels: ChangesPanelColumnLabels,
    emptyText: String,
    modifier: Modifier = Modifier,
) {
    val total = rows.size
    val pageCount = maxOf(1, (total + CHANGES_PAGE_SIZE - 1) / CHANGES_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * CHANGES_PAGE_SIZE
    val visible = if (total == 0) emptyList() else rows.subList(from, minOf(from + CHANGES_PAGE_SIZE, total))

    val columns = remember(labels) { changeColumns(labels) }
    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    // Only the populated table pages; an empty/loading body has nothing to page.
    val footer: (@Composable () -> Unit)? =
        if (total == 0) {
            null
        } else {
            {
                Pagination(
                    page = current,
                    pageSize = CHANGES_PAGE_SIZE,
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
        }

    DataTable(
        modifier = modifier,
        columns = columns,
        rows = visible,
        keyOf = { it.id },
        emptyText = emptyText,
        footer = footer,
    )
}

/**
 * Builds the seven audit columns the web component declares — changed-at, actor, key, operation badge, old,
 * new, reason — in the same order. Headers arrive already-localized so this carries no English literal; the
 * operation cell maps the row's [OperationTone] to a [BadgeVariant] and uses the raw operation as the label
 * (web `{row.operation}`). Mono cells mirror the web `font-mono` value/key columns.
 */
private fun changeColumns(labels: ChangesPanelColumnLabels): List<TableColumn<FlagChangeRow>> =
    listOf(
        TableColumn(key = "changed_at", header = labels.changedAt, weight = CHANGED_AT_WEIGHT) { Caption(it.changedAt) },
        TableColumn(key = "actor", header = labels.actor) { CodeText(it.actor) },
        TableColumn(key = "flag_key", header = labels.flagKey, weight = FLAG_KEY_WEIGHT) { CodeText(it.flagKey) },
        TableColumn(key = "operation", header = labels.operation, weight = OPERATION_WEIGHT) {
            Badge(text = it.operation, variant = badgeVariantFor(it.tone))
        },
        TableColumn(key = "old_value", header = labels.oldValue, weight = VALUE_WEIGHT) { CodeText(it.oldValue) },
        TableColumn(key = "new_value", header = labels.newValue, weight = VALUE_WEIGHT) { CodeText(it.newValue) },
        TableColumn(key = "reason", header = labels.reason, weight = REASON_WEIGHT) { HelperText(it.reason) },
    )

/** Maps the projected operation [OperationTone] to its badge color — web `OP_VARIANT[op] ?? 'neutral'`. */
private fun badgeVariantFor(tone: OperationTone): BadgeVariant =
    when (tone) {
        OperationTone.Positive -> BadgeVariant.Success
        OperationTone.Negative -> BadgeVariant.Danger
        OperationTone.Neutral -> BadgeVariant.Neutral
    }

/**
 * The empty state — web parity: the "No flag changes yet" title plus the scoped ("No audit rows for
 * "{{key}}" …") or global ("Flag changes will appear here …") message, selected by whether [scopedKey] is
 * non-blank (web `scopedKey ? … : …`). Never an action — the trigger surface is the flags table above it.
 */
@Composable
private fun ChangesPanelEmpty(
    scopedKey: String?,
    labels: ChangesPanelEmptyLabels,
    modifier: Modifier = Modifier,
) {
    val message = if (scopedKey.isNullOrEmpty()) labels.globalMessage else labels.scopedMessage(scopedKey)
    EmptyState(message = message, title = labels.title, modifier = modifier.fillMaxWidth())
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent the feed layer implies. */
@Composable
private fun ChangesPanelError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [ChangesPanelStrings] from the i18n catalog (P1/S10): the `admin.flags.audit.*` keys
 * the web component reads. The scoped empty message resolves through `Context.getString` so its `%1$s` flag
 * key is filled by the catalog (web `{{key}}`).
 */
@Composable
private fun rememberChangesPanelStrings(): ChangesPanelStrings {
    val context = LocalContext.current
    val changedAt = stringResource(R.string.translation_admin_flags_audit_cols_changedAt)
    val actor = stringResource(R.string.translation_admin_flags_audit_cols_actor)
    val flagKey = stringResource(R.string.translation_admin_flags_audit_cols_flagKey)
    val operation = stringResource(R.string.translation_admin_flags_audit_cols_operation)
    val oldValue = stringResource(R.string.translation_admin_flags_audit_cols_oldValue)
    val newValue = stringResource(R.string.translation_admin_flags_audit_cols_newValue)
    val reason = stringResource(R.string.translation_admin_flags_audit_cols_reason)
    val title = stringResource(R.string.translation_admin_flags_audit_empty_title)
    val globalMessage = stringResource(R.string.translation_admin_flags_audit_empty_globalMessage)
    val loadingLabel = stringResource(R.string.translation_admin_flags_audit_loading)
    return remember(
        changedAt,
        actor,
        flagKey,
        operation,
        oldValue,
        newValue,
        reason,
        title,
        globalMessage,
        loadingLabel,
        context,
    ) {
        ChangesPanelStrings(
            columns =
                ChangesPanelColumnLabels(
                    changedAt = changedAt,
                    actor = actor,
                    flagKey = flagKey,
                    operation = operation,
                    oldValue = oldValue,
                    newValue = newValue,
                    reason = reason,
                ),
            empty =
                ChangesPanelEmptyLabels(
                    title = title,
                    globalMessage = globalMessage,
                    loadingLabel = loadingLabel,
                    scopedMessage = { key ->
                        context.getString(R.string.translation_admin_flags_audit_empty_scopedMessage, key)
                    },
                ),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChangesFreshnessFormatter(): (FreshnessAge) -> String {
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
    ChangesPanelStrings(
        columns =
            ChangesPanelColumnLabels(
                changedAt = "Changed at",
                actor = "Actor",
                flagKey = "Key",
                operation = "Op",
                oldValue = "Old",
                newValue = "New",
                reason = "Reason",
            ),
        empty =
            ChangesPanelEmptyLabels(
                title = "No flag changes yet",
                globalMessage = "Flag changes will appear here once an operator edits a value.",
                loadingLabel = "Loading audit log\u2026",
                scopedMessage = { key -> "No audit rows for \"$key\" \u2014 edit the value above to start the trail." },
            ),
    )

private val PREVIEW_ROWS =
    listOf(
        FeatureFlagChange(
            id = 1,
            changedAt = "2026-04-04T14:30:00Z",
            actor = "admin@teslasync.io",
            actorIp = "10.0.0.2",
            flagKey = "telemetry.fast_path",
            operation = "set",
            oldValue = JsonNull,
            newValue = JsonPrimitive(true),
            reason = "Enable fast path for fleet",
            traceId = "trace-1",
        ),
        FeatureFlagChange(
            id = 2,
            changedAt = "2026-04-03T09:15:00Z",
            actor = "",
            actorIp = "",
            flagKey = "beta.new_ui",
            operation = "delete",
            oldValue = JsonPrimitive("v2"),
            newValue = JsonNull,
            reason = "",
            traceId = "trace-2",
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun ChangesPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangesPanelContent(
            state = UiState(UiPhase.Content, data = PREVIEW_ROWS),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChangesPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangesPanelContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty global", showBackground = true)
@Composable
private fun ChangesPanelEmptyGlobalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangesPanelContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty scoped", showBackground = true)
@Composable
private fun ChangesPanelEmptyScopedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangesPanelContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            scopedKey = "telemetry.fast_path",
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ChangesPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangesPanelContent(
            state = UiState(UiPhase.Error),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
