//
//  SessionList.Tests.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  Unit coverage for the SessionList surface:
//    • Adapter (`ChatSessionListProjection`) — phase resolution, the `displayTitle`
//      resolver (title → first-message preview → untitled, incl. the 60-char
//      ellipsis), the relative-time subtitle (web `formatRelative` thresholds), the
//      message-count label, and the trim helper.
//    • State holder (`ChatSessionListModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (once, re-armed on return to live), offline keeping cached rows, and the
//      intents (select — suppressed while renaming —, new chat, rename commit / empty
//      no-op / cancel, delete request / confirm / cancel, and the refresh reconcile).
//    • Accessibility — the row VoiceOver label + the list summary.
//
//  The Previews (SessionList.Previews.swift) are the per-state visual snapshots; these
//  headless tests assert the data + state machine behind each one. They run with no
//  network and no bundle: the adapter is pure and the model is driven through an
//  in-memory source with an injected localizer + clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection

@MainActor
final class ChatSessionListProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testResolvePhase() {
        XCTAssertEqual(ChatSessionListProjection.resolvePhase(.loading, totalCount: 0), .loading)
        XCTAssertEqual(ChatSessionListProjection.resolvePhase(.loading, totalCount: 3), .content)
        XCTAssertEqual(ChatSessionListProjection.resolvePhase(.loaded, totalCount: 0), .empty)
        XCTAssertEqual(ChatSessionListProjection.resolvePhase(.loaded, totalCount: 2), .content)
        XCTAssertEqual(ChatSessionListProjection.resolvePhase(.failed("x"), totalCount: 0), .error("x"))
        XCTAssertEqual(ChatSessionListProjection.resolvePhase(.failed("x"), totalCount: 4), .content)
    }

    func testDisplayTitlePrefersExplicitTitle() {
        let item = ChatSessionListItem(id: "1", title: "  Trip planning  ", firstMessage: "ignored")
        XCTAssertEqual(ChatSessionListProjection.displayTitle(item, localize: echo), "Trip planning")
    }

    func testDisplayTitleFallsBackToFirstMessage() {
        let item = ChatSessionListItem(id: "1", title: "   ", firstMessage: "  How is my battery?  ")
        XCTAssertEqual(ChatSessionListProjection.displayTitle(item, localize: echo), "How is my battery?")
    }

    func testDisplayTitleTruncatesLongFirstMessage() {
        let long = String(repeating: "a", count: 70)
        let item = ChatSessionListItem(id: "1", firstMessage: long)
        let title = ChatSessionListProjection.displayTitle(item, localize: echo)
        XCTAssertEqual(title.count, ChatSessionListProjection.titlePreviewLimit + 1)
        XCTAssertTrue(title.hasSuffix("…"))
    }

    func testDisplayTitleUntitledFallback() {
        let item = ChatSessionListItem(id: "1", title: nil, firstMessage: "   ")
        XCTAssertEqual(ChatSessionListProjection.displayTitle(item, localize: echo), "Untitled conversation")
    }

    func testMessageCountLabelSubstitutesCount() {
        XCTAssertEqual(ChatSessionListProjection.messageCountLabel(3, localize: echo), "3 msgs")
        XCTAssertEqual(ChatSessionListProjection.messageCountLabel(-5, localize: echo), "0 msgs")
    }

    func testTrimmedNonEmpty() {
        XCTAssertNil(ChatSessionListProjection.trimmedNonEmpty(nil))
        XCTAssertNil(ChatSessionListProjection.trimmedNonEmpty("   "))
        XCTAssertEqual(ChatSessionListProjection.trimmedNonEmpty("  hi "), "hi")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ChatSessionListSurface.slug, "SessionList")
        XCTAssertEqual(ChatSessionList.surfaceSlug, "SessionList")
    }
}

// MARK: - Adapter: relative time + subtitle

@MainActor
final class ChatSessionListRelativeTimeTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func label(secondsAgo: TimeInterval) -> String {
        ChatSessionListProjection.relativeLabel(
            for: now.addingTimeInterval(-secondsAgo),
            now: now,
            localize: echo
        )
    }

    func testRelativeThresholds() {
        XCTAssertEqual(label(secondsAgo: 10), "Just now")
        XCTAssertEqual(label(secondsAgo: 59), "Just now")
        XCTAssertEqual(label(secondsAgo: 60), "1m ago")
        XCTAssertEqual(label(secondsAgo: 59 * 60), "59m ago")
        XCTAssertEqual(label(secondsAgo: 60 * 60), "1h ago")
        XCTAssertEqual(label(secondsAgo: 23 * 3600), "23h ago")
        XCTAssertEqual(label(secondsAgo: 24 * 3600), "1d ago")
        XCTAssertEqual(label(secondsAgo: 6 * 86400), "6d ago")
    }

    func testRelativeFutureClampsToJustNow() {
        XCTAssertEqual(label(secondsAgo: -120), "Just now")
    }

    func testBeyondSevenDaysIsAbsolute() {
        let absolute = label(secondsAgo: 30 * 86400)
        XCTAssertFalse(absolute.contains("ago"))
        XCTAssertNotEqual(absolute, "Just now")
        XCTAssertFalse(absolute.isEmpty)
    }

    func testSubtitleJoinsActivityAndCount() {
        let recent = ChatSessionListItem(
            id: "1", messageCount: 3, lastMessageAt: now.addingTimeInterval(-90)
        )
        XCTAssertEqual(
            ChatSessionListProjection.subtitle(recent, now: now, localize: echo),
            "1m ago · 3 msgs"
        )
        let never = ChatSessionListItem(id: "2", messageCount: 0, lastMessageAt: nil)
        XCTAssertEqual(
            ChatSessionListProjection.subtitle(never, now: now, localize: echo),
            "Empty · 0 msgs"
        )
    }
}

// MARK: - Accessibility

@MainActor
final class ChatSessionListAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testListSummary() {
        XCTAssertEqual(
            ChatSessionListAccessibility.listSummary(count: 7, localize: echo),
            "Sessions: 7"
        )
    }

    func testRowLabelIncludesTitleSubtitleAndActiveSuffix() {
        let item = ChatSessionListItem(
            id: "1", title: "Trip planning", messageCount: 4,
            lastMessageAt: now.addingTimeInterval(-3600)
        )
        let label = ChatSessionListAccessibility.rowLabel(
            item, isActive: true, now: now, localize: echo
        )
        XCTAssertTrue(label.contains("Trip planning"))
        XCTAssertTrue(label.contains("1h ago"))
        XCTAssertTrue(label.contains("4 msgs"))
        XCTAssertTrue(label.contains("Active conversation"))
    }

    func testRowLabelOmitsActiveSuffixWhenInactive() {
        let item = ChatSessionListItem(id: "2", title: "Idle", messageCount: 0)
        let label = ChatSessionListAccessibility.rowLabel(
            item, isActive: false, now: now, localize: echo
        )
        XCTAssertFalse(label.contains("Active conversation"))
    }
}

// MARK: - Test doubles

final class SpyChatSessionListTelemetry: ChatSessionListTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@MainActor
final class RecordingChatSessionListActions: ChatSessionListActions {
    private(set) var selected: [String] = []
    private(set) var newChats = 0
    private(set) var renamed: [(id: String, title: String)] = []
    private(set) var deleted: [String] = []

    func selectSession(id: String) {
        selected.append(id)
    }

    func newChat() {
        newChats += 1
    }

    func renameSession(id: String, title: String) {
        renamed.append((id, title))
    }

    func deleteSession(id: String) {
        deleted.append(id)
    }
}

// MARK: - State holder

@MainActor
final class ChatSessionListModelTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func makeModel(
        _ update: ChatSessionListUpdate,
        telemetry: SpyChatSessionListTelemetry = SpyChatSessionListTelemetry(),
        actions: RecordingChatSessionListActions = RecordingChatSessionListActions()
    ) -> (ChatSessionListModel, InMemoryChatSessionListSource) {
        let source = InMemoryChatSessionListSource(initial: update)
        let model = ChatSessionListModel(
            source: source, telemetry: telemetry, actions: actions, localize: echo
        )
        return (model, source)
    }

    private func sample(count: Int) -> [ChatSessionListItem] {
        (1 ... count).map { ChatSessionListItem(id: "\($0)", title: "Session \($0)", messageCount: $0) }
    }

    func testPhaseResolvesFromStatusAndCount() {
        let (loading, _) = makeModel(.init(status: .loading, items: []))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (empty, _) = makeModel(.init(status: .loaded, items: []))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)
        XCTAssertTrue(empty.isEmpty)

        let (content, _) = makeModel(.init(status: .loaded, items: sample(count: 2), activeID: "2"))
        content.start()
        XCTAssertEqual(content.phase, .content)
        XCTAssertTrue(content.isActive(content.items[1]))

        let (failed, _) = makeModel(.init(status: .failed("boom"), items: []))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedOnce() {
        let telemetry = SpyChatSessionListTelemetry()
        let (model, _) = makeModel(.init(status: .loaded, items: sample(count: 1)), telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, ["SessionList"])
    }

    func testStaleAutoRefreshesOnceThenReArmsOnLive() {
        let (model, source) = makeModel(.init(status: .loaded, items: sample(count: 1), connection: .live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(.init(status: .loaded, items: sample(count: 1), connection: .stale))
        source.push(.init(status: .loaded, items: sample(count: 1), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale should auto-refresh exactly once")

        source.push(.init(status: .loaded, items: sample(count: 1), connection: .live))
        source.push(.init(status: .loaded, items: sample(count: 1), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "returning to live re-arms the stale auto-refresh")
    }

    func testOfflineKeepsCachedRowsWithoutRefreshing() {
        let (model, source) = makeModel(.init(status: .loaded, items: sample(count: 3), connection: .live))
        model.start()
        source.push(.init(status: .loaded, items: sample(count: 3), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 3)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testSelectIsSuppressedWhileRenaming() {
        let actions = RecordingChatSessionListActions()
        let (model, _) = makeModel(.init(status: .loaded, items: sample(count: 2)), actions: actions)
        model.start()
        model.startRename(model.items[0])
        model.selectSession(model.items[0])
        XCTAssertTrue(actions.selected.isEmpty)
        model.selectSession(model.items[1])
        XCTAssertEqual(actions.selected, ["2"])
    }

    func testNewChatForwardsToActions() {
        let actions = RecordingChatSessionListActions()
        let (model, _) = makeModel(.init(status: .loaded, items: sample(count: 1)), actions: actions)
        model.start()
        model.newChat()
        XCTAssertEqual(actions.newChats, 1)
    }

    func testRenameCommitsTrimmedNonEmptyDraft() {
        let actions = RecordingChatSessionListActions()
        let (model, _) = makeModel(.init(status: .loaded, items: sample(count: 1)), actions: actions)
        model.start()
        model.startRename(model.items[0])
        XCTAssertEqual(model.renamingID, "1")
        XCTAssertEqual(model.renameDraft, "Session 1")
        model.renameDraft = "  Renamed  "
        model.commitRename()
        XCTAssertEqual(actions.renamed.map(\.id), ["1"])
        XCTAssertEqual(actions.renamed.first?.title, "Renamed")
        XCTAssertNil(model.renamingID)
    }

    func testRenameEmptyDraftIsNoOpButExitsEdit() {
        let actions = RecordingChatSessionListActions()
        let (model, _) = makeModel(.init(status: .loaded, items: sample(count: 1)), actions: actions)
        model.start()
        model.startRename(model.items[0])
        model.renameDraft = "   "
        model.commitRename()
        XCTAssertTrue(actions.renamed.isEmpty)
        XCTAssertNil(model.renamingID)
    }

    func testCancelRenameDiscardsDraft() {
        let (model, _) = makeModel(.init(status: .loaded, items: sample(count: 1)))
        model.start()
        model.startRename(model.items[0])
        model.cancelRename()
        XCTAssertNil(model.renamingID)
        XCTAssertEqual(model.renameDraft, "")
    }

    func testDeleteRequestConfirmAndCancel() {
        let actions = RecordingChatSessionListActions()
        let (model, _) = makeModel(.init(status: .loaded, items: sample(count: 2)), actions: actions)
        model.start()
        model.requestDelete(model.items[0])
        XCTAssertEqual(model.pendingDelete?.id, "1")
        model.confirmDelete()
        XCTAssertEqual(actions.deleted, ["1"])
        XCTAssertNil(model.pendingDelete)

        model.requestDelete(model.items[1])
        model.cancelDelete()
        XCTAssertNil(model.pendingDelete)
        XCTAssertEqual(actions.deleted, ["1"], "cancel must not delete")
    }

    func testRefreshReconcilesTransientStateWhenItemDisappears() {
        let (model, source) = makeModel(.init(status: .loaded, items: sample(count: 2)))
        model.start()
        model.startRename(model.items[0])
        model.requestDelete(model.items[0])
        source.push(.init(status: .loaded, items: [ChatSessionListItem(id: "2", title: "Session 2")]))
        XCTAssertNil(model.renamingID, "rename state cleared when its session is gone")
        XCTAssertNil(model.pendingDelete, "pending delete cleared when its session is gone")
    }

    func testRefreshForwardsToSource() {
        let (model, source) = makeModel(.init(status: .failed("x"), items: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}
