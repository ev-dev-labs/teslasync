// The native Jetpack Compose + Material 3 FlagsTable feature view — a parity port of
// web/src/features/admin/components/feature-flags/FlagsTable.tsx. The web component is purely
// presentational: it renders the feature-flag registry as a sortable-by-key data table with a compact
// JSON value preview and a per-row Edit + Delete action pair, falling back to a single body message
// ("Loading flags…" while loading, "No feature flags are set on this server." otherwise). It performs
// no fetching — `rows` + `loading` + the two callbacks arrive from the parent page — so this port
// reproduces exactly those three body states (loading / empty / data) the web source expresses; the
// error / stale / offline surfaces are the owning page's responsibility, not this component's.
//
// Every display string resolves through the P1/S10 i18n facade (the `translation_admin_flags_*`
// catalog entries that mirror the web `t('admin.flags.*')` keys), the one-shot `view.opened`
// diagnostic is emitted on first composition (P1/S11), and the ordering / value-preview / body-message
// logic lives in the pure [FlagsTableModel] so the composable stays a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FlagsTable) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.flagstable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Web `pagination={{ defaultPageSize: 25 }}`. */
private const val FLAGS_PAGE_SIZE = 25

// Relative column widths: the value preview gets the most room, the action pair enough for two
// labelled small buttons, and the (ellipsised) key column the remainder.
private const val KEY_WEIGHT = 2f
private const val VALUE_WEIGHT = 3f
private const val ACTIONS_WEIGHT = 3f

/**
 * Stateful entry point — the faithful 1:1 port of the web `FlagsTable({ rows, loading, onEdit,
 * onAskDelete })` props. Records the one-shot `view.opened` diagnostic on first composition (P1/S11),
 * owns the sort state (web `useSortToggle('key', 'asc')`), resolves the localized labels, and renders
 * the stateless [FlagsTableContent].
 */
@Composable
fun FlagsTable(
    rows: List<FeatureFlagEntry>,
    loading: Boolean,
    onEdit: (FeatureFlagEntry) -> Unit,
    onAskDelete: (FeatureFlagEntry) -> Unit,
    modifier: Modifier = Modifier,
) {
    val logger = LocalDataContainer.current.logger
    LaunchedEffect(Unit) { recordFlagsTableOpened(logger) }
    var sortState by remember { mutableStateOf(SortState(SORT_KEY_KEY, SortDirection.Asc)) }
    FlagsTableContent(
        rows = rows,
        loading = loading,
        labels = rememberFlagsTableLabels(),
        sortState = sortState,
        onSortChange = { sortState = sortState.toggledBy(it) },
        onEdit = onEdit,
        onAskDelete = onAskDelete,
        modifier = modifier,
    )
}

/** Resolves the seven `translation_admin_flags_*` catalog entries the table renders (P1/S10). */
@Composable
fun rememberFlagsTableLabels(): FlagsTableLabels =
    FlagsTableLabels(
        keyHeader = stringResource(R.string.translation_admin_flags_cols_key),
        valueHeader = stringResource(R.string.translation_admin_flags_cols_value),
        actionsHeader = stringResource(R.string.translation_admin_flags_cols_actions),
        editLabel = stringResource(R.string.translation_admin_flags_actions_edit),
        deleteLabel = stringResource(R.string.translation_admin_flags_actions_delete),
        loadingMessage = stringResource(R.string.translation_admin_flags_table_loading),
        emptyMessage = stringResource(R.string.translation_admin_flags_table_empty),
    )

/**
 * Stateless renderer — the unit/UI-test entry point. Sorts the rows via the pure [sortFlags], pages
 * them at [FLAGS_PAGE_SIZE], and hands them to the shared [DataTable]. The table body always renders:
 * with rows it shows the paged table + pagination footer; with none it shows the single
 * [emptyMessageFor] message (loading vs. empty), never a blank box.
 */
@Composable
fun FlagsTableContent(
    rows: List<FeatureFlagEntry>,
    loading: Boolean,
    labels: FlagsTableLabels,
    sortState: SortState,
    onSortChange: (String) -> Unit,
    onEdit: (FeatureFlagEntry) -> Unit,
    onAskDelete: (FeatureFlagEntry) -> Unit,
    modifier: Modifier = Modifier,
) {
    val sorted = remember(rows, sortState) { sortFlags(rows, sortState) }
    val total = sorted.size
    var page by remember(total) { mutableIntStateOf(1) }
    val visible =
        if (total == 0) {
            emptyList()
        } else {
            val bounds = PaginationMath.sliceBounds(page, FLAGS_PAGE_SIZE, total)
            sorted.subList(bounds.first, bounds.last + 1)
        }
    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            { FlagsPagination(page = page, total = total, onPageChange = { page = it }) }
        } else {
            null
        }

    DataTable(
        columns = flagsColumns(labels, onEdit, onAskDelete),
        rows = visible,
        keyOf = { it.key },
        modifier = modifier,
        sortState = sortState,
        onSortChange = onSortChange,
        emptyText = emptyMessageFor(loading, labels),
        footer = footer,
    )
}

/**
 * The three web columns: a sortable monospace `key`, a muted monospace JSON `value` preview, and the
 * `actions` pair (secondary Edit + danger Delete, mirroring the web `variant="secondary"` /
 * `variant="danger"` lucide-iconed buttons).
 */
private fun flagsColumns(
    labels: FlagsTableLabels,
    onEdit: (FeatureFlagEntry) -> Unit,
    onAskDelete: (FeatureFlagEntry) -> Unit,
): List<TableColumn<FeatureFlagEntry>> =
    listOf(
        TableColumn(key = "key", header = labels.keyHeader, weight = KEY_WEIGHT, sortable = true) {
            CodeText(it.key)
        },
        TableColumn(key = "value", header = labels.valueHeader, weight = VALUE_WEIGHT) {
            ValuePreview(previewValue(it.value))
        },
        TableColumn(key = "actions", header = labels.actionsHeader, weight = ACTIONS_WEIGHT) {
            FlagRowActions(row = it, labels = labels, onEdit = onEdit, onAskDelete = onAskDelete)
        },
    )

/**
 * Muted monospace value preview — the native analogue of the web `font-mono text-xs
 * text-[var(--text-muted)]` cell. Single-line + ellipsis keeps the row compact (the preview string is
 * already truncated by [previewValue]); the color reads from the scheme so light/dark theming holds.
 */
@Composable
private fun ValuePreview(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The per-row Edit + Delete buttons. Each carries its localized label (its TalkBack name) + onClick. */
@Composable
private fun FlagRowActions(
    row: FeatureFlagEntry,
    labels: FlagsTableLabels,
    onEdit: (FeatureFlagEntry) -> Unit,
    onAskDelete: (FeatureFlagEntry) -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = labels.editLabel,
            onClick = { onEdit(row) },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.Edit,
        )
        Button(
            label = labels.deleteLabel,
            onClick = { onAskDelete(row) },
            variant = ButtonVariant.Danger,
            size = ButtonSize.Sm,
            leadingIcon = FlagsTableGlyphs.Trash2,
        )
    }
}

/** Pagination footer — the web `DataTable` page controls, page size [FLAGS_PAGE_SIZE]. */
@Composable
private fun FlagsPagination(
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val context = LocalContext.current
    Pagination(
        page = page,
        pageSize = FLAGS_PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count ->
            context.getString(R.string.translation_pagination_showing, start, end, count)
        },
    )
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_LABELS =
    FlagsTableLabels(
        keyHeader = "Flag key",
        valueHeader = "Value",
        actionsHeader = "Actions",
        editLabel = "Edit",
        deleteLabel = "Delete",
        loadingMessage = "Loading flags\u2026",
        emptyMessage = "No feature flags are set on this server.",
    )

private val PREVIEW_ROWS =
    listOf(
        FeatureFlagEntry("feature.dlq.replay_enabled", JsonPrimitive(true)),
        FeatureFlagEntry("feature.export.max_rows", JsonPrimitive(50_000)),
        FeatureFlagEntry("feature.ui.default_theme", JsonPrimitive("dark")),
        FeatureFlagEntry(
            "feature.ratelimit.tiers",
            buildJsonObject {
                put("free", 10)
                put("pro", 100)
            },
        ),
    )

private val PREVIEW_SORT = SortState(SORT_KEY_KEY, SortDirection.Asc)

@Preview(name = "Data", showBackground = true)
@Composable
private fun FlagsTableDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FlagsTableContent(
            rows = PREVIEW_ROWS,
            loading = false,
            labels = PREVIEW_LABELS,
            sortState = PREVIEW_SORT,
            onSortChange = {},
            onEdit = {},
            onAskDelete = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun FlagsTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FlagsTableContent(
            rows = emptyList(),
            loading = true,
            labels = PREVIEW_LABELS,
            sortState = PREVIEW_SORT,
            onSortChange = {},
            onEdit = {},
            onAskDelete = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun FlagsTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FlagsTableContent(
            rows = emptyList(),
            loading = false,
            labels = PREVIEW_LABELS,
            sortState = PREVIEW_SORT,
            onSortChange = {},
            onEdit = {},
            onAskDelete = {},
        )
    }
}
