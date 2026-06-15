import XCTest
@testable import TeslaSync

/// The replay behavior a stub source simulates (file-scope so it stays a single-level type
/// under the nesting rule).
private enum DLQReplayBehavior {
    case ok
    case disabledResult
    case gate403
    case otherError
}

/// State-machine tests for `DLQInspectorPageModel` — every data state the two panels render
/// (loading / empty / error / success), the inspect-drawer selection + lazy entry fetch, the
/// replay interaction (confirm staging, ok-closes-drawer, the `disabled` soft flag + the
/// HTTP-403 env gate both raising the banner, and a generic failure keeping the dialog open),
/// the replay-CTA guard, plus the pure display helpers ported from the web. Mirrors the
/// sibling `FeatureFlagsPageModelTests`.
@MainActor final class DLQInspectorPageModelTests: XCTestCase {
    private actor StubSource: DLQInspectorDataSource {
        var list: DLQListResult
        var fullByID: [Int64: DLQEntryFull]
        var audit: [DLQReplayAuditRecord]
        let listFails: Bool
        let entryFails: Bool
        let auditFails: Bool
        let replayBehavior: DLQReplayBehavior
        private(set) var replayCalls: [Int64] = []

        init(
            list: DLQListResult = DLQListResult(count: 0, replayEnabled: true, entries: []),
            fullByID: [Int64: DLQEntryFull] = [:],
            audit: [DLQReplayAuditRecord] = [],
            listFails: Bool = false,
            entryFails: Bool = false,
            auditFails: Bool = false,
            replayBehavior: DLQReplayBehavior = .ok
        ) {
            self.list = list
            self.fullByID = fullByID
            self.audit = audit
            self.listFails = listFails
            self.entryFails = entryFails
            self.auditFails = auditFails
            self.replayBehavior = replayBehavior
        }

        func loadList() async throws -> DLQListResult {
            if listFails { throw StubError() }
            return list
        }

        func loadEntry(id: Int64) async throws -> DLQEntryFull {
            if entryFails { throw StubError() }
            return fullByID[id] ?? DLQEntryFull(summary: DLQEntrySummary(id: id, arrivedAt: ""))
        }

        func loadAudit(limit _: Int) async throws -> [DLQReplayAuditRecord] {
            if auditFails { throw StubError() }
            return audit
        }

        func replay(id: Int64) async throws -> DLQReplayOutcome {
            replayCalls.append(id)
            switch replayBehavior {
            case .ok: return DLQReplayOutcome(result: .ok, dstTopic: "telemetry/replay")
            case .disabledResult: return DLQReplayOutcome(result: .disabled)
            case .gate403: throw DLQReplayDisabledError()
            case .otherError: throw StubError()
            }
        }
    }

    private struct StubError: Error {}

    private func entry(_ id: Int64, replayable: Bool = true) -> DLQEntrySummary {
        DLQEntrySummary(id: id, arrivedAt: "2026-06-14T03:12:48Z", parsedReason: "r", replayable: replayable)
    }

    private func listOf(_ rows: [DLQEntrySummary], replayEnabled: Bool = true) -> DLQListResult {
        DLQListResult(count: rows.count, replayEnabled: replayEnabled, entries: rows)
    }

    private func auditRow(_ id: Int64) -> DLQReplayAuditRecord {
        DLQReplayAuditRecord(id: id, replayedAt: "2026-06-14T01:20:14Z", dlqID: id, result: .ok)
    }

    // MARK: - List + audit states

    func testInitialStateIsLoading() {
        let model = DLQInspectorPageModel(dataSource: StubSource())
        XCTAssertEqual(model.listState, .loading)
        XCTAssertEqual(model.auditState, .loading)
        XCTAssertTrue(model.entries.isEmpty)
        XCTAssertTrue(model.auditRows.isEmpty)
    }

    func testLoadSuccessPopulatesBothFeeds() async {
        let model = DLQInspectorPageModel(dataSource: StubSource(
            list: listOf([entry(2), entry(1)]),
            audit: [auditRow(2), auditRow(1)]
        ))
        await model.load()
        XCTAssertEqual(model.entries.count, 2)
        XCTAssertEqual(model.auditRows.count, 2)
        XCTAssertTrue(model.replayEnabled)
        XCTAssertEqual(model.totalCount, 2)
        XCTAssertEqual(model.replayableCount, 2)
    }

    func testLoadEmptyYieldsEmptyStates() async {
        let model = DLQInspectorPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.listState, .empty)
        XCTAssertEqual(model.auditState, .empty)
    }

    func testLoadFailureYieldsErrorStates() async {
        let model = DLQInspectorPageModel(dataSource: StubSource(listFails: true, auditFails: true))
        await model.load()
        guard case .error = model.listState else { return XCTFail("expected list error") }
        guard case .error = model.auditState else { return XCTFail("expected audit error") }
    }

    func testReloadListIsIndependentOfAudit() async {
        let model = DLQInspectorPageModel(dataSource: StubSource(list: listOf([entry(1)]), auditFails: true))
        await model.load()
        XCTAssertEqual(model.entries.count, 1)
        guard case .error = model.auditState else { return XCTFail("expected audit error") }
    }

    // MARK: - Inspect + lazy entry fetch

    func testInspectStagesSelectionAndResetsEntryState() {
        let model = DLQInspectorPageModel(dataSource: StubSource())
        model.inspect(entry(5))
        XCTAssertEqual(model.selected?.id, 5)
        XCTAssertEqual(model.entryState, .loading)
    }

    func testLoadEntrySuccessAndFailure() async {
        let full = DLQEntryFull(summary: entry(7), innerPayloadB64: "aGk=")
        let okModel = DLQInspectorPageModel(dataSource: StubSource(fullByID: [7: full]))
        await okModel.loadEntry(7)
        guard case .loaded = okModel.entryState else { return XCTFail("expected loaded entry") }

        let failModel = DLQInspectorPageModel(dataSource: StubSource(entryFails: true))
        await failModel.loadEntry(7)
        guard case .error = failModel.entryState else { return XCTFail("expected entry error") }
    }

    func testCloseDrawerClearsSelection() {
        let model = DLQInspectorPageModel(dataSource: StubSource())
        model.inspect(entry(5))
        model.closeDrawer()
        XCTAssertNil(model.selected)
        XCTAssertEqual(model.entryState, .loading)
    }
}

/// Replay-flow + pure-helper tests (split into an extension so the primary `XCTestCase`
/// body stays within the lint budget).
extension DLQInspectorPageModelTests {
    // MARK: - Replay confirmation

    func testAskReplayStagesSelected() {
        let model = DLQInspectorPageModel(dataSource: StubSource())
        model.inspect(entry(5))
        model.askReplay()
        XCTAssertEqual(model.pendingReplay?.id, 5)
    }

    func testCancelReplayClearsPending() {
        let model = DLQInspectorPageModel(dataSource: StubSource())
        model.inspect(entry(5))
        model.askReplay()
        model.cancelReplay()
        XCTAssertNil(model.pendingReplay)
    }

    func testConfirmReplayOkClosesDrawerAndRefreshes() async {
        let source = StubSource(list: listOf([entry(5)]))
        let model = DLQInspectorPageModel(dataSource: source)
        await model.load()
        model.inspect(entry(5))
        model.askReplay()
        await model.confirmReplay()
        XCTAssertNil(model.selected)
        XCTAssertNil(model.pendingReplay)
        XCTAssertFalse(model.replayDisabledBanner)
        let calls = await source.replayCalls
        XCTAssertEqual(calls, [5])
    }

    func testConfirmReplayDisabledResultRaisesBanner() async {
        let model = DLQInspectorPageModel(dataSource: StubSource(replayBehavior: .disabledResult))
        model.inspect(entry(5))
        model.askReplay()
        await model.confirmReplay()
        XCTAssertTrue(model.replayDisabledBanner)
        XCTAssertNil(model.pendingReplay)
    }

    func testConfirmReplay403RaisesBannerAndClearsPending() async {
        let model = DLQInspectorPageModel(dataSource: StubSource(replayBehavior: .gate403))
        model.inspect(entry(5))
        model.askReplay()
        await model.confirmReplay()
        XCTAssertTrue(model.replayDisabledBanner)
        XCTAssertNil(model.pendingReplay)
        XCTAssertFalse(model.isReplaying)
    }

    func testConfirmReplayOtherErrorKeepsDialogOpen() async {
        let model = DLQInspectorPageModel(dataSource: StubSource(replayBehavior: .otherError))
        model.inspect(entry(5))
        model.askReplay()
        await model.confirmReplay()
        XCTAssertNotNil(model.pendingReplay)
        XCTAssertNotNil(model.replayError)
        XCTAssertFalse(model.isReplaying)
        XCTAssertFalse(model.replayDisabledBanner)
    }

    func testReplayCTADisabledReflectsGateAndReplayable() async {
        let enabled = DLQInspectorPageModel(dataSource: StubSource(list: listOf([entry(5)])))
        await enabled.load()
        enabled.inspect(entry(5))
        await enabled.loadEntry(5)
        XCTAssertFalse(enabled.replayCTADisabled)

        let gated = DLQInspectorPageModel(dataSource: StubSource(list: listOf([entry(5)], replayEnabled: false)))
        await gated.load()
        gated.inspect(entry(5))
        await gated.loadEntry(5)
        XCTAssertTrue(gated.replayCTADisabled)

        let unreplayable = DLQInspectorPageModel(dataSource: StubSource(list: listOf([entry(5, replayable: false)])))
        await unreplayable.load()
        unreplayable.inspect(entry(5, replayable: false))
        await unreplayable.loadEntry(5)
        XCTAssertTrue(unreplayable.replayCTADisabled)
    }

    // MARK: - Result badge tone (web `RESULT_VARIANT`)

    func testResultBadgeTone() {
        XCTAssertEqual(DLQResultBadge.tone(.ok), .success)
        XCTAssertEqual(DLQResultBadge.tone(.publishFailed), .danger)
        XCTAssertEqual(DLQResultBadge.tone(.unparseable), .danger)
        XCTAssertEqual(DLQResultBadge.tone(.rateLimited), .warning)
        XCTAssertEqual(DLQResultBadge.tone(.disabled), .warning)
        XCTAssertEqual(DLQResultBadge.tone(.notFound), .neutral)
    }

    // MARK: - Formatters (web `formatBytes` / `formatDateTime` / `decodeBase64Utf8`)

    func testBytesFormatter() {
        XCTAssertEqual(DLQInspectorFormat.bytes(-1), "—")
        XCTAssertEqual(DLQInspectorFormat.bytes(512), "512 B")
        XCTAssertEqual(DLQInspectorFormat.bytes(2048), "2.0 KB")
        XCTAssertEqual(DLQInspectorFormat.bytes(3_145_728), "3.0 MB")
    }

    func testDateTimeFormatsValidAndFallsBack() {
        XCTAssertEqual(DLQInspectorFormat.dateTime(nil), "—")
        XCTAssertEqual(DLQInspectorFormat.dateTime("not-a-date"), "—")
        XCTAssertNotEqual(DLQInspectorFormat.dateTime("2026-06-14T03:12:48Z"), "—")
    }

    func testDecodeBase64UTF8() {
        XCTAssertEqual(DLQInspectorFormat.decodeBase64UTF8("aGVsbG8="), "hello")
        XCTAssertNil(DLQInspectorFormat.decodeBase64UTF8(""))
        XCTAssertNil(DLQInspectorFormat.decodeBase64UTF8("////"))
    }

    // MARK: - Default seed

    func testSampleDataSourceSeedsAndReplays() async throws {
        let source = SampleDLQInspectorDataSource()
        let list = try await source.loadList()
        XCTAssertFalse(list.entries.isEmpty)
        XCTAssertTrue(list.replayEnabled)
        let audit = try await source.loadAudit(limit: 50)
        XCTAssertFalse(audit.isEmpty)

        let target = try XCTUnwrap(list.entries.first { $0.replayable })
        let full = try await source.loadEntry(id: target.id)
        XCTAssertEqual(full.id, target.id)

        let outcome = try await source.replay(id: target.id)
        XCTAssertEqual(outcome.result, .ok)
        let afterReplay = try await source.loadList()
        XCTAssertFalse(afterReplay.entries.contains { $0.id == target.id })
    }

    func testSampleHonorsDisabledGate() async {
        let source = SampleDLQInspectorDataSource(replayEnabled: false)
        do {
            _ = try await source.replay(id: 5021)
            XCTFail("expected DLQReplayDisabledError")
        } catch is DLQReplayDisabledError {
            // expected
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}
