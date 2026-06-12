// The native Jetpack Compose + Material 3 SessionList feature view — a parity port of
// web/src/features/system/components/chatbot/SessionList.tsx. The web component is the chatbot sidebar: a
// always-visible "New Chat" button, a "Sessions" section label, and a scrollable list of past conversations.
// Each row shows the conversation's title (an explicit rename, else its first message truncated, else
// "Untitled"), a relative "last activity" timestamp (or "Empty"), and the message count; the active row gets a
// highlighted surface. The web row is double-clicked to rename inline (Enter saves, Esc cancels, blur saves) and
// carries a delete affordance that opens a ConfirmDialog before mutating.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the i18n catalog); the host owns the sessions feed (the shared
// ChatStore, P1/S8) and wires the select / new-chat / rename / delete actions through [SessionListActions],
// exactly like the web callbacks. Because the surface acceptance gate requires every lifecycle state to render,
// the stateful entry takes the host's cache-then-network [UiState] and draws each state the shared state-holder
// layer can carry — a loading skeleton, a hard error with retry, a friendly empty state, the loaded list, and
// stale/offline ("last known") with a freshness chip + auto-refresh — without ever fetching. The "New Chat"
// button and "Sessions" label stay visible in every state, mirroring the web layout. A web-parity overload
// taking the raw `sessions` + `isLoading` props is provided for hosts that already hold a loaded list.
//
// Native idiom: the web double-click-to-rename maps to a long-press (the platform inline-edit gesture); its
// accessibility action carries the localized "rename" hint. The MessageSquare empty-state icon and the Trash2
// delete glyph the shared icon libraries do not provide are authored here as 24×24 stroked vectors in the shared
// monochrome style, since a feature view may not expand the shared icon library from a surface prompt
// (allowed-files) — exactly as the sibling surfaces do.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SessionList — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessionlist

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import java.time.ZoneId
import java.util.Locale

/** Sidebar width — the web `w-72` (18rem). Applied as a default; a caller [Modifier] can override it. */
private val SESSION_LIST_WIDTH: Dp = 288.dp

/** Compact icon size for the per-row delete affordance — the web `h-3.5 w-3.5` trash button. */
private val DELETE_ICON_SIZE: IconSize = IconSize.Sm

/** The web `' · '` separator between the relative time and the message count. */
private const val META_SEPARATOR: String = " \u00B7 "

/** Active-row accent — the web `border-purple-500/30`, mapped to the primary token at a soft alpha. */
private const val ACTIVE_BORDER_ALPHA: Float = 0.3f
private val ACTIVE_BORDER_WIDTH: Dp = 1.dp

/** Loading-skeleton geometry, sized so the list never first-paints as a blank box. */
private const val SKELETON_ROW_COUNT: Int = 4
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_META_HEIGHT: Dp = 10.dp
private const val SKELETON_TITLE_FRACTION: Float = 0.7f
private const val SKELETON_META_FRACTION: Float = 0.45f

/**
 * The host-supplied actions for the sidebar — the native analogue of the web component's callback props. All
 * default to no-ops so previews and the loading / empty / error states (which render no row) need not supply
 * them.
 *
 * @property onSelect opens a session — the web row `onClick` → `onSelect(id)`.
 * @property onNewChat starts a fresh conversation — the web "New Chat" button `onNewChat`.
 * @property onRename persists a renamed session — the web inline-edit `onRename(id, title)` (non-blank only).
 * @property onDelete deletes a session after confirmation — the web `onDelete(id)` from the ConfirmDialog.
 */
data class SessionListActions(
    val onSelect: (String) -> Unit = {},
    val onNewChat: () -> Unit = {},
    val onRename: (String, String) -> Unit = { _, _ -> },
    val onDelete: (String) -> Unit = {},
)

/**
 * Localized microcopy the sidebar folds in (P1/S10) — the web `t('chatbot.*')` / `t('common.*')` keys. Resolved
 * once at the Compose boundary and handed to the stateless body so the relative-time + plural strings remain the
 * only inline resolutions.
 */
data class SessionListStrings(
    val newChat: String,
    val sessions: String,
    val noSessions: String,
    val empty: String,
    val untitled: String,
    val renameLabel: String,
    val renameHint: String,
    val deleteLabel: String,
    val loading: String,
    val deleteTitle: String,
    val deleteMessage: String,
    val deleteConfirm: String,
    val cancel: String,
)

/**
 * Stateful entry point for the chatbot session sidebar. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared sessions feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`) plus the [actions]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the session list.
 * @param activeSessionId the currently-open session — its row is highlighted (web `activeSessionId`).
 * @param actions the sidebar callbacks — wired by the host to selection / navigation / mutations.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SessionList(
    state: UiState<List<ChatSessionInfo>>,
    activeSessionId: String,
    actions: SessionListActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SessionListDiagnostics.recordViewOpened(logger) }
    SessionListContent(
        state = state,
        activeSessionId = activeSessionId,
        actions = actions,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's `sessions` + `isLoading` props, for hosts that already hold a
 * loaded list. Wraps the inputs in a phase-appropriate [UiState] (content when non-empty, else loading or empty)
 * and renders the sidebar — no fetch sits behind it, so it offers no retry. Records `view.opened` like the
 * stateful entry.
 */
@Composable
fun SessionList(
    sessions: List<ChatSessionInfo>,
    activeSessionId: String,
    actions: SessionListActions,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(sessions, isLoading) {
            when {
                sessions.isNotEmpty() -> UiState(phase = UiPhase.Content, data = sessions)
                isLoading -> UiState(phase = UiPhase.Loading, data = emptyList())
                else -> UiState(phase = UiPhase.Empty, data = emptyList())
            }
        }
    SessionList(
        state = state,
        activeSessionId = activeSessionId,
        actions = actions,
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. The "New Chat" button and the
 * "Sessions" label render in every state (the web layout). The list region switches between the loading
 * skeleton, the hard-error retry surface, the friendly empty state, and the loaded rows; a freshness chip
 * reflects refreshing / stale / offline, and stale (non-error) data auto-refreshes. [nowMillis] / [zoneId] fix
 * the clock for tests; production callers use the device clock and zone.
 */
@Composable
fun SessionListContent(
    state: UiState<List<ChatSessionInfo>>,
    activeSessionId: String,
    actions: SessionListActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: SessionListStrings = rememberSessionListStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val sessions = state.data ?: emptyList()
    var renamingId by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<ChatSessionInfo?>(null) }

    GlassPanel(modifier = Modifier.width(SESSION_LIST_WIDTH).then(modifier), padding = PanelPadding.None) {
        SessionListHeader(onNewChat = actions.onNewChat, newChatLabel = strings.newChat)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Caption(
            strings.sessions,
            modifier = Modifier.padding(start = Spacing.md, end = Spacing.md, top = Spacing.sm, bottom = Spacing.xs),
        )
        if (state.stale || state.refreshing || state.hasError) {
            SessionListFreshnessRow(state = state)
        }
        when {
            state.isError && sessions.isEmpty() -> SessionListError(onRetry = onRetry)
            state.isLoading && sessions.isEmpty() -> SessionListLoading(loadingLabel = strings.loading)
            sessions.isEmpty() -> SessionListEmpty(message = strings.noSessions)
            else ->
                SessionRows(
                    sessions = sessions,
                    activeSessionId = activeSessionId,
                    renamingId = renamingId,
                    strings = strings,
                    nowMillis = nowMillis,
                    zoneId = zoneId,
                    onSelect = actions.onSelect,
                    onStartRename = { renamingId = it },
                    onCommitRename = { id, draft ->
                        val trimmed = draft.trim()
                        if (trimmed.isNotEmpty()) actions.onRename(id, trimmed)
                        renamingId = null
                    },
                    onCancelRename = { renamingId = null },
                    onRequestDelete = { pendingDelete = it },
                )
        }
    }

    pendingDelete?.let { session ->
        ConfirmDialog(
            title = strings.deleteTitle,
            message = strings.deleteMessage,
            confirmLabel = strings.deleteConfirm,
            cancelLabel = strings.cancel,
            severity = ConfirmSeverity.Danger,
            onConfirm = {
                actions.onDelete(session.id)
                pendingDelete = null
            },
            onCancel = { pendingDelete = null },
        )
    }
}

/** The always-visible "New Chat" primary button — the web top-of-sidebar action. */
@Composable
private fun SessionListHeader(
    onNewChat: () -> Unit,
    newChatLabel: String,
) {
    Box(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
        Button(
            label = newChatLabel,
            onClick = onNewChat,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.Plus,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The list of session rows — the web `sessions.map(...)`, keyed by id so rename/selection state stays put. */
@Composable
private fun SessionRows(
    sessions: List<ChatSessionInfo>,
    activeSessionId: String,
    renamingId: String?,
    strings: SessionListStrings,
    nowMillis: Long,
    zoneId: ZoneId,
    onSelect: (String) -> Unit,
    onStartRename: (String) -> Unit,
    onCommitRename: (String, String) -> Unit,
    onCancelRename: () -> Unit,
    onRequestDelete: (ChatSessionInfo) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        sessions.forEach { session ->
            key(session.id) {
                val row = remember(session) { SessionListProjection.project(session) }
                SessionRow(
                    row = row,
                    isActive = session.id == activeSessionId,
                    isRenaming = session.id == renamingId,
                    initialRenameDraft = row.title ?: strings.untitled,
                    strings = strings,
                    nowMillis = nowMillis,
                    zoneId = zoneId,
                    onSelect = { onSelect(session.id) },
                    onStartRename = { onStartRename(session.id) },
                    onCommitRename = { draft -> onCommitRename(session.id, draft) },
                    onCancelRename = onCancelRename,
                    onRequestDelete = { onRequestDelete(session) },
                )
            }
        }
    }
}

/**
 * One session row — the faithful render of the web row. Tapping the body opens the session; long-pressing it
 * starts an inline rename (the native analogue of the web double-click). The trailing trash button requests
 * deletion. The active row gets a tinted, outlined surface and a primary-colored title.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SessionRow(
    row: SessionRowData,
    isActive: Boolean,
    isRenaming: Boolean,
    initialRenameDraft: String,
    strings: SessionListStrings,
    nowMillis: Long,
    zoneId: ZoneId,
    onSelect: () -> Unit,
    onStartRename: () -> Unit,
    onCommitRename: (String) -> Unit,
    onCancelRename: () -> Unit,
    onRequestDelete: () -> Unit,
) {
    val shape = MaterialTheme.shapes.medium
    val container =
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .then(if (isActive) Modifier.background(MaterialTheme.colorScheme.surfaceVariant) else Modifier)
            .then(
                if (isActive) {
                    Modifier.border(
                        BorderStroke(ACTIVE_BORDER_WIDTH, MaterialTheme.colorScheme.primary.copy(alpha = ACTIVE_BORDER_ALPHA)),
                        shape,
                    )
                } else {
                    Modifier
                },
            )

    Box(modifier = container) {
        if (isRenaming) {
            SessionRenameField(
                initialValue = initialRenameDraft,
                onCommit = onCommitRename,
                onCancel = onCancelRename,
                label = strings.renameLabel,
                modifier = Modifier.padding(Spacing.sm),
            )
        } else {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(
                    modifier =
                        Modifier
                            .weight(1f)
                            .combinedClickable(
                                onClick = onSelect,
                                onLongClick = onStartRename,
                                onLongClickLabel = strings.renameHint,
                            ).semantics { selected = isActive }
                            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    BodyText(
                        text = row.title ?: strings.untitled,
                        color = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                    )
                    Caption(sessionMetaLabel(row = row, strings = strings, nowMillis = nowMillis, zoneId = zoneId))
                }
                IconButton(
                    imageVector = Trash2Glyph,
                    contentDescription = strings.deleteLabel,
                    onClick = onRequestDelete,
                    size = DELETE_ICON_SIZE,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * The inline rename editor — the web double-click → focused input. Auto-focuses, commits on Enter or focus-loss
 * (the web blur), and cancels on Escape; the commit/cancel is settled once so a key action and the trailing blur
 * never both fire. The localized rename label is exposed for TalkBack.
 */
@Composable
private fun SessionRenameField(
    initialValue: String,
    onCommit: (String) -> Unit,
    onCancel: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    var draft by remember { mutableStateOf(initialValue) }
    var settled by remember { mutableStateOf(false) }
    var hasFocused by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }

    val commit = {
        if (!settled) {
            settled = true
            onCommit(draft)
        }
    }
    val cancel = {
        if (!settled) {
            settled = true
            onCancel()
        }
    }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Input(
        value = draft,
        onValueChange = { draft = it },
        modifier =
            modifier
                .focusRequester(focusRequester)
                .onFocusChanged { focusState ->
                    if (focusState.isFocused) {
                        hasFocused = true
                    } else if (hasFocused) {
                        commit()
                    }
                }.onPreviewKeyEvent { event -> handleRenameKey(event, commit, cancel) }
                .semantics { contentDescription = label },
    )
}

/** The first-load skeleton — title/meta shimmer rows so the list is never blank while loading. */
@Composable
private fun SessionListLoading(loadingLabel: String) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.sm, vertical = Spacing.sm)
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_ROW_COUNT) {
            Column(
                modifier = Modifier.padding(horizontal = Spacing.md),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
                Skeleton(widthFraction = SKELETON_META_FRACTION, height = SKELETON_META_HEIGHT)
            }
        }
    }
}

/** The empty surface — a friendly state shown when the user has no conversations, never a blank box. */
@Composable
private fun SessionListEmpty(message: String) {
    EmptyState(
        message = message,
        icon = MessageSquareGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SessionListError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned beneath the "Sessions" label. */
@Composable
private fun SessionListFreshnessRow(state: UiState<List<ChatSessionInfo>>) {
    val formatAge = rememberSessionListFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.xs),
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

/**
 * Builds the row's meta line — the web `{formatRelative(last_message_at) ?? 'Empty'} · {{count}} msgs`. The
 * relative label reuses the shared `freshness.*` catalog; a one-week-or-older timestamp renders an absolute
 * date; an absent timestamp renders "Empty" and a present-but-unparseable one renders an em dash.
 */
@Composable
private fun sessionMetaLabel(
    row: SessionRowData,
    strings: SessionListStrings,
    nowMillis: Long,
    zoneId: ZoneId,
): String {
    val timePart =
        if (!row.hasLastMessageAt) {
            strings.empty
        } else {
            when (val age = SessionListProjection.relativeAge(row.lastMessageAt, nowMillis)) {
                null -> EM_DASH
                SessionRelativeAge.JustNow -> stringResource(R.string.translation_freshness_justNow)
                is SessionRelativeAge.Minutes -> stringResource(R.string.translation_freshness_minutes).format(age.value)
                is SessionRelativeAge.Hours -> stringResource(R.string.translation_freshness_hours).format(age.value)
                is SessionRelativeAge.Days -> stringResource(R.string.translation_freshness_days).format(age.value)
                is SessionRelativeAge.Absolute ->
                    SessionListProjection.formatAbsolute(age.instant, zoneId, Locale.getDefault())
            }
        }
    val countPart =
        pluralStringResource(R.plurals.translation_chatbot_session_messageCount, row.messageCount, row.messageCount)
    return "$timePart$META_SEPARATOR$countPart"
}

// ── i18n facade (P1/S10) ──────────────────────────────────────────────────────────────────────────────────

/** Resolves the sidebar's localized microcopy from the i18n catalog (P1/S10). */
@Composable
private fun rememberSessionListStrings(): SessionListStrings {
    val newChat = stringResource(R.string.translation_chatbot_newChat)
    val sessions = stringResource(R.string.translation_chatbot_sessions)
    val noSessions = stringResource(R.string.translation_chatbot_noSessions)
    val empty = stringResource(R.string.translation_chatbot_session_empty)
    val untitled = stringResource(R.string.translation_chatbot_session_untitled)
    val renameLabel = stringResource(R.string.translation_chatbot_aria_renameSession)
    val renameHint = stringResource(R.string.translation_chatbot_aria_doubleClickRename)
    val deleteLabel = stringResource(R.string.translation_chatbot_aria_deleteSession)
    val loading = stringResource(R.string.translation_common_loading)
    val deleteTitle = stringResource(R.string.translation_chatbot_delete_title)
    val deleteMessage = stringResource(R.string.translation_chatbot_delete_message)
    val deleteConfirm = stringResource(R.string.translation_chatbot_delete_confirm)
    val cancel = stringResource(R.string.translation_common_cancel)
    return remember(
        newChat,
        sessions,
        noSessions,
        empty,
        untitled,
        renameLabel,
        renameHint,
        deleteLabel,
        loading,
        deleteTitle,
        deleteMessage,
        deleteConfirm,
        cancel,
    ) {
        SessionListStrings(
            newChat = newChat,
            sessions = sessions,
            noSessions = noSessions,
            empty = empty,
            untitled = untitled,
            renameLabel = renameLabel,
            renameHint = renameHint,
            deleteLabel = deleteLabel,
            loading = loading,
            deleteTitle = deleteTitle,
            deleteMessage = deleteMessage,
            deleteConfirm = deleteConfirm,
            cancel = cancel,
        )
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern the siblings resolve. */
@Composable
private fun rememberSessionListFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Maps an [event] to commit (Enter) / cancel (Escape) for the inline rename field; ignores other key downs. */
private fun handleRenameKey(
    event: KeyEvent,
    onCommit: () -> Unit,
    onCancel: () -> Unit,
): Boolean {
    if (event.type != KeyEventType.KeyDown) return false
    return when (event.key) {
        Key.Enter, Key.NumPadEnter -> {
            onCommit()
            true
        }
        Key.Escape -> {
            onCancel()
            true
        }
        else -> false
    }
}

// ── Local Lucide glyphs ───────────────────────────────────────────────────────────────────────────────────
// The two web glyphs the shared icon libraries do not provide, authored as 24×24 round-capped stroked vectors in
// the shared monochrome style and recolored at render time by the `Icon`/`IconButton` tint.

/** Web `MessageSquare` (lucide) — a speech bubble with a bottom-left tail. The empty-state icon. */
private val MessageSquareGlyph: ImageVector =
    strokedGlyph("MessageSquare") {
        moveTo(4f, 4f)
        lineTo(20f, 4f)
        lineTo(20f, 16f)
        lineTo(8f, 16f)
        lineTo(4f, 20f)
        close()
    }

/** Web `Trash2` (lucide) — a lidded trash can with a handle and two ribs. The per-row delete affordance. */
private val Trash2Glyph: ImageVector =
    strokedGlyph("Trash2") {
        moveTo(3f, 6f)
        lineTo(21f, 6f)
        moveTo(8f, 6f)
        lineTo(8f, 4f)
        lineTo(16f, 4f)
        lineTo(16f, 6f)
        moveTo(5f, 6f)
        lineTo(6f, 21f)
        lineTo(18f, 21f)
        lineTo(19f, 6f)
        moveTo(10f, 10f)
        lineTo(10f, 18f)
        moveTo(14f, 10f)
        lineTo(14f, 18f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

private fun previewSessions(): List<ChatSessionInfo> =
    listOf(
        ChatSessionInfo(
            id = "s1",
            title = "Charging cost last 30 days",
            firstMessage = "What did my fleet cost to charge?",
            messageCount = 8,
            lastMessageAt = "2026-04-04T14:30:00Z",
        ),
        ChatSessionInfo(
            id = "s2",
            title = null,
            firstMessage = "Why is my SoC dropping faster this week than the previous one across both cars?",
            messageCount = 3,
            lastMessageAt = "2026-06-12T09:00:00Z",
        ),
        ChatSessionInfo(
            id = "s3",
            title = null,
            firstMessage = null,
            messageCount = 0,
            lastMessageAt = null,
        ),
    )

@Preview(showBackground = true)
@Composable
private fun SessionListContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionListContent(
            state = UiState(phase = UiPhase.Content, data = previewSessions()),
            activeSessionId = "s1",
            actions = SessionListActions(),
            onRetry = {},
            nowMillis = 0L,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SessionListEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionListContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            activeSessionId = "",
            actions = SessionListActions(),
            onRetry = {},
            nowMillis = 0L,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SessionListLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionListContent(
            state = UiState(phase = UiPhase.Loading, data = emptyList()),
            activeSessionId = "",
            actions = SessionListActions(),
            onRetry = {},
            nowMillis = 0L,
            zoneId = ZoneId.of("UTC"),
        )
    }
}
