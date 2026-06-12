// The native Jetpack Compose + Material 3 NotificationGroupRow feature view — a parity port of
// web/src/features/notifications/components/NotificationGroupRow.tsx. The web component renders one
// server-aggregated notification THREAD: the group's latest row, a grouping-chrome row OUTSIDE that row (a
// "+N similar" expand/collapse chip, an unread-count chip, a "N vehicles affected" caption, and a "Mark group
// read" action), and a lazily-fetched expanded member list. Singleton groups (group_key == null) hide all
// grouping chrome so they look identical to a flat row.
//
// This port keeps that contract end to end. The latest + expanded member rows are rendered inline here (the
// shared NotificationRow surface is sibling prompt A-0191, built AFTER this one, so it cannot be composed yet);
// the grouping affordances live outside that row exactly as on the web. The thread fetch is lazy — the
// [NotificationGroupRowPresenter] opens the shared P1/S8 member feed ONLY while expanded (web
// `enabled: expanded && !isSingleton`) — and the "Mark group read" action routes through the shared
// `bulkMarkRead({ group_key })` mutation, raising a localized success/error toast (web `useToast`) as a one-shot
// [UiEvent]. The expanded region reproduces the web member-region branches (loading spinner / error / empty /
// rows) and adds the P3-mandated freshness chip + auto-refresh for stale/offline. The view performs NO HTTP.
// Every visible string resolves through the i18n catalog (P1/S10) and every interactive element carries a
// TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationGroupRow) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationgrouprow

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatusDot
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/** Low-alpha wash behind the cyan "+N similar" expand chip — the web `bg-cyan-400/10`. */
private const val CHIP_WASH_ALPHA: Float = 0.14f

/** The expanded region's leading rule — the web `border-l-2 border-white/[0.06]`. */
private val REGION_RULE_WIDTH: Dp = 2.dp

/** Inline members spinner diameter — sized to sit beside the "Loading thread members…" label. */
private val INLINE_SPINNER_SIZE: Dp = 16.dp

private val INLINE_SPINNER_STROKE: Dp = 2.dp

/**
 * Stateful entry point for a notification group thread. Binds the shared Notifications feed via [source] into a
 * per-row [NotificationGroupRowPresenter], records the one-shot `view.opened` diagnostic, forwards the
 * mark-group-read toast to [onMessage], and renders. The host inbox supplies the [group], the parent [filters],
 * the per-row selection set + callbacks, and the [archived] mode — exactly like the web component's props.
 *
 * @param group the server-aggregated thread (host-owned, web parity).
 * @param source the cache-then-network Notifications seam (a `NotificationsStore`/repository adapter).
 * @param filters the parent inbox filters, reused so the lazy thread fetch mirrors the same window.
 * @param selectedIds the per-member selection set; the visible row maps a checkbox click to its single id.
 * @param onMessage receives the mark-group-read success/error toast (web `useToast`) as a localized [UiEvent].
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun NotificationGroupRow(
    group: NotificationLogGroup,
    source: NotificationGroupRowSource,
    modifier: Modifier = Modifier,
    filters: NotificationFilters = NotificationFilters(),
    selectedIds: Set<Long> = emptySet(),
    onSelectionChange: (Long, Boolean) -> Unit = { _, _ -> },
    onActivate: (NotificationLog) -> Unit = {},
    onArchive: (Long) -> Unit = {},
    onUnarchive: (Long) -> Unit = {},
    onMarkRead: (Long) -> Unit = {},
    onMarkUnread: (Long) -> Unit = {},
    archived: Boolean = false,
    onMessage: (UiEvent.Message) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val scope = rememberCoroutineScope()
    val presenter =
        remember(group.groupKey, group.latest.id, filters, source, logger, scope) {
            NotificationGroupRowPresenter(source, logger, group, filters, scope)
        }
    LaunchedEffect(presenter) { presenter.recordViewOpened() }
    LaunchedEffect(presenter) {
        presenter.events.collect { event -> if (event is UiEvent.Message) onMessage(event) }
    }
    val expanded by presenter.expanded.collectAsStateWithLifecycle()
    val membersState by presenter.membersState.collectAsStateWithLifecycle()
    val markPending by presenter.markPending.collectAsStateWithLifecycle()

    NotificationGroupRowContent(
        group = group,
        membersState = membersState,
        expanded = expanded,
        markPending = markPending,
        onToggleExpand = presenter::toggleExpanded,
        onMarkGroupRead = presenter::markGroupRead,
        onRetryMembers = presenter::refresh,
        modifier = modifier,
        selectedIds = selectedIds,
        onSelectionChange = onSelectionChange,
        onActivate = onActivate,
        onArchive = onArchive,
        onUnarchive = onUnarchive,
        onMarkRead = onMarkRead,
        onMarkUnread = onMarkUnread,
        archived = archived,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always draws the latest
 * row; draws the grouping chrome when the group is a real thread (web `!isSingleton && …`); and, while expanded,
 * draws the lazily-fetched member region (loading / error+retry / empty / rows) with a freshness chip that
 * reflects refreshing/stale/offline. Stale (non-error) member data auto-refreshes, mirroring the sibling
 * freshness contract. [nowMillis] fixes the relative-age clock for tests.
 */
@Composable
fun NotificationGroupRowContent(
    group: NotificationLogGroup,
    membersState: UiState<List<NotificationLog>>,
    expanded: Boolean,
    markPending: Boolean,
    onToggleExpand: () -> Unit,
    onMarkGroupRead: () -> Unit,
    onRetryMembers: () -> Unit,
    modifier: Modifier = Modifier,
    selectedIds: Set<Long> = emptySet(),
    onSelectionChange: (Long, Boolean) -> Unit = { _, _ -> },
    onActivate: (NotificationLog) -> Unit = {},
    onArchive: (Long) -> Unit = {},
    onUnarchive: (Long) -> Unit = {},
    onMarkRead: (Long) -> Unit = {},
    onMarkUnread: (Long) -> Unit = {},
    archived: Boolean = false,
    nowMillis: Long = System.currentTimeMillis(),
    strings: NotificationGroupRowStrings = rememberNotificationGroupRowStrings(),
) {
    LaunchedEffect(expanded, membersState.stale, membersState.refreshing, membersState.hasError) {
        if (NotificationGroupRowProjection.shouldAutoRefreshMembers(
                expanded = expanded,
                stale = membersState.stale,
                refreshing = membersState.refreshing,
                hasError = membersState.hasError,
            )
        ) {
            onRetryMembers()
        }
    }
    val model = remember(group, archived, nowMillis) { NotificationGroupRowProjection.model(group, archived, nowMillis) }

    Column(
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        NotificationMemberRowView(
            log = group.latest,
            now = nowMillis,
            isSelected = group.latest.id in selectedIds,
            onSelectionChange = onSelectionChange,
            onActivate = onActivate,
            onArchive = onArchive,
            onUnarchive = onUnarchive,
            onMarkRead = onMarkRead,
            onMarkUnread = onMarkUnread,
            archived = archived,
            strings = strings,
        )
        if (model.showGroupingChrome) {
            GroupChrome(
                model = model,
                expanded = expanded,
                markPending = markPending,
                onToggleExpand = onToggleExpand,
                onMarkGroupRead = onMarkGroupRead,
                strings = strings,
            )
        }
        if (expanded && !model.isSingleton) {
            GroupMembersRegion(
                membersState = membersState,
                latestId = group.latest.id,
                now = nowMillis,
                selectedIds = selectedIds,
                onSelectionChange = onSelectionChange,
                onActivate = onActivate,
                onArchive = onArchive,
                onUnarchive = onUnarchive,
                onMarkRead = onMarkRead,
                onMarkUnread = onMarkUnread,
                onRetry = onRetryMembers,
                archived = archived,
                strings = strings,
            )
        }
    }
}

/** The grouping-chrome row (web's wrap row): the expand chip, unread chip, vehicles caption, and mark-read. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GroupChrome(
    model: NotificationGroupRowModel,
    expanded: Boolean,
    markPending: Boolean,
    onToggleExpand: () -> Unit,
    onMarkGroupRead: () -> Unit,
    strings: NotificationGroupRowStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = Spacing.md, end = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        FlowRow(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (model.showExpandToggle) {
                ExpandChip(expanded = expanded, extraCount = model.extraCount, onToggle = onToggleExpand, strings = strings)
            }
            if (model.showUnreadChip) {
                UnreadCountChip(unreadCount = model.unreadCount)
            }
            if (model.showVehiclesAffected) {
                Caption(
                    text =
                        pluralStringResource(
                            R.plurals.translation_notifications_group_vehicleAffected,
                            model.vehicleCount,
                            model.vehicleCount,
                        ),
                )
            }
        }
        if (model.showMarkRead) {
            Button(
                label = strings.markGroupRead,
                onClick = onMarkGroupRead,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = !markPending,
                loading = markPending,
                leadingIcon = NotificationGroupRowGlyphs.MailOpen,
            )
        }
    }
}

/** The clickable "+N similar" expand/collapse chip — a cyan-washed pill carrying a chevron + count. */
@Composable
private fun ExpandChip(
    expanded: Boolean,
    extraCount: Int,
    onToggle: () -> Unit,
    strings: NotificationGroupRowStrings,
) {
    val similar =
        pluralStringResource(
            R.plurals.translation_notifications_group_similar,
            extraCount,
            extraCount,
        )
    val toggleLabel =
        if (expanded) {
            strings.collapse
        } else {
            pluralStringResource(
                R.plurals.translation_notifications_group_expand,
                extraCount,
                extraCount,
            )
        }
    Surface(
        onClick = onToggle,
        modifier =
            Modifier.semantics {
                role = Role.Button
                contentDescription = toggleLabel
            },
        shape = RoundedCornerShape(Radius.pill),
        color = TeslaTokens.status.info.copy(alpha = CHIP_WASH_ALPHA),
        contentColor = TeslaTokens.status.info,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = if (expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Xs,
            )
            Text(similar, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** The amber unread-count chip — the web `bg-amber-400/10 text-amber-300` pill. */
@Composable
private fun UnreadCountChip(unreadCount: Int) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = TeslaTokens.status.warning.copy(alpha = CHIP_WASH_ALPHA),
        contentColor = TeslaTokens.status.warning,
    ) {
        Text(
            text = unreadCount.toString(),
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

/** The expanded thread-members region — leading rule + freshness chip + the loading/error/empty/rows branch. */
@Composable
private fun GroupMembersRegion(
    membersState: UiState<List<NotificationLog>>,
    latestId: Long,
    now: Long,
    selectedIds: Set<Long>,
    onSelectionChange: (Long, Boolean) -> Unit,
    onActivate: (NotificationLog) -> Unit,
    onArchive: (Long) -> Unit,
    onUnarchive: (Long) -> Unit,
    onMarkRead: (Long) -> Unit,
    onMarkUnread: (Long) -> Unit,
    onRetry: () -> Unit,
    archived: Boolean,
    strings: NotificationGroupRowStrings,
) {
    val otherLogs = remember(membersState.data, latestId) { (membersState.data ?: emptyList()).filter { it.id != latestId } }
    val surface = NotificationGroupRowProjection.membersSurface(membersState.isLoading, membersState.isError, otherLogs.size)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
                .padding(start = Spacing.md)
                .semantics { contentDescription = strings.collapse },
    ) {
        Box(
            modifier =
                Modifier
                    .width(REGION_RULE_WIDTH)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.outlineVariant),
        )
        Column(
            modifier = Modifier.weight(1f).padding(start = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (membersState.stale || membersState.refreshing || membersState.hasError) {
                MembersFreshnessRow(membersState)
            }
            when (surface) {
                GroupMembersSurface.Loading -> MembersLoading(strings.loadingMembers)
                GroupMembersSurface.Error -> MembersError(strings.membersError, onRetry)
                GroupMembersSurface.Empty -> HelperText(strings.noMembers, modifier = Modifier.padding(vertical = Spacing.xs))
                GroupMembersSurface.Ready ->
                    otherLogs.forEach { log ->
                        NotificationMemberRowView(
                            log = log,
                            now = now,
                            isSelected = log.id in selectedIds,
                            onSelectionChange = onSelectionChange,
                            onActivate = onActivate,
                            onArchive = onArchive,
                            onUnarchive = onUnarchive,
                            onMarkRead = onMarkRead,
                            onMarkUnread = onMarkUnread,
                            archived = archived,
                            strings = strings,
                        )
                    }
            }
        }
    }
}

/** The members loading row — a small spinner + the "Loading thread members…" status (web `role="status"`). */
@Composable
private fun MembersLoading(label: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.sm)
                .semantics(mergeDescendants = true) {
                    contentDescription = label
                    liveRegion = LiveRegionMode.Polite
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(INLINE_SPINNER_SIZE),
            strokeWidth = INLINE_SPINNER_STROKE,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HelperText(label)
    }
}

/** The members error row — the inline failure text plus a retry affordance (web text + the P3 retry mandate). */
@Composable
private fun MembersError(
    message: String,
    onRetry: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.xs)
                .semantics(mergeDescendants = true) {
                    contentDescription = message
                    liveRegion = LiveRegionMode.Assertive
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Text(
            text = message,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall,
            color = TeslaTokens.status.danger,
        )
        Button(
            label = stringResourceRetry(),
            onClick = onRetry,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/** The stale / refreshing / offline freshness chip, right-aligned above the member rows. */
@Composable
private fun MembersFreshnessRow(membersState: UiState<List<NotificationLog>>) {
    val formatAge = rememberNotificationFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = membersState.fetchedAt?.takeIf { it > 0 },
            isFetching = membersState.refreshing,
            isStale = membersState.stale,
            isError = membersState.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * One notification row — the inline render of the web child `NotificationRow` (its dedicated surface is sibling
 * A-0191, built after this one). Shows the selection checkbox, an unread severity dot, the title (dimmed when
 * read, web `text-secondary`) + message, the relative age, and the mark-read/unread + archive/restore actions —
 * each carrying a TalkBack label. The whole content opens the row (web `onActivate`).
 */
@Composable
private fun NotificationMemberRowView(
    log: NotificationLog,
    now: Long,
    isSelected: Boolean,
    onSelectionChange: (Long, Boolean) -> Unit,
    onActivate: (NotificationLog) -> Unit,
    onArchive: (Long) -> Unit,
    onUnarchive: (Long) -> Unit,
    onMarkRead: (Long) -> Unit,
    onMarkUnread: (Long) -> Unit,
    archived: Boolean,
    strings: NotificationGroupRowStrings,
    modifier: Modifier = Modifier,
) {
    val row = remember(log, now) { NotificationGroupRowProjection.memberRow(log, now) }
    val formatAge = rememberNotificationFreshnessFormatter()
    val ageText = formatAge(row.age)
    val titleColor = if (row.isRead) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Checkbox(
            checked = isSelected,
            onCheckedChange = { onSelectionChange(row.id, it) },
            modifier = Modifier.semantics { contentDescription = strings.rowSelect },
        )
        if (!row.isRead) {
            StatusDot(severity = row.severity, label = strings.unread)
        }
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(Radius.sm))
                    .clickable { onActivate(log) }
                    .padding(vertical = Spacing.xs)
                    .semantics(mergeDescendants = true) { role = Role.Button },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(row.title, color = titleColor, maxLines = 1)
            if (row.message.isNotBlank()) {
                BodyText(row.message, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        HelperText(ageText)
        ReadToggle(row = row, onMarkRead = onMarkRead, onMarkUnread = onMarkUnread, strings = strings)
        ArchiveToggle(id = row.id, archived = archived, onArchive = onArchive, onUnarchive = onUnarchive, strings = strings)
    }
}

/** The per-row read toggle: an open envelope to mark an unread row read, a closed one to mark a read row unread. */
@Composable
private fun ReadToggle(
    row: NotificationMemberRow,
    onMarkRead: (Long) -> Unit,
    onMarkUnread: (Long) -> Unit,
    strings: NotificationGroupRowStrings,
) {
    if (row.isRead) {
        IconButton(
            imageVector = NotificationGroupRowGlyphs.Mail,
            contentDescription = strings.rowMarkUnread,
            onClick = { onMarkUnread(row.id) },
            size = IconSize.Md,
        )
    } else {
        IconButton(
            imageVector = NotificationGroupRowGlyphs.MailOpen,
            contentDescription = strings.rowMarkRead,
            onClick = { onMarkRead(row.id) },
            size = IconSize.Md,
        )
    }
}

/** The per-row archive toggle: an archive box in the active inbox, a restore box in archived mode. */
@Composable
private fun ArchiveToggle(
    id: Long,
    archived: Boolean,
    onArchive: (Long) -> Unit,
    onUnarchive: (Long) -> Unit,
    strings: NotificationGroupRowStrings,
) {
    if (archived) {
        IconButton(
            imageVector = NotificationGroupRowGlyphs.ArchiveRestore,
            contentDescription = strings.rowUnarchive,
            onClick = { onUnarchive(id) },
            size = IconSize.Md,
        )
    } else {
        IconButton(
            imageVector = NotificationGroupRowGlyphs.Archive,
            contentDescription = strings.rowArchive,
            onClick = { onArchive(id) },
            size = IconSize.Md,
        )
    }
}

// ── i18n facade (P1/S10) ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [NotificationGroupRowStrings] from the i18n catalog (P1/S10): the `notifications.group.*`
 * fixed-text labels the web component reads plus the per-row action / `Unread` accessibility names. The plural
 * labels (expand toggle, "+N similar", "N vehicles affected") are resolved inline at their call sites.
 */
@Composable
private fun rememberNotificationGroupRowStrings(): NotificationGroupRowStrings {
    val collapse = stringResource(R.string.translation_notifications_group_collapse)
    val loadingMembers = stringResource(R.string.translation_notifications_group_loadingMembers)
    val membersError = stringResource(R.string.translation_notifications_group_membersError)
    val noMembers = stringResource(R.string.translation_notifications_group_noMembers)
    val markGroupRead = stringResource(R.string.translation_notifications_group_markRead)
    val unread = stringResource(R.string.translation_Unread)
    val rowSelect = stringResource(R.string.translation_notifications_inbox_row_select)
    val rowMarkRead = stringResource(R.string.translation_notifications_inbox_row_markRead)
    val rowMarkUnread = stringResource(R.string.translation_notifications_inbox_row_markUnread)
    val rowArchive = stringResource(R.string.translation_notifications_inbox_row_archive)
    val rowUnarchive = stringResource(R.string.translation_notifications_inbox_row_unarchive)
    return remember(collapse, loadingMembers, membersError, noMembers, markGroupRead, unread) {
        NotificationGroupRowStrings(
            collapse = collapse,
            loadingMembers = loadingMembers,
            membersError = membersError,
            noMembers = noMembers,
            markGroupRead = markGroupRead,
            unread = unread,
            rowSelect = rowSelect,
            rowMarkRead = rowMarkRead,
            rowMarkUnread = rowMarkUnread,
            rowArchive = rowArchive,
            rowUnarchive = rowUnarchive,
        )
    }
}

/** Localized formatter for a [FreshnessAge] bucket — reuses the `translation_freshness_*` catalog strings. */
@Composable
private fun rememberNotificationFreshnessFormatter(): (FreshnessAge) -> String {
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

@Composable
private fun stringResourceRetry(): String = stringResource(R.string.translation_common_retry)

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

private fun previewLog(
    id: Long,
    title: String,
    read: Boolean,
): NotificationLog =
    NotificationLog(
        id = id,
        title = title,
        message = "State of charge dropped below the configured threshold.",
        severity = "warning",
        createdAt = "2026-06-12T11:30:00Z",
        readAt = if (read) "2026-06-12T11:45:00Z" else null,
    )

private fun previewGroup(): NotificationLogGroup =
    NotificationLogGroup(
        groupKey = "low_battery:warning",
        latest = previewLog(10, "Battery low — Model 3", read = false),
        count = 4,
        unreadCount = 3,
        vehicleIds = listOf(1, 2),
    )

private fun previewMembers(): List<NotificationLog> =
    listOf(
        previewLog(10, "Battery low — Model 3", read = false),
        previewLog(9, "Battery low — Model Y", read = false),
        previewLog(8, "Battery low — Model 3", read = true),
    )

private object PreviewLogger : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}

private class PreviewSource(
    private val emission: Resource<List<NotificationLog>>,
) : NotificationGroupRowSource {
    override fun groupMembers(
        groupKey: String,
        filters: NotificationFilters,
    ): Flow<Resource<List<NotificationLog>>> = flowOf(emission)

    override suspend fun markGroupRead(groupKey: String): Result<UpdatedCountResult> = Result.success(UpdatedCountResult(3))
}

@Preview(name = "Collapsed thread", showBackground = true)
@Composable
private fun NotificationGroupRowCollapsedPreview() {
    TeslaSyncTheme {
        NotificationGroupRowContent(
            group = previewGroup(),
            membersState = UiState(UiPhase.Empty, emptyList()),
            expanded = false,
            markPending = false,
            onToggleExpand = {},
            onMarkGroupRead = {},
            onRetryMembers = {},
            nowMillis = 1_749_727_800_000L,
        )
    }
}

@Preview(name = "Expanded — members", showBackground = true)
@Composable
private fun NotificationGroupRowExpandedPreview() {
    TeslaSyncTheme {
        NotificationGroupRowContent(
            group = previewGroup(),
            membersState = UiState(UiPhase.Content, previewMembers(), fetchedAt = 1_749_727_700_000L),
            expanded = true,
            markPending = false,
            onToggleExpand = {},
            onMarkGroupRead = {},
            onRetryMembers = {},
            nowMillis = 1_749_727_800_000L,
        )
    }
}

@Preview(name = "Expanded — loading", showBackground = true)
@Composable
private fun NotificationGroupRowLoadingPreview() {
    TeslaSyncTheme {
        NotificationGroupRowContent(
            group = previewGroup(),
            membersState = UiState.loading(),
            expanded = true,
            markPending = false,
            onToggleExpand = {},
            onMarkGroupRead = {},
            onRetryMembers = {},
            nowMillis = 1_749_727_800_000L,
        )
    }
}

@Preview(name = "Stateful (fake source)", showBackground = true)
@Composable
private fun NotificationGroupRowStatefulPreview() {
    TeslaSyncTheme {
        NotificationGroupRow(
            group = previewGroup(),
            source = PreviewSource(Resource.Success(previewMembers(), 1_749_727_700_000L, false)),
            logger = PreviewLogger,
        )
    }
}
