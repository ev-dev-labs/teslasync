// The native Jetpack Compose + Material 3 InboxBody feature view — a parity port of
// web/src/features/notifications/components/InboxBody.tsx. The web component is the shared notification-log
// inbox: a filter bar, an optional AI auto-categorization panel, a bulk-actions toolbar, and a GlassPanel that
// carries a select-all + count + view-toggle + "Mark all read" header above EITHER a day-grouped flat list of
// NotificationRows OR a threaded grouped list of NotificationGroupRows. It is used by InboxPage
// (`archived=false`) and ArchivedPage (`archived=true`).
//
// This native surface keeps that contract end to end and performs NO HTTP. The host supplies both feeds through
// the shared P1/S8 state-holder layer as [UiState]s — the flat NotificationLog list (web `useNotificationLogs`)
// and the grouped thread list (web `useNotificationGroups`) — plus the mutation callbacks (web
// `useMarkNotificationsRead` / `useArchiveNotifications` / … ); this view binds them and renders every
// lifecycle state those feeds can carry: a loading skeleton, a hard error with retry, the friendly inbox /
// grouped / archived empty states, content, and stale/offline ("last known" with a freshness chip + a silent
// auto-refresh). The view owns the same UI-local state the web component owns: the grouped/flat view mode, the
// bulk selection, the auto-mark-read-on-open effect, the per-row context menu, and the delete confirmation.
//
// Two web dependencies are SEPARATE surfaces / out-of-scope shared components, not reimplemented here: the
// `NotificationFilterBar` (its own surface) and the `AIInboxAutoCategorization` panel (an AI shared component,
// absent when ai_mode='off'). They are exposed as optional composable slots the host injects, so InboxBody
// composes them exactly as the web parent does without duplicating their prompts. The web toast / screen-reader
// announcements (`useToast` / `useAnnouncer`) are host side-effects: this view emits the action callbacks and
// leaves the toast surface to the host, mirroring the web context-provider split.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/feature-views/
// InboxBody — the P3 prompt's allowed-files path) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.inboxbody

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.BulkAction
import io.teslasync.android.components.datadisplay.BulkActionToolbar
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.DateGroup
import io.teslasync.android.components.datadisplay.DateGroupedList
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.SeverityBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.ContextMenuArea
import io.teslasync.android.components.ui.ContextMenuItem
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The web `<FadeIn>` entrance, in milliseconds. */
private const val FADE_DELAY_MS: Int = 120

/** Number of skeleton rows shown on first load — the web `[1,2,3,4,5].map(Skeleton)`. */
private const val SKELETON_ROWS: Int = 5

/** Skeleton-row height (the web `h-14`). */
private val SKELETON_ROW_HEIGHT = 56.dp

/** Unread-marker dot diameter. */
private val UNREAD_DOT = 8.dp

private const val SELECT_ALL_GROUPED: String = "grouped"
private const val SELECT_ALL_FLAT: String = "flat"

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). A single resolved-string
 * carrier keeps the render functions free of `stringResource` calls and lets the unit/UI tests inject fixed
 * copy. One field per web `t()` call the view itself renders (the toast/announce strings are host-owned).
 */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per web t() call the view renders.
data class InboxBodyStrings(
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val emptyTitle: String,
    val emptyMessage: String,
    val emptyArchivedTitle: String,
    val emptyArchivedMessage: String,
    val emptyCta: String,
    val groupEmptyTitle: String,
    val groupEmptyMessage: String,
    val selectAll: String,
    val selectRow: String,
    val viewGrouped: String,
    val viewFlat: String,
    val markAllRead: String,
    val bulkMarkRead: String,
    val bulkArchive: String,
    val bulkRestore: String,
    val bulkDelete: String,
    val clearSelection: String,
    val deleteConfirmTitle: String,
    val deleteConfirmBody: String,
    val deleteConfirm: String,
    val cancel: String,
    val close: String,
    val rowMarkRead: String,
    val rowMarkUnread: String,
    val rowArchive: String,
    val rowUnarchive: String,
    val viewContext: String,
    val today: String,
    val yesterday: String,
    val countFormat: String,
    val loading: String,
    val offline: String,
)

/**
 * Stateful entry point for the inbox. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * delegates to [InboxBodyContent], which owns the view-mode / selection / confirmation UI state and renders
 * every lifecycle state the two host feeds can carry. The host owns the feeds (P1/S8) and supplies the mutation
 * callbacks; this view never performs HTTP.
 *
 * @param archived `true` on the Archive tab (web `archived` prop) — disables grouping and the auto-mark effect.
 * @param flatState the cache-then-network projection of the flat NotificationLog list (web `useNotificationLogs`).
 * @param groupState the cache-then-network projection of the thread list (web `useNotificationGroups`).
 * @param onRefresh re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onMarkRead / onMarkUnread / onArchive / onUnarchive / onDelete the per-row + bulk mutation callbacks.
 * @param onBulkMarkRead the explicit bulk "mark read" mutation (web `useBulkMarkRead`).
 * @param onMarkAllRead the "mark all read" mutation over the visible unread rows (web `bulkMarkRead({all:true})`).
 * @param markOnOpen the auto-mark-read-on-open preference (web `teslasync.notifications.markOnOpen`).
 * @param markOnClick the mark-read-on-row-activate preference (web `teslasync.notifications.markOnClick`).
 * @param onViewContext opens an alert's drill-through (web "View context"); `null` hides the row action.
 * @param onConfigureRules the empty-state CTA (web `to:'/notifications/studio'`); `null` hides it.
 * @param filterBar the host-injected NotificationFilterBar surface slot (a sibling surface).
 * @param aiCategorization the host-injected AIInboxAutoCategorization slot (absent when ai_mode='off').
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun InboxBody(
    archived: Boolean,
    flatState: UiState<List<InboxNotification>>,
    groupState: UiState<List<InboxGroup>>,
    onRefresh: () -> Unit,
    onMarkRead: (List<Long>) -> Unit,
    onMarkUnread: (List<Long>) -> Unit,
    onArchive: (List<Long>) -> Unit,
    onUnarchive: (List<Long>) -> Unit,
    onDelete: (List<Long>) -> Unit,
    onBulkMarkRead: (List<Long>) -> Unit,
    onMarkAllRead: () -> Unit,
    modifier: Modifier = Modifier,
    markOnOpen: Boolean = true,
    markOnClick: Boolean = true,
    onViewContext: ((InboxNotification) -> Unit)? = null,
    onConfigureRules: (() -> Unit)? = null,
    filterBar: (@Composable () -> Unit)? = null,
    aiCategorization: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordInboxBodyOpened(logger) }
    InboxBodyContent(
        archived = archived,
        flatState = flatState,
        groupState = groupState,
        onRefresh = onRefresh,
        onMarkRead = onMarkRead,
        onMarkUnread = onMarkUnread,
        onArchive = onArchive,
        onUnarchive = onUnarchive,
        onDelete = onDelete,
        onBulkMarkRead = onBulkMarkRead,
        onMarkAllRead = onMarkAllRead,
        modifier = modifier,
        markOnOpen = markOnOpen,
        markOnClick = markOnClick,
        onViewContext = onViewContext,
        onConfigureRules = onConfigureRules,
        filterBar = filterBar,
        aiCategorization = aiCategorization,
    )
}

/**
 * Stateless renderer for the inbox — the unit/UI-test entry point. Owns the grouped/flat view mode, the bulk
 * selection set, and the pending-delete confirmation, then reproduces the web composition: the filter-bar +
 * AI slots, the bulk toolbar, and the GlassPanel header + body. The body switches across loading / error /
 * empty / content, adds the freshness chip when the active feed is refreshing / stale / offline, and
 * auto-refreshes a stale (non-error) feed — the freshness contract the sibling surfaces share.
 */
@Composable
fun InboxBodyContent(
    archived: Boolean,
    flatState: UiState<List<InboxNotification>>,
    groupState: UiState<List<InboxGroup>>,
    onRefresh: () -> Unit,
    onMarkRead: (List<Long>) -> Unit,
    onMarkUnread: (List<Long>) -> Unit,
    onArchive: (List<Long>) -> Unit,
    onUnarchive: (List<Long>) -> Unit,
    onDelete: (List<Long>) -> Unit,
    onBulkMarkRead: (List<Long>) -> Unit,
    onMarkAllRead: () -> Unit,
    modifier: Modifier = Modifier,
    markOnOpen: Boolean = true,
    markOnClick: Boolean = true,
    onViewContext: ((InboxNotification) -> Unit)? = null,
    onConfigureRules: (() -> Unit)? = null,
    filterBar: (@Composable () -> Unit)? = null,
    aiCategorization: (@Composable () -> Unit)? = null,
    nowMillis: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    strings: InboxBodyStrings = rememberInboxBodyStrings(),
) {
    var view by rememberSaveable { mutableStateOf(InboxView.Grouped) }
    var selected by remember { mutableStateOf(emptySet<Long>()) }
    var pendingDelete by remember { mutableStateOf<List<Long>?>(null) }

    val grouped = view == InboxView.Grouped && !archived
    val rows = flatState.data ?: emptyList()
    val groups = groupState.data ?: emptyList()
    val visibleIds = remember(rows) { rows.map { it.id } }
    val unreadCount = InboxBodyProjection.unreadCount(rows)
    val activeState: UiState<*> = if (grouped) groupState else flatState

    LaunchedEffect(view, archived) { selected = emptySet() }
    LaunchedEffect(activeState.stale, activeState.refreshing, activeState.hasError) {
        if (activeState.stale && !activeState.refreshing && !activeState.hasError) onRefresh()
    }
    val autoMarked = remember { mutableStateOf(false) }
    LaunchedEffect(grouped, archived, flatState.phase, rows) {
        if (!autoMarked.value && !flatState.isLoading) {
            val ids = InboxBodyProjection.autoMarkReadIds(rows, archived, grouped, markOnOpen)
            if (ids.isNotEmpty()) {
                autoMarked.value = true
                onMarkRead(ids)
            }
        }
    }

    val resources = LocalContext.current.resources
    val bulkActions =
        buildList {
            if (!archived) {
                add(BulkAction("mark-read", strings.bulkMarkRead, onClick = { onBulkMarkRead(selected.toList()) }))
                add(
                    BulkAction("archive", strings.bulkArchive, onClick = {
                        onArchive(selected.toList())
                        selected = emptySet()
                    }),
                )
            } else {
                add(
                    BulkAction("restore", strings.bulkRestore, onClick = {
                        onUnarchive(selected.toList())
                        selected = emptySet()
                    }),
                )
            }
            add(BulkAction("delete", strings.bulkDelete, onClick = { pendingDelete = selected.toList() }, danger = true))
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (filterBar != null) FadeIn(delayMs = FADE_DELAY_MS) { filterBar() }
        if (aiCategorization != null) aiCategorization()

        BulkActionToolbar(
            selectedCount = selected.size,
            onClear = { selected = emptySet() },
            actions = bulkActions,
            countText = { count -> resources.getQuantityString(R.plurals.translation_bulk_selected, count, count) },
            clearLabel = strings.clearSelection,
        )

        GlassPanel(padding = PanelPadding.Md) {
            InboxHeaderRow(
                archived = archived,
                grouped = grouped,
                view = view,
                onViewChange = { view = it },
                count = if (grouped) groups.size else rows.size,
                unreadCount = unreadCount,
                selectionState = InboxBodyProjection.selectionState(visibleIds, selected),
                onToggleSelectAll = {
                    selected =
                        if (InboxBodyProjection.selectionState(visibleIds, selected) == SelectionState.All) {
                            emptySet()
                        } else {
                            visibleIds.toSet()
                        }
                },
                onMarkAllRead = onMarkAllRead,
                strings = strings,
            )
            Spacer(Modifier.size(Spacing.sm))
            InboxPanelBody(
                archived = archived,
                grouped = grouped,
                activeState = activeState,
                rows = rows,
                groups = groups,
                selected = selected,
                strings = strings,
                nowMillis = nowMillis,
                zone = zone,
                locale = locale,
                onRefresh = onRefresh,
                onConfigureRules = onConfigureRules,
                onToggleSelect = { id, on -> selected = if (on) selected + id else selected - id },
                onActivate = { row -> if (!row.isRead && markOnClick) onMarkRead(listOf(row.id)) },
                onMarkRead = onMarkRead,
                onMarkUnread = onMarkUnread,
                onArchive = onArchive,
                onUnarchive = onUnarchive,
                onRequestDelete = { ids -> pendingDelete = ids },
                onViewContext = onViewContext,
            )
        }
    }

    val toDelete = pendingDelete
    if (toDelete != null) {
        ConfirmDialog(
            title = strings.deleteConfirmTitle,
            message = strings.deleteConfirmBody,
            confirmLabel = strings.deleteConfirm,
            cancelLabel = strings.cancel,
            onConfirm = {
                onDelete(toDelete)
                selected = selected - toDelete.toSet()
                pendingDelete = null
            },
            onCancel = { pendingDelete = null },
            severity = ConfirmSeverity.Danger,
            closeLabel = strings.close,
        )
    }
}

/**
 * The always-visible header: the select-all tri-state (flat view only), the localized count, the grouped/flat
 * view toggle (inbox tab only), and the "Mark all read" affordance (inbox + flat + unread > 0) — the web
 * GlassPanel header bar.
 */
@Composable
private fun InboxHeaderRow(
    archived: Boolean,
    grouped: Boolean,
    view: InboxView,
    onViewChange: (InboxView) -> Unit,
    count: Int,
    unreadCount: Int,
    selectionState: SelectionState,
    onToggleSelectAll: () -> Unit,
    onMarkAllRead: () -> Unit,
    strings: InboxBodyStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!grouped) {
            TriStateCheckbox(
                state = toggleableState(selectionState),
                onClick = onToggleSelectAll,
                modifier = Modifier.semantics { contentDescription = strings.selectAll },
            )
        }
        Caption(String.format(Locale.getDefault(), strings.countFormat, count))
        Spacer(Modifier.weight(1f))
        if (!archived) {
            TabNav(
                items =
                    listOf(
                        TabNavItem(SELECT_ALL_GROUPED, strings.viewGrouped, LayersGlyph),
                        TabNavItem(SELECT_ALL_FLAT, strings.viewFlat, ListGlyph),
                    ),
                selectedKey = if (view == InboxView.Grouped) SELECT_ALL_GROUPED else SELECT_ALL_FLAT,
                onSelect = { onViewChange(if (it == SELECT_ALL_GROUPED) InboxView.Grouped else InboxView.Flat) },
            )
        }
        if (!archived && !grouped && unreadCount > 0) {
            Button(
                label = strings.markAllRead,
                onClick = onMarkAllRead,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = CheckCheckGlyph,
            )
        }
    }
}

/**
 * The body region beneath the header — the loading skeleton, the hard-error retry surface, the empty state, or
 * the content list (day-grouped flat rows or grouped thread rows), with a freshness chip when the active feed
 * is refreshing / stale / offline.
 */
@Composable
private fun InboxPanelBody(
    archived: Boolean,
    grouped: Boolean,
    activeState: UiState<*>,
    rows: List<InboxNotification>,
    groups: List<InboxGroup>,
    selected: Set<Long>,
    strings: InboxBodyStrings,
    nowMillis: Long,
    zone: ZoneId,
    locale: Locale,
    onRefresh: () -> Unit,
    onConfigureRules: (() -> Unit)?,
    onToggleSelect: (Long, Boolean) -> Unit,
    onActivate: (InboxNotification) -> Unit,
    onMarkRead: (List<Long>) -> Unit,
    onMarkUnread: (List<Long>) -> Unit,
    onArchive: (List<Long>) -> Unit,
    onUnarchive: (List<Long>) -> Unit,
    onRequestDelete: (List<Long>) -> Unit,
    onViewContext: ((InboxNotification) -> Unit)?,
) {
    val isEmpty = if (grouped) groups.isEmpty() else rows.isEmpty()
    when {
        activeState.isLoading -> InboxLoading(strings)
        activeState.isError -> InboxError(strings = strings, onRetry = onRefresh)
        else -> {
            if (activeState.stale || activeState.refreshing || activeState.hasError) {
                InboxFreshnessRow(activeState, strings)
            }
            when {
                isEmpty -> InboxEmpty(archived = archived, grouped = grouped, strings = strings, onConfigureRules = onConfigureRules)
                grouped ->
                    InboxGroupedList(
                        groups = groups,
                        selected = selected,
                        strings = strings,
                        formatTime = rememberTimeFormatter(zone, locale),
                        onToggleSelect = onToggleSelect,
                        onActivate = onActivate,
                        onMarkRead = onMarkRead,
                        onMarkUnread = onMarkUnread,
                        onUnarchive = onUnarchive,
                        onArchive = onArchive,
                        onRequestDelete = onRequestDelete,
                        onViewContext = onViewContext,
                        archived = archived,
                    )
                else ->
                    InboxFlatList(
                        rows = rows,
                        selected = selected,
                        strings = strings,
                        nowMillis = nowMillis,
                        zone = zone,
                        locale = locale,
                        formatTime = rememberTimeFormatter(zone, locale),
                        onToggleSelect = onToggleSelect,
                        onActivate = onActivate,
                        onMarkRead = onMarkRead,
                        onMarkUnread = onMarkUnread,
                        onArchive = onArchive,
                        onUnarchive = onUnarchive,
                        onRequestDelete = onRequestDelete,
                        onViewContext = onViewContext,
                        archived = archived,
                    )
            }
        }
    }
}

/** First-load skeleton — five shimmering rows so the panel is never blank (web five `Skeleton`s). */
@Composable
private fun InboxLoading(strings: InboxBodyStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) { Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true) }
    }
}

/** Hard-error surface with a retry affordance — the web error `EmptyState` with a Bell glyph + retry. */
@Composable
private fun InboxError(
    strings: InboxBodyStrings,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        icon = BellGlyph,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The friendly empty state — inbox / grouped / archived variants, never a blank panel (web `EmptyState`). */
@Composable
private fun InboxEmpty(
    archived: Boolean,
    grouped: Boolean,
    strings: InboxBodyStrings,
    onConfigureRules: (() -> Unit)?,
) {
    val cta = if (!archived && onConfigureRules != null) EmptyStateAction(strings.emptyCta, onConfigureRules) else null
    val title =
        when {
            archived -> strings.emptyArchivedTitle
            grouped -> strings.groupEmptyTitle
            else -> strings.emptyTitle
        }
    val message =
        when {
            archived -> strings.emptyArchivedMessage
            grouped -> strings.groupEmptyMessage
            else -> strings.emptyMessage
        }
    EmptyState(message = message, icon = BellGlyph, title = title, action = cta, modifier = Modifier.fillMaxWidth())
}

/** The day-grouped flat list (web `grouped.map(...)` of `NotificationRow`s under day headers). */
@Composable
private fun InboxFlatList(
    rows: List<InboxNotification>,
    selected: Set<Long>,
    strings: InboxBodyStrings,
    nowMillis: Long,
    zone: ZoneId,
    locale: Locale,
    formatTime: (Long) -> String,
    onToggleSelect: (Long, Boolean) -> Unit,
    onActivate: (InboxNotification) -> Unit,
    onMarkRead: (List<Long>) -> Unit,
    onMarkUnread: (List<Long>) -> Unit,
    onArchive: (List<Long>) -> Unit,
    onUnarchive: (List<Long>) -> Unit,
    onRequestDelete: (List<Long>) -> Unit,
    onViewContext: ((InboxNotification) -> Unit)?,
    archived: Boolean,
) {
    val dateGroups =
        remember(rows, nowMillis, zone, locale, strings) {
            InboxBodyProjection.groupByDay(rows, nowMillis, zone, locale).map { bucket ->
                DateGroup(
                    dateKey = dayLabelKey(bucket.label),
                    dateLabel = dayLabelText(bucket.label, strings),
                    items = bucket.rows,
                )
            }
        }
    DateGroupedList(groups = dateGroups, modifier = Modifier.fillMaxWidth()) { row ->
        InboxRowItem(
            row = row,
            selected = selected.contains(row.id),
            archived = archived,
            strings = strings,
            timeLabel = formatTime(row.createdAtMillis),
            onToggleSelect = { on -> onToggleSelect(row.id, on) },
            onActivate = { onActivate(row) },
            onPrimaryAction = { if (archived) onUnarchive(listOf(row.id)) else onArchive(listOf(row.id)) },
            contextItems =
                buildRowContextItems(
                    row = row,
                    archived = archived,
                    strings = strings,
                    onMarkRead = onMarkRead,
                    onMarkUnread = onMarkUnread,
                    onArchive = onArchive,
                    onUnarchive = onUnarchive,
                    onRequestDelete = onRequestDelete,
                    onViewContext = onViewContext,
                ),
        )
    }
}

/** The threaded grouped list (web `groups.map(...)` of `NotificationGroupRow`s). */
@Composable
private fun InboxGroupedList(
    groups: List<InboxGroup>,
    selected: Set<Long>,
    strings: InboxBodyStrings,
    formatTime: (Long) -> String,
    onToggleSelect: (Long, Boolean) -> Unit,
    onActivate: (InboxNotification) -> Unit,
    onMarkRead: (List<Long>) -> Unit,
    onMarkUnread: (List<Long>) -> Unit,
    onUnarchive: (List<Long>) -> Unit,
    onArchive: (List<Long>) -> Unit,
    onRequestDelete: (List<Long>) -> Unit,
    onViewContext: ((InboxNotification) -> Unit)?,
    archived: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = NOTIFICATION_GROUPS_TAG },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        groups.forEach { group ->
            val row = group.latest
            InboxRowItem(
                row = row,
                selected = selected.contains(row.id),
                archived = archived,
                strings = strings,
                timeLabel = formatTime(row.createdAtMillis),
                threadCount = group.count,
                onToggleSelect = { on -> onToggleSelect(row.id, on) },
                onActivate = { onActivate(row) },
                onPrimaryAction = { if (archived) onUnarchive(listOf(row.id)) else onArchive(listOf(row.id)) },
                contextItems =
                    buildRowContextItems(
                        row = row,
                        archived = archived,
                        strings = strings,
                        onMarkRead = onMarkRead,
                        onMarkUnread = onMarkUnread,
                        onArchive = onArchive,
                        onUnarchive = onUnarchive,
                        onRequestDelete = onRequestDelete,
                        onViewContext = onViewContext,
                    ),
            )
        }
    }
}

/**
 * One inbox row — a selection checkbox, an unread dot, the severity chip, the title + message + meta line, an
 * optional thread-count badge, and a trailing archive/restore action; long-press opens the full context menu
 * and a tap activates the row (web `NotificationRow` + `SwipeRow` + context menu, folded into one accessible
 * Android row).
 */
@Composable
private fun InboxRowItem(
    row: InboxNotification,
    selected: Boolean,
    archived: Boolean,
    strings: InboxBodyStrings,
    timeLabel: String,
    onToggleSelect: (Boolean) -> Unit,
    onActivate: () -> Unit,
    onPrimaryAction: () -> Unit,
    contextItems: List<ContextMenuItem>,
    threadCount: Long = 1,
) {
    ContextMenuArea(items = contextItems, onClick = onActivate, modifier = Modifier.fillMaxWidth()) {
        GlassPanel(padding = PanelPadding.Sm) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Checkbox(
                    checked = selected,
                    onCheckedChange = onToggleSelect,
                    modifier = Modifier.semantics { contentDescription = strings.selectRow },
                )
                if (!row.isRead) {
                    Spacer(Modifier.size(UNREAD_DOT).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                }
                SeverityBadge(severity = row.severity, size = ChipSize.Sm)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    BodyText(row.title, maxLines = 1)
                    if (row.message.isNotBlank()) {
                        BodyText(row.message, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                    }
                    Caption(rowMeta(row.vehicleName, timeLabel))
                }
                if (threadCount > 1) {
                    Badge(threadCount.toString(), variant = BadgeVariant.Neutral)
                }
                IconButton(
                    imageVector = if (archived) ArchiveRestoreGlyph else ArchiveGlyph,
                    contentDescription = if (archived) strings.rowUnarchive else strings.rowArchive,
                    onClick = onPrimaryAction,
                    size = IconSize.Sm,
                )
            }
        }
    }
}

/** The freshness chip — the honest "last known + retry" affordance when the feed is refreshing/stale/offline. */
@Composable
private fun InboxFreshnessRow(
    state: UiState<*>,
    strings: InboxBodyStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.loading,
            errorLabel = strings.offline,
            formatAge = rememberInboxFreshnessFormatter(),
        )
    }
}

/** Maps the master [SelectionState] onto the Material tri-state checkbox value. */
private fun toggleableState(state: SelectionState): ToggleableState =
    when (state) {
        SelectionState.None -> ToggleableState.Off
        SelectionState.All -> ToggleableState.On
        SelectionState.Some -> ToggleableState.Indeterminate
    }

/** The localized day-header text for a [DayLabel] (web "Today" / "Yesterday" / the formatted absolute date). */
private fun dayLabelText(
    label: DayLabel,
    strings: InboxBodyStrings,
): String =
    when (label) {
        DayLabel.Today -> strings.today
        DayLabel.Yesterday -> strings.yesterday
        is DayLabel.Dated -> label.text
    }

/** A stable list key for a [DayLabel]. */
private fun dayLabelKey(label: DayLabel): String =
    when (label) {
        DayLabel.Today -> "today"
        DayLabel.Yesterday -> "yesterday"
        is DayLabel.Dated -> label.text
    }

/** Joins the optional vehicle name and the time into the row's meta line. */
private fun rowMeta(
    vehicleName: String?,
    timeLabel: String,
): String = listOfNotNull(vehicleName?.takeIf { it.isNotBlank() }, timeLabel).joinToString(META_SEPARATOR)

/**
 * Builds the per-row context-menu items — mark read/unread, archive/restore, the optional "View context"
 * drill-through, and delete — mirroring the web `buildRowContextMenu`.
 */
@Suppress("LongParameterList") // Mirrors the web buildRowContextMenu's discrete per-action callbacks.
private fun buildRowContextItems(
    row: InboxNotification,
    archived: Boolean,
    strings: InboxBodyStrings,
    onMarkRead: (List<Long>) -> Unit,
    onMarkUnread: (List<Long>) -> Unit,
    onArchive: (List<Long>) -> Unit,
    onUnarchive: (List<Long>) -> Unit,
    onRequestDelete: (List<Long>) -> Unit,
    onViewContext: ((InboxNotification) -> Unit)?,
): List<ContextMenuItem> =
    buildList {
        if (row.isRead) {
            add(ContextMenuItem(strings.rowMarkUnread, { onMarkUnread(listOf(row.id)) }, leadingIcon = MailGlyph))
        } else {
            add(ContextMenuItem(strings.rowMarkRead, { onMarkRead(listOf(row.id)) }, leadingIcon = MailOpenGlyph))
        }
        if (archived || row.isArchived) {
            add(ContextMenuItem(strings.rowUnarchive, { onUnarchive(listOf(row.id)) }, leadingIcon = ArchiveRestoreGlyph))
        } else {
            add(ContextMenuItem(strings.rowArchive, { onArchive(listOf(row.id)) }, leadingIcon = ArchiveGlyph))
        }
        if (row.canViewContext && onViewContext != null) {
            add(ContextMenuItem(strings.viewContext, { onViewContext(row) }, leadingIcon = DataDisplayGlyphs.ExternalLink))
        }
        add(ContextMenuItem(strings.bulkDelete, { onRequestDelete(listOf(row.id)) }, destructive = true, leadingIcon = TrashGlyph))
    }

/** A localized short time-of-day formatter for the row meta line. */
@Composable
private fun rememberTimeFormatter(
    zone: ZoneId,
    locale: Locale,
): (Long) -> String {
    val formatter =
        remember(zone, locale) {
            DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).withZone(zone)
        }
    return remember(formatter) { { millis -> formatter.format(Instant.ofEpochMilli(millis)) } }
}

/** Resolves every catalog string the view renders into a single [InboxBodyStrings] (P1/S10). */
@Composable
fun rememberInboxBodyStrings(): InboxBodyStrings {
    val strings =
        InboxBodyStrings(
            errorTitle = stringResource(R.string.translation_notifications_inbox_error_title),
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retry = stringResource(R.string.translation_common_retry),
            emptyTitle = stringResource(R.string.translation_notifications_inbox_empty_title),
            emptyMessage = stringResource(R.string.translation_notifications_inbox_empty_message),
            emptyArchivedTitle = stringResource(R.string.translation_notifications_inbox_empty_archivedTitle),
            emptyArchivedMessage = stringResource(R.string.translation_notifications_inbox_empty_archivedMessage),
            emptyCta = stringResource(R.string.translation_notifications_inbox_empty_cta),
            groupEmptyTitle = stringResource(R.string.translation_notifications_group_emptyTitle),
            groupEmptyMessage = stringResource(R.string.translation_notifications_group_emptyMessage),
            selectAll = stringResource(R.string.translation_notifications_inbox_selectAll),
            selectRow = stringResource(R.string.translation_notifications_inbox_row_select),
            viewGrouped = stringResource(R.string.translation_notifications_view_grouped),
            viewFlat = stringResource(R.string.translation_notifications_view_flat),
            markAllRead = stringResource(R.string.translation_notifications_markAllRead_action),
            bulkMarkRead = stringResource(R.string.translation_notifications_inbox_bulk_markRead),
            bulkArchive = stringResource(R.string.translation_notifications_inbox_bulk_archive),
            bulkRestore = stringResource(R.string.translation_notifications_inbox_bulk_restore),
            bulkDelete = stringResource(R.string.translation_bulk_actions_delete),
            clearSelection = stringResource(R.string.translation_bulk_clear),
            deleteConfirmTitle = stringResource(R.string.translation_notifications_inbox_bulk_deleteConfirmTitle),
            deleteConfirmBody = stringResource(R.string.translation_notifications_inbox_bulk_deleteConfirmBody),
            deleteConfirm = stringResource(R.string.translation_common_delete),
            cancel = stringResource(R.string.translation_common_cancel),
            close = stringResource(R.string.translation_common_close),
            rowMarkRead = stringResource(R.string.translation_notifications_inbox_row_markRead),
            rowMarkUnread = stringResource(R.string.translation_notifications_inbox_row_markUnread),
            rowArchive = stringResource(R.string.translation_notifications_inbox_row_archive),
            rowUnarchive = stringResource(R.string.translation_notifications_inbox_row_unarchive),
            viewContext = stringResource(R.string.translation_alerts_viewContext),
            today = stringResource(R.string.translation_common_today),
            yesterday = stringResource(R.string.translation_common_yesterday),
            countFormat = stringResource(R.string.translation_notifications_inbox_countLabel),
            loading = stringResource(R.string.translation_common_loading),
            offline = stringResource(R.string.translation_common_offline),
        )
    return remember(strings) { strings }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberInboxFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val META_SEPARATOR: String = " \u00B7 "
private const val EM_DASH: String = "\u2014"
private const val NOTIFICATION_GROUPS_TAG: String = "notification-groups"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private fun previewRow(
    id: Long,
    title: String,
    read: Boolean,
    severity: String,
): InboxNotification =
    InboxNotification(
        id = id,
        title = title,
        message = "Vehicle reported a $severity condition that matched an alert rule.",
        severity = severity,
        createdAtMillis = 1_700_000_000_000L + id * 3_600_000L,
        isRead = read,
        isArchived = false,
        canViewContext = true,
        ruleName = "Rule $id",
        vehicleName = "Model 3",
    )

private fun previewRows(): List<InboxNotification> =
    listOf(
        previewRow(1, "Charging complete", read = false, severity = "info"),
        previewRow(2, "Tire pressure low", read = false, severity = "warn"),
        previewRow(3, "Sentry event detected", read = true, severity = "critical"),
    )

private fun previewGroups(): List<InboxGroup> = previewRows().map { InboxGroup(groupKey = "g${it.id}", latest = it, count = it.id + 1) }

@Preview(name = "Loading", showBackground = true)
@Composable
private fun InboxBodyLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InboxBodyContent(
            archived = false,
            flatState = UiState(UiPhase.Loading),
            groupState = UiState(UiPhase.Loading),
            onRefresh = {},
            onMarkRead = {},
            onMarkUnread = {},
            onArchive = {},
            onUnarchive = {},
            onDelete = {},
            onBulkMarkRead = {},
            onMarkAllRead = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun InboxBodyErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InboxBodyContent(
            archived = false,
            flatState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            groupState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = {},
            onMarkRead = {},
            onMarkUnread = {},
            onArchive = {},
            onUnarchive = {},
            onDelete = {},
            onBulkMarkRead = {},
            onMarkAllRead = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun InboxBodyEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InboxBodyContent(
            archived = false,
            flatState = UiState(UiPhase.Empty, data = emptyList()),
            groupState = UiState(UiPhase.Empty, data = emptyList()),
            onRefresh = {},
            onMarkRead = {},
            onMarkUnread = {},
            onArchive = {},
            onUnarchive = {},
            onDelete = {},
            onBulkMarkRead = {},
            onMarkAllRead = {},
            onConfigureRules = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Content (flat)", showBackground = true)
@Composable
private fun InboxBodyFlatPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InboxBodyContent(
            archived = true,
            flatState = UiState(UiPhase.Content, data = previewRows()),
            groupState = UiState(UiPhase.Content, data = previewGroups()),
            onRefresh = {},
            onMarkRead = {},
            onMarkUnread = {},
            onArchive = {},
            onUnarchive = {},
            onDelete = {},
            onBulkMarkRead = {},
            onMarkAllRead = {},
            nowMillis = 1_700_000_000_000L,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Content (grouped)", showBackground = true)
@Composable
private fun InboxBodyGroupedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InboxBodyContent(
            archived = false,
            flatState = UiState(UiPhase.Content, data = previewRows()),
            groupState = UiState(UiPhase.Content, data = previewGroups()),
            onRefresh = {},
            onMarkRead = {},
            onMarkUnread = {},
            onArchive = {},
            onUnarchive = {},
            onDelete = {},
            onBulkMarkRead = {},
            onMarkAllRead = {},
            nowMillis = 1_700_000_000_000L,
            locale = Locale.US,
        )
    }
}
