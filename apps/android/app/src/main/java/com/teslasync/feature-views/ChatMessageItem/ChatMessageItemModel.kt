// Pure, framework-free model + projection for the ChatMessageItem feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/chatbot/ChatMessageItem.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is purely presentational — the hosting chatbot page owns the message list and wires the
// copy / regenerate / edit-and-resend actions through callbacks. This file owns exactly the parts the web
// component computes from its props: the author guard (web `message.role === 'user'`), the revealed text (web
// `message.streamedText ?? message.content`), the grouping-driven avatar/timestamp visibility (web `showAvatar`
// / `showTimestamp`), the action-row gate (web `showActions`), the position gates for the regenerate / edit
// affordances (web `isLastAssistant` / `isLastUser`), the absolute clock label (web `formatTime(created_at)`),
// and the inline-edit submit/disable logic (web `submitEdit` + the Save button `disabled` guard).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChatMessageItem — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chatmessageitem

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown when `created_at` is missing or unparseable — the web `formatTime` `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ChatMessageItemRegistration {
    /** Stable surface id. */
    const val ID: String = "chat-message-item"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChatMessageItem"
}

/**
 * Author of a chat message — the native analogue of the web `message.role` (`'user' | 'assistant'`). The web
 * derives `isUser = message.role === 'user'`, so any non-`user` wire value folds to [Assistant].
 */
enum class ChatRole {
    User,
    Assistant,
    ;

    companion object {
        /** Maps a raw wire `role` to a [ChatRole]; only the exact `user` token is a user (web `=== 'user'`). */
        fun fromWire(role: String?): ChatRole = if (role?.trim()?.lowercase(Locale.ROOT) == "user") User else Assistant
    }
}

/**
 * UI-facing chat message — the native analogue of the web `UIChatMessage` (the wire `ChatMessage` plus the two
 * typewriter-only fields the page mutates during a streamed reply).
 *
 * @property id the message id (wire data).
 * @property role the author — drives bubble side, avatar glyph, and which actions are eligible.
 * @property content the full message text (the copy/edit source of truth — never the partial reveal).
 * @property createdAt the ISO-8601 creation timestamp, formatted into the absolute clock label.
 * @property sessionId the owning session id (wire data; not rendered, kept for fidelity).
 * @property isStreaming whether a typewriter reveal is in flight — suppresses the action row + timestamp and
 *   shows the blinking caret.
 * @property streamedText the partial reveal during streaming; falls back to [content] when null (web
 *   `streamedText ?? content`).
 */
data class UIChatMessage(
    val id: Long,
    val role: ChatRole,
    val content: String,
    val createdAt: String,
    val sessionId: String = "",
    val isStreaming: Boolean = false,
    val streamedText: String? = null,
)

/**
 * Localized microcopy the surface renders (P1/S10) — the eight `chatbot.*` strings the web component reads plus
 * the shared "Copied" confirmation the native [io.teslasync.android.components.ui.CopyButton] requires. Mirrors
 * the web `t('chatbot.aria.*')` / `t('chatbot.actions.*')` keys.
 *
 * @property editMessage accessible name of the edit textarea (web `chatbot.aria.editMessage`).
 * @property cancel the cancel-edit button label (web `chatbot.actions.cancel`).
 * @property saveAndResend the submit-edit button label (web `chatbot.actions.saveAndResend`).
 * @property copyMessage accessible name of the copy button (web `chatbot.aria.copyMessage`).
 * @property copied the copy-confirmation label (the native CopyButton's two-second "Copied" state).
 * @property regenerate the regenerate button's visible label (web `chatbot.actions.regenerate`).
 * @property regenerateAria the regenerate button's accessible name (web `chatbot.aria.regenerate`).
 * @property edit the edit button's visible label (web `chatbot.actions.edit`).
 * @property editAria the edit button's accessible name (web `chatbot.aria.edit`).
 */
data class ChatMessageItemStrings(
    val editMessage: String,
    val cancel: String,
    val saveAndResend: String,
    val copyMessage: String,
    val copied: String,
    val regenerate: String,
    val regenerateAria: String,
    val edit: String,
    val editAria: String,
)

/**
 * One fully projected, render-ready chat row — the native analogue of everything the web component reads off its
 * props before returning JSX. Pure data (no Compose types): the composable maps these flags onto bubble side,
 * avatar/timestamp visibility, the streaming caret, and the action cluster.
 *
 * @property isUser whether this is a user message — bubble aligns right with the user avatar (web `isUser`).
 * @property visibleText the revealed text — the partial stream or the full content (web `streamedText ?? content`).
 * @property rawContent the full content — the copy + edit source of truth (web `message.content`).
 * @property isStreaming whether the typewriter caret should blink (web `message.isStreaming`).
 * @property showAvatar whether the avatar renders for this row (web `isFirstInGroup`); else the slot is reserved.
 * @property showTimestamp whether the absolute clock label renders (web `isLastInGroup && !isStreaming`).
 * @property showActions whether the action row is eligible (web `!isStreaming && !actionsDisabled`); the
 *   composable additionally suppresses it while editing, matching the web `&& !editing`.
 * @property canRegenerate whether the regenerate affordance is eligible (web `!isUser && isLastAssistant`).
 * @property canEdit whether the inline-edit affordance is eligible (web `isUser && isLastUser`).
 * @property timeLabel the formatted absolute clock label, or `null` when the timestamp is hidden.
 */
data class ChatMessageRow(
    val isUser: Boolean,
    val visibleText: String,
    val rawContent: String,
    val isStreaming: Boolean,
    val showAvatar: Boolean,
    val showTimestamp: Boolean,
    val showActions: Boolean,
    val canRegenerate: Boolean,
    val canEdit: Boolean,
    val timeLabel: String?,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's prop derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object ChatMessageItemProjection {
    // Locale-aware short clock formatter — the native analogue of the web
    // `toLocaleTimeString({ hour: '2-digit', minute: '2-digit' })`. The zone + locale are injected so the
    // rendered label honors the device while staying deterministic in tests.
    private val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)

    /**
     * Projects a [message] plus its host-supplied position/gating flags into a render-ready [ChatMessageRow].
     * [zone] and [locale] are injected so the absolute clock label is deterministic in tests; the composable
     * supplies the device wall zone + locale.
     */
    @Suppress("LongParameterList")
    fun project(
        message: UIChatMessage,
        isLastAssistant: Boolean,
        isLastUser: Boolean,
        isFirstInGroup: Boolean,
        isLastInGroup: Boolean,
        actionsDisabled: Boolean,
        zone: ZoneId,
        locale: Locale,
    ): ChatMessageRow {
        val isUser = message.role == ChatRole.User
        val showTimestamp = isLastInGroup && !message.isStreaming
        return ChatMessageRow(
            isUser = isUser,
            visibleText = message.streamedText ?: message.content,
            rawContent = message.content,
            isStreaming = message.isStreaming,
            showAvatar = isFirstInGroup,
            showTimestamp = showTimestamp,
            showActions = !message.isStreaming && !actionsDisabled,
            canRegenerate = !isUser && isLastAssistant,
            canEdit = isUser && isLastUser,
            timeLabel = if (showTimestamp) formatTime(message.createdAt, zone, locale) else null,
        )
    }

    /**
     * Formats [createdAt] into a localized short clock label in [zone]/[locale] — the web
     * `formatTime(message.created_at)`. A blank or unparseable timestamp returns [EM_DASH], mirroring the web
     * `'—'` guard rather than emitting an `Invalid Date`.
     */
    fun formatTime(
        createdAt: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(createdAt) ?: return EM_DASH
        return TIME_FORMAT.withLocale(locale).withZone(zone).format(instant)
    }

    /**
     * Resolves the text to resend from an edit [draft], or `null` when the edit should be discarded — the native
     * mirror of the web `submitEdit`: a blank draft, or one whose trimmed value equals the trimmed original
     * [originalContent], is a no-op; otherwise the trimmed draft is resent.
     */
    fun resolveEditSubmission(
        draft: String,
        originalContent: String,
    ): String? {
        val trimmed = draft.trim()
        return if (trimmed.isEmpty() || trimmed == originalContent.trim()) null else trimmed
    }

    /**
     * Whether the Save button is enabled for an edit [draft] — the inverse of the web `disabled` guard
     * (`!draft.trim() || draft.trim() === message.content.trim()`): enabled only for a non-blank, changed draft.
     */
    fun isSaveEnabled(
        draft: String,
        originalContent: String,
    ): Boolean = resolveEditSubmission(draft, originalContent) != null

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard above).
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChatMessageItemRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordChatMessageItemOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChatMessageItemRegistration.SLUG))
}
