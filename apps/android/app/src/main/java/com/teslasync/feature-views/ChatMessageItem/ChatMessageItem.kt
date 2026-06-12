// The native Jetpack Compose + Material 3 ChatMessageItem feature view — a parity port of
// web/src/features/system/components/chatbot/ChatMessageItem.tsx. The web component is a single chat row: a
// user or assistant bubble (the user's tinted + right-aligned with a user avatar, the assistant's neutral +
// left-aligned with a bot avatar), the revealed text (markdown for the assistant, plain for the user), a
// blinking typewriter caret while a reply streams, an absolute clock label on the last message of a group, and
// a hover/touch-revealed action cluster — copy on every message, regenerate on the last assistant reply, and an
// inline edit-and-resend on the last user message.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the i18n catalog); the host owns the message and wires the actions
// through [ChatMessageItemActions], exactly like the web callbacks. Because the surface acceptance gate requires
// every lifecycle state to render, the stateful entry takes the host's cache-then-network [UiState] and draws
// each state the shared state-holder layer (P1/S8) can carry — a loading skeleton, a hard error with retry, an
// empty state, the loaded row, and stale/offline ("last known") with a freshness chip + auto-refresh — without
// ever fetching. A web-parity overload taking a raw [UIChatMessage] is provided for hosts that already hold one.
//
// The action revealing the web does on hover is always-on here: the web itself forces the actions visible on
// coarse (touch) pointers (`[@media(pointer:coarse)]:opacity-100`), which is every Android device. The
// assistant bubble renders its text faithfully as wrapped body text: rich markdown is owned by the sibling
// MarkdownRenderer surface, which has its own P3 prompt and is explicitly out of scope here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChatMessageItem — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chatmessageitem

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.Avatar
import io.teslasync.android.components.datadisplay.AvatarKind
import io.teslasync.android.components.datadisplay.AvatarShape
import io.teslasync.android.components.datadisplay.AvatarSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

// ── Layout constants ──────────────────────────────────────────────────────────────────────────────────────

/** Avatar diameter — the web `Avatar size="md"`; reused to reserve the slot when the avatar is suppressed. */
private val AVATAR_SIZE: Dp = 32.dp

/** Bubble corner radius — the web `rounded-2xl`. */
private val BUBBLE_RADIUS: Dp = 16.dp

/** Bubble hairline border width — the web `border`. */
private val BUBBLE_BORDER_WIDTH: Dp = 1.dp

/** Bubble max width as a fraction of the row — the web `max-w-[80%]` / `max-w-[70%]` clamp. */
private const val BUBBLE_MAX_WIDTH_FRACTION: Float = 0.85f

/** Background tint alpha of the user bubble — the web `bg-cyan-500/10`. */
private const val USER_BUBBLE_BG_ALPHA: Float = 0.10f

/** Border tint alpha of the user bubble — the web `border-cyan-500/20`. */
private const val USER_BUBBLE_BORDER_ALPHA: Float = 0.25f

/** Streaming caret dimensions — the web `w-1.5 h-4`. */
private val CARET_WIDTH: Dp = 6.dp
private val CARET_HEIGHT: Dp = 16.dp
private val CARET_RADIUS: Dp = 1.dp
private val CARET_GAP: Dp = 2.dp
private val CARET_BOTTOM_PADDING: Dp = 2.dp

/** Streaming caret blink cycle in milliseconds — the web `animate-pulse`, honored only when motion is on. */
private const val CARET_PULSE_MS: Int = 700

/** Dimmest alpha of the streaming caret pulse. */
private const val CARET_MIN_ALPHA: Float = 0.2f

/** Edit textarea height bounds — the web `rows={3}`. */
private const val EDIT_MIN_LINES: Int = 3
private const val EDIT_MAX_LINES: Int = 6

/** Loading skeleton dimensions, sized so the row never first-paints as a blank box. */
private val SKELETON_LINE_HEIGHT: Dp = 12.dp
private val SKELETON_META_HEIGHT: Dp = 10.dp
private val SKELETON_META_WIDTH: Dp = 64.dp
private const val SKELETON_LINE_1_FRACTION: Float = 0.7f
private const val SKELETON_LINE_2_FRACTION: Float = 0.45f

/**
 * The host-supplied actions for a chat row — the native analogue of the web component's optional callback props.
 * A `null` callback means the host does not support that action, so the affordance is hidden exactly like the
 * web `onRegenerate &&` / `onEditAndResend &&` guards (rather than rendering a dead button).
 *
 * @property onRegenerate regenerate the assistant reply — the web `onRegenerate(message)` (last assistant only).
 * @property onEditAndResend resend an edited user message — the web `onEditAndResend(message, text)` (last user).
 */
class ChatMessageItemActions(
    val onRegenerate: ((UIChatMessage) -> Unit)? = null,
    val onEditAndResend: ((UIChatMessage, String) -> Unit)? = null,
)

/**
 * Stateful entry point for a chat row. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders every lifecycle [state] the shared chat session can carry. The host owns the conversation (P1/S8) and
 * supplies [onRetry] (the load's `refetch`) plus the row [actions]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the message (the host's loaded [UIChatMessage]).
 * @param isLastAssistant gates the regenerate affordance — true only for the last assistant message.
 * @param isLastUser gates the inline-edit affordance — true only for the last user message.
 * @param isFirstInGroup whether to render the avatar (else the slot is reserved) — web `isFirstInGroup`.
 * @param isLastInGroup whether to render the timestamp — web `isLastInGroup`.
 * @param actions the row callbacks — wired by the host to regenerate / edit-and-resend.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param actionsDisabled suppress the whole action row (web `actionsDisabled`, e.g. while another reply streams).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChatMessageItem(
    state: UiState<UIChatMessage>,
    isLastAssistant: Boolean,
    isLastUser: Boolean,
    isFirstInGroup: Boolean,
    isLastInGroup: Boolean,
    actions: ChatMessageItemActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    actionsDisabled: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordChatMessageItemOpened(logger) }
    ChatMessageItemContent(
        state = state,
        isLastAssistant = isLastAssistant,
        isLastUser = isLastUser,
        isFirstInGroup = isFirstInGroup,
        isLastInGroup = isLastInGroup,
        actionsDisabled = actionsDisabled,
        actions = actions,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's non-null `message` prop, for hosts that already hold a
 * loaded message. Wraps it in a content [UiState] and renders the row — no fetch sits behind it, so it offers no
 * retry affordance. Records `view.opened` like the stateful entry.
 */
@Composable
fun ChatMessageItem(
    message: UIChatMessage,
    isLastAssistant: Boolean,
    isLastUser: Boolean,
    isFirstInGroup: Boolean,
    isLastInGroup: Boolean,
    actions: ChatMessageItemActions,
    modifier: Modifier = Modifier,
    actionsDisabled: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(message) { UiState(phase = UiPhase.Content, data = message) }
    ChatMessageItem(
        state = state,
        isLastAssistant = isLastAssistant,
        isLastUser = isLastUser,
        isFirstInGroup = isFirstInGroup,
        isLastInGroup = isLastInGroup,
        actions = actions,
        onRetry = {},
        modifier = modifier,
        actionsDisabled = actionsDisabled,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's row
 * exactly for the loaded state and adds the lifecycle chrome the host's load implies: a loading skeleton, a
 * hard-error retry surface, a friendly empty state, and a freshness chip that reflects refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the freshness contract the sibling surfaces use.
 * [zone] / [locale] fix the absolute clock label for tests; production callers use the device wall clock.
 */
@Composable
fun ChatMessageItemContent(
    state: UiState<UIChatMessage>,
    isLastAssistant: Boolean,
    isLastUser: Boolean,
    isFirstInGroup: Boolean,
    isLastInGroup: Boolean,
    actionsDisabled: Boolean,
    actions: ChatMessageItemActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    strings: ChatMessageItemStrings = rememberChatMessageItemStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val message = state.data
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        when {
            state.isLoading -> ChatMessageLoading()
            state.isError -> ChatMessageError(onRetry = onRetry)
            message == null -> ChatMessageEmpty()
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    ChatMessageFreshnessRow(state = state)
                }
                val row =
                    remember(
                        message,
                        isLastAssistant,
                        isLastUser,
                        isFirstInGroup,
                        isLastInGroup,
                        actionsDisabled,
                        zone,
                        locale,
                    ) {
                        ChatMessageItemProjection.project(
                            message = message,
                            isLastAssistant = isLastAssistant,
                            isLastUser = isLastUser,
                            isFirstInGroup = isFirstInGroup,
                            isLastInGroup = isLastInGroup,
                            actionsDisabled = actionsDisabled,
                            zone = zone,
                            locale = locale,
                        )
                    }
                ChatMessageRowView(message = message, row = row, strings = strings, actions = actions)
            }
        }
    }
}

/**
 * The loaded chat row — the faithful render of the web component. The avatar sits on the message's side (bot
 * left, user right), the bubble is clamped to [BUBBLE_MAX_WIDTH_FRACTION] of the row and shrinks to its content,
 * and the whole cluster packs toward the message's edge (web `justify-start` / `justify-end`).
 */
@Composable
private fun ChatMessageRowView(
    message: UIChatMessage,
    row: ChatMessageRow,
    strings: ChatMessageItemStrings,
    actions: ChatMessageItemActions,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val bubbleMaxWidth = maxWidth * BUBBLE_MAX_WIDTH_FRACTION
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement =
                Arrangement.spacedBy(Spacing.sm, if (row.isUser) Alignment.End else Alignment.Start),
            verticalAlignment = Alignment.Top,
        ) {
            if (!row.isUser) {
                ChatAvatar(kind = AvatarKind.Bot, visible = row.showAvatar)
            }
            ChatBubble(
                message = message,
                row = row,
                strings = strings,
                actions = actions,
                modifier = Modifier.widthIn(max = bubbleMaxWidth),
            )
            if (row.isUser) {
                ChatAvatar(kind = AvatarKind.User, visible = row.showAvatar)
            }
        }
    }
}

/** The avatar slot — renders the [kind] avatar when [visible], else reserves the same space (web `invisible`). */
@Composable
private fun ChatAvatar(
    kind: AvatarKind,
    visible: Boolean,
) {
    if (visible) {
        Avatar(
            kind = kind,
            size = AvatarSize.Md,
            shape = AvatarShape.Rounded,
            contentDescription = null,
            modifier = Modifier.padding(top = Spacing.xs),
        )
    } else {
        Spacer(Modifier.size(AVATAR_SIZE))
    }
}

/**
 * The tinted message bubble holding the body, the timestamp, and the action cluster — the web rounded `<div>`.
 * Owns the inline-edit state (web `editing` / `draft`): entering edit swaps the body for a textarea + Cancel /
 * Save, Save resends only a non-blank, changed draft (web `submitEdit`), and Cancel restores the original.
 */
@Composable
private fun ChatBubble(
    message: UIChatMessage,
    row: ChatMessageRow,
    strings: ChatMessageItemStrings,
    actions: ChatMessageItemActions,
    modifier: Modifier = Modifier,
) {
    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(row.rawContent) }
    val colors = if (row.isUser) userBubbleColors() else assistantBubbleColors()

    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(BUBBLE_RADIUS))
                .background(colors.background)
                .border(BUBBLE_BORDER_WIDTH, colors.border, RoundedCornerShape(BUBBLE_RADIUS))
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (editing) {
            ChatEditBlock(
                draft = draft,
                saveEnabled = ChatMessageItemProjection.isSaveEnabled(draft, row.rawContent),
                strings = strings,
                onDraftChange = { draft = it },
                onCancel = {
                    editing = false
                    draft = row.rawContent
                },
                onSubmit = {
                    ChatMessageItemProjection.resolveEditSubmission(draft, row.rawContent)?.let { resend ->
                        actions.onEditAndResend?.invoke(message, resend)
                    }
                    editing = false
                },
            )
        } else {
            ChatMessageText(row = row)
            if (row.showTimestamp) {
                row.timeLabel?.let { label -> Caption(label) }
            }
            if (row.showActions) {
                ChatActionRow(
                    message = message,
                    row = row,
                    strings = strings,
                    actions = actions,
                    onStartEdit = {
                        draft = row.rawContent
                        editing = true
                    },
                )
            }
        }
    }
}

/**
 * The revealed message body. The user message renders plain, newline-preserving text (web `whitespace-pre-wrap`).
 * The assistant message renders the same faithful wrapped text — rich markdown is the sibling MarkdownRenderer
 * surface (out of scope) — and appends the blinking typewriter caret while streaming (web `isStreaming` span).
 */
@Composable
private fun ChatMessageText(row: ChatMessageRow) {
    val textColor = MaterialTheme.colorScheme.onSurface
    if (row.isUser || !row.isStreaming) {
        BodyText(text = row.visibleText, color = textColor)
    } else {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(CARET_GAP),
        ) {
            BodyText(text = row.visibleText, color = textColor, modifier = Modifier.weight(1f, fill = false))
            StreamingCaret()
        }
    }
}

/**
 * The inline edit affordance — the web `editing` branch: a focused textarea seeded with the message content plus
 * right-aligned Cancel / Save buttons. Save is disabled until the draft is non-blank and changed (web
 * `disabled={!draft.trim() || draft.trim() === message.content.trim()}`).
 */
@Composable
private fun ChatEditBlock(
    draft: String,
    saveEnabled: Boolean,
    strings: ChatMessageItemStrings,
    onDraftChange: (String) -> Unit,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Textarea(
            value = draft,
            onValueChange = onDraftChange,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = strings.editMessage },
            minLines = EDIT_MIN_LINES,
            maxLines = EDIT_MAX_LINES,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Close,
            )
            Button(
                label = strings.saveAndResend,
                onClick = onSubmit,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = saveEnabled,
                leadingIcon = TeslaGlyphs.Check,
            )
        }
    }
}

/**
 * The action cluster — copy on every message, regenerate on the last assistant reply, and edit on the last user
 * message. The regenerate / edit buttons carry the verbose web `aria-label` as their accessible name while
 * showing the short visible label, and only render when the host supplied the matching callback.
 */
@Composable
private fun ChatActionRow(
    message: UIChatMessage,
    row: ChatMessageRow,
    strings: ChatMessageItemStrings,
    actions: ChatMessageItemActions,
    onStartEdit: () -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CopyButton(
            text = message.content,
            copyLabel = strings.copyMessage,
            copiedLabel = strings.copied,
            iconOnly = true,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        if (row.canRegenerate) {
            actions.onRegenerate?.let { handler ->
                Button(
                    label = strings.regenerate,
                    onClick = { handler(message) },
                    modifier = Modifier.semantics { contentDescription = strings.regenerateAria },
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = FeedbackGlyphs.Refresh,
                )
            }
        }
        if (row.canEdit) {
            actions.onEditAndResend?.let {
                Button(
                    label = strings.edit,
                    onClick = onStartEdit,
                    modifier = Modifier.semantics { contentDescription = strings.editAria },
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = TeslaGlyphs.Edit,
                )
            }
        }
    }
}

/**
 * The blinking typewriter caret — the web `<span … animate-pulse>`. The blink runs only when the device is not
 * in reduce-motion mode; otherwise the caret is solid. Decorative, so it carries no TalkBack semantics.
 */
@Composable
private fun StreamingCaret() {
    val reduceMotion = rememberReducedMotion()
    val transition = rememberInfiniteTransition(label = "chat-stream-caret")
    val pulse by transition.animateFloat(
        initialValue = 1f,
        targetValue = CARET_MIN_ALPHA,
        animationSpec = infiniteRepeatable(animation = tween(CARET_PULSE_MS), repeatMode = RepeatMode.Reverse),
        label = "chat-stream-caret-alpha",
    )
    Box(
        modifier =
            Modifier
                .padding(bottom = CARET_BOTTOM_PADDING)
                .size(width = CARET_WIDTH, height = CARET_HEIGHT)
                .alpha(if (reduceMotion) 1f else pulse)
                .clip(RoundedCornerShape(CARET_RADIUS))
                .background(MaterialTheme.colorScheme.primary),
    )
}

/** First-load skeleton — an avatar + two text lines + a meta bar, so the row is never blank while loading. */
@Composable
private fun ChatMessageLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Skeleton(modifier = Modifier.size(AVATAR_SIZE), rounded = true)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Skeleton(widthFraction = SKELETON_LINE_1_FRACTION, height = SKELETON_LINE_HEIGHT)
            Skeleton(widthFraction = SKELETON_LINE_2_FRACTION, height = SKELETON_LINE_HEIGHT)
            Skeleton(modifier = Modifier.width(SKELETON_META_WIDTH), height = SKELETON_META_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun ChatMessageError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — a friendly state shown when the host resolved no message, never a blank box. */
@Composable
private fun ChatMessageEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = DataDisplayGlyphs.Robot,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned above the row. */
@Composable
private fun ChatMessageFreshnessRow(state: UiState<UIChatMessage>) {
    val formatAge = rememberChatFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
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

// ── Bubble colors ─────────────────────────────────────────────────────────────────────────────────────────
// The web user bubble is a cyan tint (`bg-cyan-500/10 border-cyan-500/20`); the assistant bubble uses the
// neutral surface tokens (`bg-[var(--surface-2)] border-[var(--border-subtle)]`). Mapped to the Material scheme
// so light / dark / high-contrast all stay correct, never raw hex.

private data class BubbleColors(
    val background: Color,
    val border: Color,
)

@Composable
private fun userBubbleColors(): BubbleColors {
    val accent = MaterialTheme.colorScheme.primary
    return BubbleColors(
        background = accent.copy(alpha = USER_BUBBLE_BG_ALPHA),
        border = accent.copy(alpha = USER_BUBBLE_BORDER_ALPHA),
    )
}

@Composable
private fun assistantBubbleColors(): BubbleColors =
    BubbleColors(
        background = MaterialTheme.colorScheme.surfaceVariant,
        border = MaterialTheme.colorScheme.outlineVariant,
    )

// ── i18n facade (P1/S10) ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [ChatMessageItemStrings] from the i18n catalog (P1/S10): the eight `chatbot.*` keys the
 * web component reads plus the shared "Copied" confirmation the native CopyButton requires.
 */
@Composable
private fun rememberChatMessageItemStrings(): ChatMessageItemStrings {
    val editMessage = stringResource(R.string.translation_chatbot_aria_editMessage)
    val cancel = stringResource(R.string.translation_chatbot_actions_cancel)
    val saveAndResend = stringResource(R.string.translation_chatbot_actions_saveAndResend)
    val copyMessage = stringResource(R.string.translation_chatbot_aria_copyMessage)
    val copied = stringResource(R.string.translation_common_copyButton_copied)
    val regenerate = stringResource(R.string.translation_chatbot_actions_regenerate)
    val regenerateAria = stringResource(R.string.translation_chatbot_aria_regenerate)
    val edit = stringResource(R.string.translation_chatbot_actions_edit)
    val editAria = stringResource(R.string.translation_chatbot_aria_edit)
    return remember(editMessage, cancel, saveAndResend, copyMessage, copied, regenerate, regenerateAria, edit, editAria) {
        ChatMessageItemStrings(
            editMessage = editMessage,
            cancel = cancel,
            saveAndResend = saveAndResend,
            copyMessage = copyMessage,
            copied = copied,
            regenerate = regenerate,
            regenerateAria = regenerateAria,
            edit = edit,
            editAria = editAria,
        )
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern the siblings resolve. */
@Composable
private fun rememberChatFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

@Preview(showBackground = true)
@Composable
private fun ChatMessageItemUserPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChatMessageItemContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        UIChatMessage(
                            id = 1,
                            role = ChatRole.User,
                            content = "What's my battery health right now?",
                            createdAt = "2026-04-04T14:30:00Z",
                        ),
                ),
            isLastAssistant = false,
            isLastUser = true,
            isFirstInGroup = true,
            isLastInGroup = true,
            actionsDisabled = false,
            actions = ChatMessageItemActions(onEditAndResend = { _, _ -> }),
            onRetry = {},
            zone = ZoneOffset.UTC,
            locale = Locale.US,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun ChatMessageItemAssistantStreamingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChatMessageItemContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        UIChatMessage(
                            id = 2,
                            role = ChatRole.Assistant,
                            content = "Your battery health is estimated at 94%, with about 3% degradation so far.",
                            createdAt = "2026-04-04T14:31:00Z",
                            isStreaming = true,
                            streamedText = "Your battery health is estimated at 94%",
                        ),
                ),
            isLastAssistant = true,
            isLastUser = false,
            isFirstInGroup = true,
            isLastInGroup = true,
            actionsDisabled = false,
            actions = ChatMessageItemActions(onRegenerate = {}),
            onRetry = {},
            zone = ZoneOffset.UTC,
            locale = Locale.US,
        )
    }
}
