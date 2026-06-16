// The native Jetpack Compose + Material 3 ChatbotPage system surface — a parity port of
// web/src/features/system/pages/ChatbotPage.tsx, the Helix AI-assistant chat screen. It reproduces the web
// page's PageContainer chrome (the "Helix" title, the descriptive subtitle, and the History toggle action) and
// its two GlassPanels: GlassPanel1 — the conversation panel holding the message log (hero / loading / content)
// and the bottom input row (the Textarea + the Send⁄Stop affordance) — and GlassPanel2 — the "Helix is thinking…"
// indicator shown while a reply is pending. The History action reveals the shared A3 SessionList (the sidebar
// feed + its select / new-chat / rename / delete actions) as a start-aligned overlay, mirroring the web mobile
// History dialog.
//
// Composition mirrors the sibling A7 pages: [ChatbotPage] is the stateful entry (constructs the view-model over
// the host-wired source, records the one-shot `view.opened` diagnostic, collects the two state holders, builds
// the [ChatbotPageActions]); [ChatbotPageContent] is the stateless render layer driven entirely by the bound
// state + actions, owning only the transient input text + sidebar-visibility view state. Every visible string
// resolves from the generated res/values catalog (ADR-014); all derivation lives in the framework-free model
// (ChatbotPageModel.kt) and the data states are projected by the view-model (ChatbotPageViewModel.kt), so this
// file only resolves i18n + lays out the panels.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located actions DTO + private composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.Avatar
import io.teslasync.android.components.datadisplay.AvatarKind
import io.teslasync.android.components.datadisplay.AvatarShape
import io.teslasync.android.components.datadisplay.AvatarSize
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.chatmessageitem.ChatMessageItem
import io.teslasync.android.featureviews.chatmessageitem.ChatMessageItemActions
import io.teslasync.android.featureviews.chatmessageitem.ChatRole
import io.teslasync.android.featureviews.chatmessageitem.UIChatMessage
import io.teslasync.android.featureviews.sessionlist.SessionList
import io.teslasync.android.featureviews.sessionlist.SessionListActions
import io.teslasync.android.featureviews.suggestedprompts.SuggestedPrompts
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo

/** The page's interaction callbacks, wired to the [ChatbotPageViewModel] (web event handlers + the chat mutations). */
data class ChatbotPageActions(
    val onSubmit: (String) -> Unit,
    val onStop: () -> Unit,
    val onRegenerate: (UIChatMessage) -> Unit,
    val onEditAndResend: (UIChatMessage, String) -> Unit,
    val onSelectSession: (String) -> Unit,
    val onNewChat: () -> Unit,
    val onRenameSession: (String, String) -> Unit,
    val onDeleteSession: (String) -> Unit,
    val onRefreshSessions: () -> Unit,
    val onRetryHistory: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ChatbotPageViewModel] over the supplied [source] (the host wires the shared
 * chat repository via [chatbotPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun ChatbotPage(
    source: ChatbotPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ChatbotPageViewModel =
        viewModel(
            key = ChatbotPageRegistration.SLUG,
            factory = viewModelFactory { initializer { ChatbotPageViewModel(source, logger) } },
        )
    ChatbotPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: binds the [viewModel] state holders to the stateless content, records the one-shot diagnostic,
 * and assembles the [ChatbotPageActions] from the view-model's callbacks.
 */
@Composable
fun ChatbotPage(
    viewModel: ChatbotPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val sessions by viewModel.sessionsState.collectAsStateWithLifecycle()
    val conversation by viewModel.conversation.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            ChatbotPageActions(
                onSubmit = viewModel::submit,
                onStop = viewModel::stopStreaming,
                onRegenerate = viewModel::regenerate,
                onEditAndResend = viewModel::editAndResend,
                onSelectSession = viewModel::loadSession,
                onNewChat = viewModel::startNewSession,
                onRenameSession = viewModel::rename,
                onDeleteSession = viewModel::delete,
                onRefreshSessions = viewModel::refreshSessions,
                onRetryHistory = viewModel::retryHistory,
            )
        }

    ChatbotPageContent(sessions = sessions, conversation = conversation, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header (title + subtitle + History toggle) above GlassPanel1 (the conversation +
 * input), with the SessionList sidebar revealed as a start-aligned overlay when History is open. Owns only the
 * transient input text + sidebar-visibility view state; every data surface comes from the bound state holders.
 */
@Composable
fun ChatbotPageContent(
    sessions: UiState<List<ChatSessionInfo>>,
    conversation: ChatbotConversation,
    actions: ChatbotPageActions,
    modifier: Modifier = Modifier,
) {
    var input by rememberSaveable { mutableStateOf("") }
    var showSessions by rememberSaveable { mutableStateOf(false) }

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            ChatbotHeader(showSessions = showSessions, onToggleSessions = { showSessions = !showSessions })
            ConversationPanel(
                conversation = conversation,
                input = input,
                onInputChange = { input = it },
                onSend = {
                    actions.onSubmit(input)
                    input = ""
                },
                onStop = actions.onStop,
                actions = actions,
                onPickSuggestion = { input = it },
                onRetryHistory = actions.onRetryHistory,
                modifier = Modifier.fillMaxWidth().weight(1f),
            )
        }

        if (showSessions) {
            SessionOverlay(
                sessions = sessions,
                activeSessionId = conversation.sessionId,
                actions = actions,
                onDismiss = { showSessions = false },
            )
        }
    }
}

/**
 * The page header — the web `PageContainer` props for this route: the [PageTitle] heading ("Helix"), the
 * descriptive subtitle, and the History toggle action whose pressed state mirrors the web `aria-pressed`.
 */
@Composable
private fun ChatbotHeader(
    showSessions: Boolean,
    onToggleSessions: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_chatbot_title))
            BodyText(
                text = stringResource(R.string.translation_chatbot_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            label = stringResource(R.string.translation_chatbot_history),
            onClick = onToggleSessions,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = ChatbotPageGlyphs.History,
            modifier = Modifier.semantics { selected = showSessions },
        )
    }
}

/**
 * GlassPanel1 — the conversation panel: the message-log region (hero / spinner / retry / list) above a divider
 * and the bottom input row. Rendered with no panel padding (web `!p-0`) so the log + input own their insets.
 */
@Composable
private fun ConversationPanel(
    conversation: ChatbotConversation,
    input: String,
    onInputChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    actions: ChatbotPageActions,
    onPickSuggestion: (String) -> Unit,
    onRetryHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        ConversationLog(
            conversation = conversation,
            actions = actions,
            onPickSuggestion = onPickSuggestion,
            onRetryHistory = onRetryHistory,
            modifier = Modifier.fillMaxWidth().weight(1f),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        ChatInputRow(
            input = input,
            onInputChange = onInputChange,
            isStreaming = conversation.isStreaming,
            isWaiting = conversation.isWaiting,
            onSend = onSend,
            onStop = onStop,
        )
    }
}

/**
 * The scrollable conversation log — an ARIA-live region (web `role="log" aria-live="polite"`). Renders, per the
 * bound conversation phase: a centered spinner (loading), the Helix hero + suggested prompts (idle/empty), a
 * retry surface (hard error), or the message list (content).
 */
@Composable
private fun ConversationLog(
    conversation: ChatbotConversation,
    actions: ChatbotPageActions,
    onPickSuggestion: (String) -> Unit,
    onRetryHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val conversationLabel = stringResource(R.string.translation_chatbot_aria_conversation)
    Box(
        modifier =
            modifier.semantics {
                contentDescription = conversationLabel
                liveRegion = LiveRegionMode.Polite
            },
    ) {
        when (conversation.phase) {
            ConversationPhase.Loading ->
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Spinner() }

            ConversationPhase.Error ->
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    QueryError(kind = toQueryErrorKind(conversation.errorKind), onRetry = onRetryHistory)
                }

            ConversationPhase.Idle ->
                Box(
                    modifier = Modifier.fillMaxSize().padding(Spacing.lg),
                    contentAlignment = Alignment.Center,
                ) { ChatHero(onPick = onPickSuggestion) }

            ConversationPhase.Content ->
                MessageList(conversation = conversation, actions = actions)
        }
    }
}

/**
 * The empty-conversation hero (web `messages.length === 0` branch): the Helix mark, the "How can Helix help
 * you?" prompt, the "Ask about…" subtitle, and the suggested-prompt chip strip whose taps fill the input.
 */
@Composable
private fun ChatHero(onPick: (String) -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Avatar(kind = AvatarKind.Bot, size = AvatarSize.Lg, shape = AvatarShape.Rounded, contentDescription = null)
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            SectionTitle(stringResource(R.string.translation_chatbot_howCanIHelp))
            BodyText(
                text = stringResource(R.string.translation_chatbot_askAbout),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        SuggestedPrompts(onPick = onPick)
    }
}

/**
 * The loaded conversation — the per-row [ChatMessageItem]s plus the trailing "thinking" indicator (GlassPanel2)
 * while a reply is pending. Computes the same grouping + last-of-role gates the web page passes each row, and
 * auto-scrolls to the newest content as messages arrive and the reveal grows.
 */
@Composable
private fun MessageList(
    conversation: ChatbotConversation,
    actions: ChatbotPageActions,
) {
    val messages = conversation.messages
    val listState = rememberLazyListState()
    val lastAssistantId = remember(messages) { messages.lastOrNull { it.role == ChatRole.Assistant }?.id }
    val lastUserId = remember(messages) { messages.lastOrNull { it.role == ChatRole.User }?.id }
    val rowActions =
        remember(actions) {
            ChatMessageItemActions(onRegenerate = actions.onRegenerate, onEditAndResend = actions.onEditAndResend)
        }
    val revealLength = messages.lastOrNull()?.streamedText?.length ?: 0

    LaunchedEffect(messages.size, revealLength, conversation.isWaiting) {
        val total = messages.size + if (conversation.isWaiting) 1 else 0
        if (total > 0) listState.animateScrollToItem(total - 1)
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        itemsIndexed(messages, key = { _, message -> message.id }) { index, message ->
            val previous = messages.getOrNull(index - 1)
            val next = messages.getOrNull(index + 1)
            ChatMessageItem(
                message = message,
                isLastAssistant = message.id == lastAssistantId,
                isLastUser = message.id == lastUserId,
                isFirstInGroup = previous == null || previous.role != message.role,
                isLastInGroup = next == null || next.role != message.role,
                actions = rowActions,
                actionsDisabled = conversation.isStreaming,
            )
        }
        if (conversation.isWaiting) {
            item(key = "chatbot-thinking") { ThinkingIndicator() }
        }
    }
}

/** GlassPanel2 — the "Helix is thinking…" indicator: the Helix mark beside a typing animation + the label. */
@Composable
private fun ThinkingIndicator() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Avatar(kind = AvatarKind.Bot, size = AvatarSize.Md, shape = AvatarShape.Rounded, contentDescription = null)
        GlassPanel(padding = PanelPadding.Sm) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TypingDots()
                BodyText(
                    text = stringResource(R.string.translation_chatbot_thinking),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Three softly-pulsing dots — the web `TypingDots`. Decorative (no accessible name); the label is the sibling text. */
@Composable
private fun TypingDots() {
    val transition = rememberInfiniteTransition(label = "chatbot-typing")
    Row(horizontalArrangement = Arrangement.spacedBy(DOT_GAP), verticalAlignment = Alignment.CenterVertically) {
        repeat(TYPING_DOT_COUNT) { index ->
            val alpha by transition.animateFloat(
                initialValue = DOT_ALPHA_MIN,
                targetValue = 1f,
                animationSpec =
                    infiniteRepeatable(
                        animation =
                            tween(
                                durationMillis = DOT_CYCLE_MILLIS,
                                delayMillis = index * DOT_STAGGER_MILLIS,
                                easing = LinearEasing,
                            ),
                        repeatMode = RepeatMode.Reverse,
                    ),
                label = "chatbot-typing-dot-$index",
            )
            Box(
                modifier =
                    Modifier
                        .size(DOT_SIZE)
                        .graphicsLayer { this.alpha = alpha }
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
            )
        }
    }
}

/**
 * The bottom input row — the message [Textarea] (its label is the accessible "Message" name, its supporting hint
 * the prompt copy) plus the Send affordance, which swaps to a Stop affordance while a reveal is streaming (web
 * `isStreaming ? Stop : Send`). The Stop button carries the localized stop-hint as a long-press tooltip.
 */
@Composable
private fun ChatInputRow(
    input: String,
    onInputChange: (String) -> Unit,
    isStreaming: Boolean,
    isWaiting: Boolean,
    onSend: () -> Unit,
    onStop: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Bottom,
    ) {
        Textarea(
            value = input,
            onValueChange = onInputChange,
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_chatbot_inputLabel),
            hint = stringResource(R.string.translation_chatbot_placeholder), // parity:allow i18n key literally named chatbot.placeholder
            minLines = 1,
            maxLines = INPUT_MAX_LINES,
        )
        if (isStreaming) {
            val stopStreamingLabel = stringResource(R.string.translation_chatbot_actions_stopStreaming)
            Tooltip(text = stringResource(R.string.translation_chatbot_actions_stopHint)) {
                Button(
                    label = stringResource(R.string.translation_chatbot_actions_stop),
                    onClick = onStop,
                    variant = ButtonVariant.Secondary,
                    leadingIcon = ChatbotPageGlyphs.Stop,
                    modifier = Modifier.semantics { contentDescription = stopStreamingLabel },
                )
            }
        } else {
            val sendLabel = stringResource(R.string.translation_chatbot_actions_send)
            Button(
                onClick = onSend,
                variant = ButtonVariant.Primary,
                enabled = input.isNotBlank() && !isWaiting,
                modifier = Modifier.semantics { contentDescription = sendLabel },
            ) {
                Icon(ChatbotPageGlyphs.Send, contentDescription = null, size = IconSize.Md)
            }
        }
    }
}

/**
 * The History sidebar overlay — a scrim + a start-aligned [SessionList] surface, mirroring the web mobile
 * History dialog. The SessionList owns its own loading / empty / content / error+retry surfaces for the sessions
 * feed; selecting a session or starting a new chat dismisses the overlay.
 */
@Composable
private fun SessionOverlay(
    sessions: UiState<List<ChatSessionInfo>>,
    activeSessionId: String,
    actions: ChatbotPageActions,
    onDismiss: () -> Unit,
) {
    val historyLabel = stringResource(R.string.translation_chatbot_history)
    val sessionActions =
        remember(actions, onDismiss) {
            SessionListActions(
                onSelect = {
                    actions.onSelectSession(it)
                    onDismiss()
                },
                onNewChat = {
                    actions.onNewChat()
                    onDismiss()
                },
                onRename = actions.onRenameSession,
                onDelete = actions.onDeleteSession,
            )
        }
    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = SCRIM_ALPHA))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onDismiss,
                    ),
        )
        Surface(
            modifier =
                Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxHeight()
                    .fillMaxWidth(SIDEBAR_WIDTH_FRACTION)
                    .widthIn(max = SIDEBAR_MAX_WIDTH)
                    .semantics { contentDescription = historyLabel },
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = Elevation.raised,
        ) {
            SessionList(
                state = sessions,
                activeSessionId = activeSessionId,
                actions = sessionActions,
                onRetry = actions.onRefreshSessions,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** Maps the Android [ErrorKind] taxonomy onto the shared [QueryError] recovery kinds for the conversation retry surface. */
private fun toQueryErrorKind(kind: ErrorKind?): QueryErrorKind =
    when (kind) {
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.CircuitOpen -> QueryErrorKind.Offline
        ErrorKind.Http, ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
    }

// ── Layout geometry ─────────────────────────────────────────────────────────────────────────────────────────

private const val SIDEBAR_WIDTH_FRACTION = 0.85f
private val SIDEBAR_MAX_WIDTH: Dp = 360.dp
private const val SCRIM_ALPHA = 0.32f
private const val INPUT_MAX_LINES = 5

private const val TYPING_DOT_COUNT = 3
private val DOT_SIZE: Dp = 6.dp
private val DOT_GAP: Dp = 4.dp
private const val DOT_ALPHA_MIN = 0.3f
private const val DOT_CYCLE_MILLIS = 600
private const val DOT_STAGGER_MILLIS = 120
