import XCTest
@testable import TeslaSync

/// Behaviour tests for `ChatbotPageModel` + its `SampleChatbotSource` seam + the per-row
/// `ChatbotConversation` projection — driven through the in-memory source so the model's
/// transcript/state machine is exercised without a host or networking (web `ChatbotPage` logic).
@MainActor
final class ChatbotPageModelTests: XCTestCase {
    // MARK: - Sample source (the seam)

    func testSampleSourceVendsSessionsAndHistory() async {
        let source = SampleChatbotSource(variant: .populated)
        guard case let .success(sessions) = await source.useChatSessions() else {
            return XCTFail("expected sessions")
        }
        XCTAssertEqual(sessions.count, 2)
        guard case let .success(history) = await source.useChatHistory(sessionId: "s_today") else {
            return XCTFail("expected history")
        }
        XCTAssertEqual(history.count, 2)
        XCTAssertEqual(history.first?.role, .user)
    }

    func testSampleSourceEmptyVariant() async {
        let source = SampleChatbotSource(variant: .empty)
        guard case let .success(sessions) = await source.useChatSessions() else {
            return XCTFail("expected sessions")
        }
        XCTAssertTrue(sessions.isEmpty)
    }

    func testSampleSourceRenameAndDeleteMutate() async {
        let source = SampleChatbotSource(variant: .populated)
        _ = await source.useRenameChatSession(sessionId: "s_week", title: "Battery question")
        _ = await source.useDeleteChatSession(sessionId: "s_today")
        guard case let .success(sessions) = await source.useChatSessions() else {
            return XCTFail("expected sessions")
        }
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions.first?.id, "s_week")
        XCTAssertEqual(sessions.first?.title, "Battery question")
    }

    // MARK: - Model lifecycle + states

    func testLoadLeavesConversationEmptyWithoutSelection() async {
        let model = ChatbotPageModel(source: SampleChatbotSource(variant: .populated))
        await model.load()
        XCTAssertTrue(model.isConversationEmpty)
        XCTAssertEqual(model.historyStatus, .empty)
    }

    func testSelectSessionLoadsTranscript() async throws {
        let model = ChatbotPageModel(source: SampleChatbotSource(variant: .populated))
        await model.load()
        model.selectSession("s_today")
        try await waitUntil { model.historyStatus == .loaded }
        XCTAssertEqual(model.sessionID, "s_today")
        XCTAssertEqual(model.messages.count, 2)
        XCTAssertEqual(model.rows.count, 2)
    }

    func testPickFillsComposer() {
        let model = ChatbotPageModel(source: SampleChatbotSource())
        model.pick("Charging cost last 30 days")
        XCTAssertEqual(model.input, "Charging cost last 30 days")
    }

    func testSendAppendsUserTurnSynchronously() {
        let model = ChatbotPageModel(source: SampleChatbotSource())
        model.input = "  hello Helix  "
        model.send()
        XCTAssertEqual(model.input, "")
        XCTAssertEqual(model.messages.count, 1)
        XCTAssertEqual(model.messages.first?.role, .user)
        XCTAssertEqual(model.messages.first?.content, "hello Helix")
        XCTAssertTrue(model.isWaiting)
    }

    func testSendIgnoresBlankInput() {
        let model = ChatbotPageModel(source: SampleChatbotSource())
        model.input = "   "
        model.send()
        XCTAssertTrue(model.messages.isEmpty)
        XCTAssertFalse(model.isWaiting)
    }

    func testSendRevealsAssistantReply() async throws {
        let model = ChatbotPageModel(source: SampleChatbotSource())
        model.reduceMotion = true // skip the timed reveal — finalize immediately
        model.input = "what did my fleet do yesterday?"
        model.send()
        try await waitUntil {
            !model.isWaiting && !model.isStreaming && model.messages.contains { $0.role == .assistant }
        }
        let assistant = model.messages.filter { $0.role == .assistant }
        XCTAssertEqual(assistant.count, 1)
        XCTAssertFalse(assistant.first?.content.isEmpty ?? true)
        XCTAssertFalse(model.sessionID.isEmpty)
    }

    func testStartNewSessionClearsTranscript() async throws {
        let model = ChatbotPageModel(source: SampleChatbotSource(variant: .populated))
        await model.load()
        model.selectSession("s_today")
        try await waitUntil { model.messages.count == 2 }
        model.startNewSession()
        XCTAssertTrue(model.isConversationEmpty)
        XCTAssertEqual(model.sessionID, "")
    }

    // MARK: - Conversation projection (grouping + stable rows)

    func testConversationGroupsAndKeepsStableRows() {
        let conversation = ChatbotConversation()
        let messages = [
            ChatMessageData(id: -1, role: .user, content: "hi"),
            ChatMessageData(id: -2, role: .assistant, content: "hello")
        ]
        let first = conversation.sync(messages: messages, actionsDisabled: false)
        XCTAssertEqual(first.map(\.id), [-1, -2])
        let second = conversation.sync(messages: messages, actionsDisabled: true)
        // Same ids → the same cached model instances are returned (web stable `key`).
        XCTAssertTrue(first[0].model === second[0].model)
        XCTAssertTrue(first[1].model === second[1].model)
    }

    // MARK: - Helpers

    private func waitUntil(
        timeout: TimeInterval = 3,
        _ condition: @MainActor () -> Bool
    ) async throws {
        let start = Date()
        while !condition() {
            if Date().timeIntervalSince(start) > timeout {
                return XCTFail("condition not met within \(timeout)s")
            }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
    }
}
