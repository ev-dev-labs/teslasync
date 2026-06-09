//
//  StatusHeader.Tests.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  Projection + state-holder coverage for the StatusHeader surface:
//    • `StatusHeaderProjection` — the three-card projection (values, em-dash no-data fallback,
//      icons, sublabels) + phase resolution + the `replay_enabled` warning-banner gate, all
//      parity with the web `fmtInt` / `entries.filter(replayable)` / `enabled ? … : …` rules.
//    • `StatusHeaderModel` — phase resolution across loading / empty / error / content, refresh
//      delegation, stale auto-refresh, the disabled-banner gate, and the P1/S11 `view.opened`
//      telemetry.
//
//  Conversion + accessibility coverage lives in StatusHeader.AdapterTests.swift. These run in
//  the TeslaSync(/-macOS) XCTest targets with no network and no real store: the model is driven
//  by `InMemoryStatusHeaderSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Projection (web parity)

@MainActor final class StatusHeaderProjectionTests: XCTestCase {
    private func populated(_ replayEnabled: Bool = true) -> StatusHeaderInput {
        StatusHeaderInput(totalCount: 1284, replayableCount: 912, replayEnabled: replayEnabled)
    }

    func testCardCountOrderAndIdentity() {
        let cards = StatusHeaderProjection.cards(from: populated())
        XCTAssertEqual(cards.count, 3)
        XCTAssertEqual(cards.map(\.id), ["total", "replayable", "replayMode"])
    }

    func testCardValuesMatchWeb() {
        let cards = StatusHeaderProjection.cards(from: populated())
        XCTAssertEqual(cards[0].value, .text("1,284"))
        XCTAssertEqual(cards[1].value, .text("912"))
        XCTAssertEqual(cards[2].value, .localized(key: "admin.dlq.stats.enabled", fallback: "Enabled"))
    }

    func testReplayModeValueWhenDisabled() {
        let cards = StatusHeaderProjection.cards(from: populated(false))
        XCTAssertEqual(cards[2].value, .localized(key: "admin.dlq.stats.disabled", fallback: "Disabled"))
    }

    func testZeroCountsStillRenderGroupedZero() {
        let cards = StatusHeaderProjection.cards(
            from: StatusHeaderInput(totalCount: 0, replayableCount: 0, replayEnabled: true)
        )
        XCTAssertEqual(cards[0].value, .text("0"))
        XCTAssertEqual(cards[1].value, .text("0"))
    }

    func testNilInputRendersThreeEmDashCards() {
        let cards = StatusHeaderProjection.cards(from: nil)
        XCTAssertEqual(cards.count, 3)
        XCTAssertTrue(cards.allSatisfy { $0.value == .text(StatusHeaderProjection.emDash) })
        XCTAssertEqual(cards.map(\.id), ["total", "replayable", "replayMode"])
    }

    func testLabelsSublabelsAndIcons() {
        let cards = StatusHeaderProjection.cards(from: populated())
        XCTAssertEqual(
            cards.map(\.labelKey),
            ["admin.dlq.stats.total", "admin.dlq.stats.replayable", "admin.dlq.stats.replayMode"]
        )
        XCTAssertEqual(
            cards.map(\.sublabelKey),
            ["admin.dlq.stats.totalSub", "admin.dlq.stats.replayableSub", "admin.dlq.stats.replayModeSub"]
        )
        XCTAssertEqual(cards.map(\.systemImage), ["tray.full", "checkmark.shield", "exclamationmark.octagon"])
    }

    func testReplayableCountFiltersTrueFlags() {
        // Web `entries.filter((e) => e.replayable).length`.
        XCTAssertEqual(StatusHeaderProjection.replayableCount(in: [true, false, true, true, false]), 3)
        XCTAssertEqual(StatusHeaderProjection.replayableCount(in: []), 0)
        XCTAssertEqual(StatusHeaderProjection.replayableCount(in: [false, false]), 0)
        XCTAssertEqual(StatusHeaderProjection.replayableCount(in: [true, true]), 2)
    }

    func testResolvePhaseMatrix() {
        let populatedInput = populated()
        let emptyInput = StatusHeaderInput(totalCount: 0, replayableCount: 0, replayEnabled: true)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.loading, input: nil), .loading)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.loading, input: populatedInput), .content)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.loading, input: emptyInput), .empty)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.loaded, input: nil), .empty)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.loaded, input: populatedInput), .content)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.loaded, input: emptyInput), .empty)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.failed("e"), input: nil), .error("e"))
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.failed("e"), input: populatedInput), .content)
        XCTAssertEqual(StatusHeaderProjection.resolvePhase(.failed("e"), input: emptyInput), .empty)
    }

    func testShowsDisabledBannerGate() {
        let disabled = populated(false)
        let enabled = populated(true)
        XCTAssertTrue(StatusHeaderProjection.showsDisabledBanner(phase: .content, input: disabled))
        XCTAssertTrue(StatusHeaderProjection.showsDisabledBanner(phase: .empty, input: disabled))
        XCTAssertFalse(StatusHeaderProjection.showsDisabledBanner(phase: .content, input: enabled))
        XCTAssertFalse(StatusHeaderProjection.showsDisabledBanner(phase: .loading, input: disabled))
        XCTAssertFalse(StatusHeaderProjection.showsDisabledBanner(phase: .error("e"), input: disabled))
        XCTAssertFalse(StatusHeaderProjection.showsDisabledBanner(phase: .empty, input: nil))
    }
}

// MARK: - State holder: phases + refresh + telemetry + banner

@MainActor final class StatusHeaderModelTests: XCTestCase {
    private func makeModel(
        _ update: StatusHeaderUpdate,
        telemetry: StatusHeaderTelemetry = OSLogStatusHeaderTelemetry()
    ) -> (StatusHeaderModel, InMemoryStatusHeaderSource) {
        let source = InMemoryStatusHeaderSource(initial: update)
        let model = StatusHeaderModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func populated(_ replayEnabled: Bool = true) -> StatusHeaderInput {
        StatusHeaderInput(totalCount: 1284, replayableCount: 912, replayEnabled: replayEnabled)
    }

    private func loaded(
        _ connection: StatusHeaderConnection = .live,
        replayEnabled: Bool = true
    ) -> StatusHeaderUpdate {
        StatusHeaderUpdate(
            status: .loaded,
            input: populated(replayEnabled),
            connection: connection,
            updatedAt: Date()
        )
    }

    func testInitialContentPhaseAndCards() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 3)
        XCTAssertEqual(model.cards[0].value, .text("1,284"))
        XCTAssertFalse(model.disabledBannerVisible)
    }

    func testDisabledBannerVisibleWhenReplayDisabled() {
        let (model, _) = makeModel(loaded(replayEnabled: false))
        model.start()
        XCTAssertTrue(model.disabledBannerVisible)
        XCTAssertEqual(model.cards[2].value, .localized(key: "admin.dlq.stats.disabled", fallback: "Disabled"))
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(StatusHeaderUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(StatusHeaderUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
        XCTAssertFalse(failed.disabledBannerVisible)
    }

    func testEmptyPhaseRendersZeroCardsAndHintEligible() {
        let (model, _) = makeModel(
            StatusHeaderUpdate(
                status: .loaded,
                input: StatusHeaderInput(totalCount: 0, replayableCount: 0, replayEnabled: false)
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.cards[0].value, .text("0"))
        XCTAssertTrue(model.disabledBannerVisible)
    }

    func testCachedInputStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(StatusHeaderUpdate(status: .failed("net"), input: populated(), connection: .stale))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(loaded(.live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(.stale))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(.live))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyStatusHeaderTelemetry()
        let (model, source) = makeModel(StatusHeaderUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [StatusHeader.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(StatusHeaderUpdate(status: .loading))
        model.start()
        source.push(
            StatusHeaderUpdate(
                status: .loaded,
                input: populated(),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyStatusHeaderTelemetry: StatusHeaderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
