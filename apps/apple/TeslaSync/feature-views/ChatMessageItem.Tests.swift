//
//  ChatMessageItem.Tests.swift
//  TeslaSync — P4 feature view · 0219 · ChatMessageItem (Apple)
//
//  Unit coverage for the ChatMessageItem surface:
//    • Adapter — the visible-text reveal, the blank check, the `submitEdit`
//      trim/cancel outcome, the `formatTime` short-time port, and the markdown
//      projection (inline render + raw-text fallback).
//    • State holder — `ChatMessageProjection` across loading / empty / error / data
//      and every branch flag (avatar / timestamp / actions / regenerate / edit /
//      streaming), plus the `ChatMessageModel` wiring, the inline-edit interaction,
//      the P1/S11 `view.opened` telemetry, and the stale auto-refresh transition.
//    • Accessibility — the VoiceOver message-label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryChatMessageSource`, and the locale +
//  time zone are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC")!

private func userMessage(
    _ text: String = "hi",
    streaming: Bool = false,
    streamed: String? = nil
) -> ChatMessageData {
    ChatMessageData(id: 1, role: .user, content: text, isStreaming: streaming, streamedText: streamed)
}

private func assistantMessage(
    _ text: String = "hello",
    streaming: Bool = false,
    streamed: String? = nil
) -> ChatMessageData {
    ChatMessageData(id: 2, role: .assistant, content: text, isStreaming: streaming, streamedText: streamed)
}

// MARK: - Visible text + blank check (web `streamedText ?? content` + trim)

@MainActor final class ChatTextTests: XCTestCase {
    func testVisiblePrefersStreamed() {
        XCTAssertEqual(ChatText.visibleText(content: "full", streamedText: "partial"), "partial")
        XCTAssertEqual(ChatText.visibleText(content: "full", streamedText: nil), "full")
    }

    func testIsBlank() {
        XCTAssertTrue(ChatText.isBlank(""))
        XCTAssertTrue(ChatText.isBlank("   \n\t "))
        XCTAssertFalse(ChatText.isBlank(" x "))
    }
}

// MARK: - Inline edit outcome (web `submitEdit`)

@MainActor final class ChatEditTests: XCTestCase {
    func testCancelWhenEmpty() {
        XCTAssertEqual(ChatEdit.outcome(draft: "   ", original: "hello"), .cancel)
    }

    func testCancelWhenUnchanged() {
        XCTAssertEqual(ChatEdit.outcome(draft: "  hello  ", original: "hello"), .cancel)
    }

    func testSubmitTrimmedWhenChanged() {
        XCTAssertEqual(ChatEdit.outcome(draft: "  new text ", original: "hello"), .submit("new text"))
    }
}

// MARK: - Timestamp (port of dateFormat.ts formatTime)

@MainActor final class ChatFormatTimeTests: XCTestCase {
    func testNilDateReturnsDash() {
        XCTAssertEqual(ChatFormat.time(nil, locale: enUS, timeZone: utc), "—")
    }

    func testUsesLocaleShortTime() {
        let date = Date(timeIntervalSince1970: 1_700_000_000) // 2023-11-14T22:13:20Z

        let reference = DateFormatter()
        reference.locale = enUS
        reference.timeZone = utc
        reference.dateStyle = .none
        reference.timeStyle = .short

        let formatted = ChatFormat.time(date, locale: enUS, timeZone: utc)
        // Contract: short time style (not medium/long), and the 22:13 UTC clock.
        XCTAssertEqual(formatted, reference.string(from: date))
        XCTAssertTrue(formatted.contains("10"), "expected the 12-hour hour, got \(formatted)")
        XCTAssertTrue(formatted.contains("13"), "expected the minute, got \(formatted)")
    }
}

// MARK: - Assistant markdown (web `MarkdownRenderer`)

@MainActor final class ChatMarkdownTests: XCTestCase {
    func testPlainTextRoundTrips() {
        let attributed = ChatMarkdown.attributed("just plain text")
        XCTAssertEqual(String(attributed.characters), "just plain text")
    }

    func testInlineBoldStripsMarkers() {
        let attributed = ChatMarkdown.attributed("**bold** word")
        XCTAssertEqual(String(attributed.characters), "bold word")
    }
}

// MARK: - Projection (web render gates + P4 leaf contract)

@MainActor final class ChatMessageProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = ChatMessageProjection.resolve(
            ChatMessageInput(message: assistantMessage(), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlaggedOrNoMessage() {
        XCTAssertEqual(ChatMessageProjection.resolve(ChatMessageInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(ChatMessageProjection.resolve(ChatMessageInput(message: nil)).phase, .loading)
    }

    func testLoadingWhenStreamingWithNoText() {
        let input = ChatMessageInput(message: assistantMessage("", streaming: true))
        XCTAssertEqual(ChatMessageProjection.resolve(input).phase, .loading)
    }

    func testEmptyWhenBlankAndNotStreaming() {
        let input = ChatMessageInput(message: assistantMessage("   "))
        XCTAssertEqual(ChatMessageProjection.resolve(input).phase, .empty)
    }

    func testUserDataBranchFlags() {
        let input = ChatMessageInput(
            message: userMessage("question"),
            isFirstInGroup: true,
            isLastInGroup: true,
            isLastUser: true
        )
        let resolved = ChatMessageProjection.resolve(input)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertTrue(resolved.isUser)
        XCTAssertTrue(resolved.showAvatar)
        XCTAssertTrue(resolved.showTimestamp)
        XCTAssertTrue(resolved.actionsAllowed)
        XCTAssertTrue(resolved.canEdit)
        XCTAssertFalse(resolved.canRegenerate)
    }

    func testAssistantRegenerateGating() {
        let resolved = ChatMessageProjection.resolve(
            ChatMessageInput(message: assistantMessage("answer"), isLastAssistant: true)
        )
        XCTAssertTrue(resolved.canRegenerate)
        XCTAssertFalse(resolved.canEdit)
    }

    func testDisabledHandlersHideAffordances() {
        let edit = ChatMessageInput(message: userMessage("q"), isLastUser: true, editEnabled: false)
        XCTAssertFalse(ChatMessageProjection.resolve(edit).canEdit)

        let regen = ChatMessageInput(
            message: assistantMessage("a"),
            isLastAssistant: true,
            regenerateEnabled: false
        )
        XCTAssertFalse(ChatMessageProjection.resolve(regen).canRegenerate)
    }

    func testStreamingHidesTimestampAndActions() {
        let input = ChatMessageInput(
            message: assistantMessage("full", streaming: true, streamed: "partial"),
            isLastInGroup: true,
            isLastAssistant: true
        )
        let resolved = ChatMessageProjection.resolve(input)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertTrue(resolved.isStreaming)
        XCTAssertFalse(resolved.showTimestamp)
        XCTAssertFalse(resolved.actionsAllowed)
        XCTAssertEqual(resolved.visibleText, "partial")
    }

    func testActionsDisabledSuppressesActions() {
        let input = ChatMessageInput(
            message: assistantMessage("a"),
            isLastAssistant: true,
            actionsDisabled: true
        )
        XCTAssertFalse(ChatMessageProjection.resolve(input).actionsAllowed)
    }

    func testAvatarHiddenWhenNotFirstInGroup() {
        let input = ChatMessageInput(message: assistantMessage("a"), isFirstInGroup: false)
        XCTAssertFalse(ChatMessageProjection.resolve(input).showAvatar)
    }

    func testTimestampHiddenWhenNotLastInGroup() {
        let input = ChatMessageInput(message: userMessage("a"), isLastInGroup: false)
        XCTAssertFalse(ChatMessageProjection.resolve(input).showTimestamp)
    }
}

// MARK: - State holder: wiring, edit interaction, telemetry, freshness

@MainActor final class ChatMessageModelTests: XCTestCase {
    private func makeModel(
        _ input: ChatMessageInput,
        telemetry: ChatMessageTelemetry = OSLogChatMessageTelemetry()
    ) -> (ChatMessageModel, InMemoryChatMessageSource) {
        let source = InMemoryChatMessageSource(initial: input)
        let model = ChatMessageModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var assistantInput: ChatMessageInput {
        ChatMessageInput(message: assistantMessage("hello"), isLastAssistant: true)
    }

    private var userInput: ChatMessageInput {
        ChatMessageInput(message: userMessage("hello"), isLastUser: true)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyChatTelemetry()
        let (model, source) = makeModel(assistantInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(spy.surfaces, [ChatMessageItem.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(ChatMessageInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(assistantInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(assistantInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ChatMessageInput(message: assistantMessage("hello"), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(ChatMessageInput(message: assistantMessage("hello"), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(assistantInput)
        model.start()
        source.push(ChatMessageInput(message: assistantMessage("hello"), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testBeginAndCancelEdit() {
        let (model, _) = makeModel(userInput)
        model.start()
        model.beginEdit()
        XCTAssertTrue(model.editing)
        XCTAssertEqual(model.draft, "hello")
        model.cancelEdit()
        XCTAssertFalse(model.editing)
        XCTAssertEqual(model.draft, "hello")
    }

    func testCommitEditWithChangeResendsAndExits() {
        let (model, source) = makeModel(userInput)
        model.start()
        model.beginEdit()
        model.draft = "edited question"
        XCTAssertTrue(model.canSubmitEdit)
        model.commitEdit()
        XCTAssertFalse(model.editing)
        XCTAssertEqual(source.resent.count, 1)
        XCTAssertEqual(source.resent.first?.text, "edited question")
        XCTAssertEqual(source.resent.first?.message.id, 1)
    }

    func testCommitEditUnchangedCancelsWithoutResend() {
        let (model, source) = makeModel(userInput)
        model.start()
        model.beginEdit()
        model.draft = "  hello "
        XCTAssertFalse(model.canSubmitEdit)
        model.commitEdit()
        XCTAssertFalse(model.editing)
        XCTAssertTrue(source.resent.isEmpty)
    }

    func testRegenerateDelegatesToSource() {
        let (model, source) = makeModel(assistantInput)
        model.start()
        model.regenerate()
        XCTAssertEqual(source.regenerated.count, 1)
        XCTAssertEqual(source.regenerated.first?.id, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(assistantInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(assistantInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ChatMessageItem.surfaceSlug, "ChatMessageItem")
    }
}

// MARK: - Accessibility summary content

@MainActor final class ChatAccessibilityTests: XCTestCase {
    func testMessageLabelWithTime() {
        XCTAssertEqual(
            ChatAccessibility.messageLabel(role: "Assistant", text: "Hello there", time: "10:13 PM"),
            "Assistant: Hello there, 10:13 PM"
        )
    }

    func testMessageLabelWithoutTime() {
        XCTAssertEqual(
            ChatAccessibility.messageLabel(role: "You", text: "Hi", time: nil),
            "You: Hi"
        )
        XCTAssertEqual(
            ChatAccessibility.messageLabel(role: "You", text: "Hi", time: ""),
            "You: Hi"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChatTelemetry: ChatMessageTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
