package io.teslasync.android.featureviews.chatmessageitem

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the ChatMessageItem's pure logic — the native analogue of everything the web
 * component derives from its props (web/src/features/system/components/chatbot/ChatMessageItem.tsx): the author
 * guard, the revealed text (`streamedText ?? content`), the grouping-driven avatar/timestamp visibility, the
 * action-row gate, the regenerate/edit position gates, the absolute clock label (`formatTime`), and the
 * inline-edit submit/disable logic (`submitEdit` + the Save `disabled` guard). Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ChatMessageItemProjectionTest {
    private val zone: ZoneId = ZoneOffset.UTC
    private val locale: Locale = Locale.US

    private fun userMessage(): UIChatMessage =
        UIChatMessage(
            id = 1,
            role = ChatRole.User,
            content = "What's my battery health?",
            createdAt = "2026-04-04T14:30:00Z",
        )

    private fun assistantMessage(): UIChatMessage =
        UIChatMessage(
            id = 2,
            role = ChatRole.Assistant,
            content = "Your battery health is at 94%.",
            createdAt = "2026-04-04T14:31:00Z",
        )

    @Suppress("LongParameterList")
    private fun project(
        message: UIChatMessage,
        isLastAssistant: Boolean = false,
        isLastUser: Boolean = false,
        isFirstInGroup: Boolean = true,
        isLastInGroup: Boolean = true,
        actionsDisabled: Boolean = false,
    ): ChatMessageRow =
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

    // ── Role mapping (web message.role === 'user') ─────────────────────────────

    @Test
    fun fromWireMapsOnlyTheUserTokenToUser() {
        assertEquals(ChatRole.User, ChatRole.fromWire("user"))
        assertEquals(ChatRole.Assistant, ChatRole.fromWire("assistant"))
    }

    @Test
    fun fromWireFoldsUnknownNullAndBlankToAssistant() {
        assertEquals(ChatRole.Assistant, ChatRole.fromWire("system"))
        assertEquals(ChatRole.Assistant, ChatRole.fromWire(null))
        assertEquals(ChatRole.Assistant, ChatRole.fromWire(""))
        assertEquals(ChatRole.Assistant, ChatRole.fromWire("   "))
    }

    @Test
    fun fromWireIsCaseAndWhitespaceTolerant() {
        assertEquals(ChatRole.User, ChatRole.fromWire("  USER  "))
        assertEquals(ChatRole.Assistant, ChatRole.fromWire("Assistant"))
    }

    // ── Full projection — user vs assistant ────────────────────────────────────

    @Test
    fun projectMapsEveryFieldForALastUserMessage() {
        val row = project(userMessage(), isLastUser = true)

        assertTrue(row.isUser)
        assertEquals("What's my battery health?", row.visibleText)
        assertEquals("What's my battery health?", row.rawContent)
        assertFalse(row.isStreaming)
        assertTrue(row.showAvatar)
        assertTrue(row.showTimestamp)
        assertTrue(row.showActions)
        assertFalse(row.canRegenerate)
        assertTrue(row.canEdit)
        assertNotNull(row.timeLabel)
    }

    @Test
    fun projectMapsEveryFieldForALastAssistantMessage() {
        val row = project(assistantMessage(), isLastAssistant = true)

        assertFalse(row.isUser)
        assertEquals("Your battery health is at 94%.", row.visibleText)
        assertTrue(row.showActions)
        assertTrue(row.canRegenerate)
        assertFalse(row.canEdit)
    }

    // ── Revealed text (web streamedText ?? content) ────────────────────────────

    @Test
    fun visibleTextPrefersStreamedTextWhenPresent() {
        val row = project(assistantMessage().copy(isStreaming = true, streamedText = "Your battery"))
        assertEquals("Your battery", row.visibleText)
        assertEquals("Your battery health is at 94%.", row.rawContent)
    }

    @Test
    fun visibleTextFallsBackToContentWhenStreamedTextIsNull() {
        val row = project(assistantMessage().copy(streamedText = null))
        assertEquals("Your battery health is at 94%.", row.visibleText)
    }

    // ── Streaming suppresses the action row + timestamp (web !isStreaming) ──────

    @Test
    fun streamingSuppressesActionsAndTimestampAndFlagsCaret() {
        val row = project(assistantMessage().copy(isStreaming = true), isLastAssistant = true)
        assertTrue(row.isStreaming)
        assertFalse(row.showActions)
        assertFalse(row.showTimestamp)
        assertNull(row.timeLabel)
        // The position gate still holds; only the streaming guard hides the row.
        assertTrue(row.canRegenerate)
    }

    // ── Action-row gate (web !isStreaming && !actionsDisabled) ─────────────────

    @Test
    fun actionsDisabledSuppressesTheActionRow() {
        val row = project(userMessage(), isLastUser = true, actionsDisabled = true)
        assertFalse(row.showActions)
        // The eligibility gate is independent of the visibility gate, matching the web.
        assertTrue(row.canEdit)
    }

    // ── Grouping visibility (web isFirstInGroup / isLastInGroup) ───────────────

    @Test
    fun avatarVisibilityFollowsIsFirstInGroup() {
        assertTrue(project(userMessage(), isFirstInGroup = true).showAvatar)
        assertFalse(project(userMessage(), isFirstInGroup = false).showAvatar)
    }

    @Test
    fun timestampVisibilityFollowsIsLastInGroupAndNotStreaming() {
        assertTrue(project(userMessage(), isLastInGroup = true).showTimestamp)
        assertFalse(project(userMessage(), isLastInGroup = false).showTimestamp)
        assertNull(project(userMessage(), isLastInGroup = false).timeLabel)
    }

    // ── Position gates (web isLastAssistant / isLastUser) ──────────────────────

    @Test
    fun canRegenerateOnlyForTheLastAssistantMessage() {
        assertTrue(project(assistantMessage(), isLastAssistant = true).canRegenerate)
        assertFalse(project(assistantMessage(), isLastAssistant = false).canRegenerate)
        // A user message never regenerates, even if mislabeled as the last assistant.
        assertFalse(project(userMessage(), isLastAssistant = true).canRegenerate)
    }

    @Test
    fun canEditOnlyForTheLastUserMessage() {
        assertTrue(project(userMessage(), isLastUser = true).canEdit)
        assertFalse(project(userMessage(), isLastUser = false).canEdit)
        // An assistant message never edits, even if mislabeled as the last user.
        assertFalse(project(assistantMessage(), isLastUser = true).canEdit)
    }

    // ── Absolute clock label (web formatTime(created_at)) ──────────────────────

    @Test
    fun formatTimeReturnsEmDashForBlankOrUnparseableTimestamps() {
        assertEquals(EM_DASH, ChatMessageItemProjection.formatTime("", zone, locale))
        assertEquals(EM_DASH, ChatMessageItemProjection.formatTime("   ", zone, locale))
        assertEquals(EM_DASH, ChatMessageItemProjection.formatTime("not-a-date", zone, locale))
    }

    @Test
    fun formatTimeRendersAStableLabelForAValidTimestamp() {
        val label = ChatMessageItemProjection.formatTime("2026-04-04T14:30:00Z", zone, locale)
        assertNotEquals(EM_DASH, label)
        assertTrue("expected the minute in the label, got '$label'", label.contains("30"))
    }

    @Test
    fun formatTimeAppliesTheRequestedZone() {
        val instant = "2026-04-04T23:30:00Z"
        val utc = ChatMessageItemProjection.formatTime(instant, ZoneOffset.UTC, locale)
        val newYork = ChatMessageItemProjection.formatTime(instant, ZoneId.of("America/New_York"), locale)
        assertNotEquals(EM_DASH, utc)
        assertNotEquals(EM_DASH, newYork)
        assertNotEquals("the same instant must format differently across zones", utc, newYork)
    }

    @Test
    fun formatTimeAcceptsOffsetAndZonelessTimestamps() {
        val canonical = ChatMessageItemProjection.formatTime("2026-04-04T14:30:00Z", zone, locale)
        assertEquals(canonical, ChatMessageItemProjection.formatTime("2026-04-04T14:30:00+00:00", zone, locale))
        assertEquals(canonical, ChatMessageItemProjection.formatTime("2026-04-04T14:30:00", zone, locale))
    }

    // ── Inline-edit submit (web submitEdit) ────────────────────────────────────

    @Test
    fun resolveEditSubmissionDiscardsBlankAndUnchangedDrafts() {
        assertNull(ChatMessageItemProjection.resolveEditSubmission("", "hello"))
        assertNull(ChatMessageItemProjection.resolveEditSubmission("   ", "hello"))
        assertNull(ChatMessageItemProjection.resolveEditSubmission("hello", "hello"))
        // A draft equal to the original after trimming on both sides is a no-op.
        assertNull(ChatMessageItemProjection.resolveEditSubmission("  hello  ", "hello"))
    }

    @Test
    fun resolveEditSubmissionReturnsTheTrimmedChangedDraft() {
        assertEquals("hello world", ChatMessageItemProjection.resolveEditSubmission("  hello world  ", "hello"))
        assertEquals("changed", ChatMessageItemProjection.resolveEditSubmission("changed", "original"))
    }

    @Test
    fun isSaveEnabledMatchesTheWebDisabledGuard() {
        assertFalse(ChatMessageItemProjection.isSaveEnabled("", "hello"))
        assertFalse(ChatMessageItemProjection.isSaveEnabled("   ", "hello"))
        assertFalse(ChatMessageItemProjection.isSaveEnabled("hello", "hello"))
        assertTrue(ChatMessageItemProjection.isSaveEnabled("hello world", "hello"))
    }

    // ── Telemetry (P1/S11 view.opened) ─────────────────────────────────────────

    @Test
    fun recordChatMessageItemOpenedEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        recordChatMessageItemOpened(logger)

        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "ChatMessageItem"), record.fields)
        assertEquals("ChatMessageItem", ChatMessageItemRegistration.SLUG)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level = level, event = event, fields = fields)
        }
    }
}
