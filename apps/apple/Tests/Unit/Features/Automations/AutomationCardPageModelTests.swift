import XCTest
@testable import TeslaSync

/// State-machine + projection tests for `AutomationCardPageModel` — every render state the page
/// resolves (loading / empty / error-free loaded) plus the web callbacks applied as local
/// optimistic mutations (toggle / re-enable / delete / test-run / pin) and the live-flag freshness.
@MainActor final class AutomationCardPageModelTests: XCTestCase {
    private struct StubCard: AutomationCardProviding {
        let value: AutomationCardSnapshot
        init(_ value: AutomationCardSnapshot) {
            self.value = value
        }

        func snapshot() async -> AutomationCardSnapshot {
            value
        }
    }

    private func automation(
        id: Int64 = 1,
        enabled: Bool = true,
        autoDisabled: Bool = false,
        executionCount: Int64 = 10,
        isPinned: Bool = false
    ) -> AutomationCardData {
        AutomationCardData(
            id: id,
            name: "Precondition",
            enabled: enabled,
            autoDisabled: autoDisabled,
            autoDisabledReason: autoDisabled ? "Too many failures" : nil,
            executionCount: executionCount,
            isPinned: isPinned
        )
    }

    private func model(_ snapshot: AutomationCardSnapshot) -> AutomationCardPageModel {
        AutomationCardPageModel(provider: StubCard(snapshot), now: { Date(timeIntervalSince1970: 1_736_000_000) })
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let sut = model(AutomationCardSnapshot(automation: automation()))
        XCTAssertEqual(sut.state, .loading)
        XCTAssertNil(sut.automation)
    }

    func testLoadResolvesLoaded() async {
        let sut = model(AutomationCardSnapshot(automation: automation()))
        await sut.load()
        XCTAssertEqual(sut.state, .loaded(automation()))
        XCTAssertEqual(sut.automation?.id, 1)
    }

    func testLoadWithNoAutomationYieldsEmpty() async {
        let sut = model(AutomationCardSnapshot(automation: nil))
        await sut.load()
        XCTAssertEqual(sut.state, .empty)
        XCTAssertNil(sut.automation)
    }

    func testIsLoadingSnapshotStaysLoading() async {
        let sut = model(AutomationCardSnapshot(automation: automation(), isLoading: true))
        await sut.load()
        XCTAssertEqual(sut.state, .loading)
    }

    func testConnectionReflectsSnapshot() async {
        let sut = model(AutomationCardSnapshot(automation: automation(), connection: .offline))
        await sut.load()
        XCTAssertEqual(sut.connection, .offline)
    }

    func testDefaultProviderProducesLoaded() async {
        let sut = AutomationCardPageModel()
        await sut.load()
        XCTAssertNotNil(sut.automation)
        if case .loaded = sut.state {} else { XCTFail("expected loaded state") }
    }

    // MARK: - Callbacks (web onToggle / onReEnable / onDelete / onTestRun / pin)

    func testToggleFlipsEnabled() async {
        let sut = model(AutomationCardSnapshot(automation: automation(enabled: true)))
        await sut.load()
        sut.toggle(id: 1, enabled: false)
        XCTAssertEqual(sut.automation?.enabled, false)
    }

    func testReEnableClearsAutoDisabledLock() async {
        let sut = model(AutomationCardSnapshot(automation: automation(enabled: false, autoDisabled: true)))
        await sut.load()
        sut.reEnable(id: 1)
        XCTAssertEqual(sut.automation?.enabled, true)
        XCTAssertEqual(sut.automation?.autoDisabled, false)
        XCTAssertNil(sut.automation?.autoDisabledReason)
    }

    func testDeleteFallsToEmpty() async {
        let sut = model(AutomationCardSnapshot(automation: automation()))
        await sut.load()
        sut.delete(id: 1)
        XCTAssertEqual(sut.state, .empty)
    }

    func testDeleteIgnoresMismatchedId() async {
        let sut = model(AutomationCardSnapshot(automation: automation(id: 1)))
        await sut.load()
        sut.delete(id: 999)
        XCTAssertEqual(sut.automation?.id, 1)
    }

    func testTestRunBumpsExecutionAndLastRun() async {
        let sut = model(AutomationCardSnapshot(automation: automation(executionCount: 10)))
        await sut.load()
        sut.testRun(id: 1)
        XCTAssertEqual(sut.automation?.executionCount, 11)
        XCTAssertNotNil(sut.automation?.lastTriggeredAt)
    }

    func testTogglePinFlipsPinned() async {
        let sut = model(AutomationCardSnapshot(automation: automation(isPinned: false)))
        await sut.load()
        sut.togglePin(id: 1)
        XCTAssertEqual(sut.automation?.isPinned, true)
    }

    func testMutationIgnoredWhenNotLoaded() async {
        let sut = model(AutomationCardSnapshot(automation: nil))
        await sut.load()
        sut.toggle(id: 1, enabled: true)
        XCTAssertEqual(sut.state, .empty)
    }

    func testRefreshReloadsFromProvider() async {
        let sut = model(AutomationCardSnapshot(automation: automation()))
        sut.delete(id: 1)
        await sut.refresh()
        XCTAssertEqual(sut.automation?.id, 1)
    }

    // MARK: - Action bag wires the web callbacks

    func testActionsBagDispatchesToggle() async {
        let sut = model(AutomationCardSnapshot(automation: automation(enabled: true)))
        await sut.load()
        sut.actions.onToggle(1, false)
        XCTAssertEqual(sut.automation?.enabled, false)
    }

    func testActionsBagDispatchesDelete() async {
        let sut = model(AutomationCardSnapshot(automation: automation()))
        await sut.load()
        sut.actions.onDelete(1)
        XCTAssertEqual(sut.state, .empty)
    }
}
