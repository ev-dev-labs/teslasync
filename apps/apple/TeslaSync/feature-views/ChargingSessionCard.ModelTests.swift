//
//  ChargingSessionCard.ModelTests.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  State-holder coverage for the ChargingSessionCard surface: `ChargingSessionCardModel`
//  phase resolution across loading / loaded / empty / error (with the cached
//  fall-back), projection wiring, selection + open delegation, the P1/S11
//  `view.opened` telemetry, and connection tracking. Driven by the in-memory
//  source — no network, no real store.
//

import XCTest
@testable import TeslaSync

@MainActor
final class ChargingSessionCardModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargingSessionCardUpdate,
        telemetry: ChargingSessionCardTelemetry = OSLogChargingSessionCardTelemetry()
    ) -> (ChargingSessionCardModel, InMemoryChargingSessionCardSource) {
        let source = InMemoryChargingSessionCardSource(initial: update)
        let model = ChargingSessionCardModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: ChargingSessionSummary {
        ChargingSessionSummary(
            id: 7,
            chargerType: "Supercharger",
            startedAt: Date(timeIntervalSince1970: 0),
            endedAt: Date(timeIntervalSince1970: 2160),
            totalEnergyAddedWh: 42500,
            startSocPct: 18,
            endSocPct: 72
        )
    }

    func testPhaseResolution() {
        XCTAssertEqual(ChargingSessionCardModel.resolvePhase(ChargingSessionCardUpdate(status: .loading)), .loading)
        XCTAssertEqual(
            ChargingSessionCardModel.resolvePhase(ChargingSessionCardUpdate(status: .loaded, session: sample)),
            .loaded
        )
        XCTAssertEqual(ChargingSessionCardModel.resolvePhase(ChargingSessionCardUpdate(status: .loaded)), .empty)
        XCTAssertEqual(ChargingSessionCardModel.resolvePhase(ChargingSessionCardUpdate(status: .empty)), .empty)
        XCTAssertEqual(
            ChargingSessionCardModel.resolvePhase(ChargingSessionCardUpdate(status: .failed("boom"))),
            .error("boom")
        )
        XCTAssertEqual(
            ChargingSessionCardModel.resolvePhase(ChargingSessionCardUpdate(status: .failed("x"), session: sample)),
            .loaded
        )
        XCTAssertEqual(
            ChargingSessionCardModel.resolvePhase(ChargingSessionCardUpdate(status: .loading, session: sample)),
            .loaded
        )
    }

    func testLoadedExposesProjection() {
        let (model, _) = makeModel(ChargingSessionCardUpdate(status: .loaded, session: sample))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.projection?.category, .supercharger)
        XCTAssertEqual(model.projection?.scoreGrade, .gradeAPlus)
    }

    func testEmptyHasNoProjection() {
        let (model, _) = makeModel(ChargingSessionCardUpdate(status: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testErrorWithoutCache() {
        let (model, _) = makeModel(ChargingSessionCardUpdate(status: .failed("net")))
        model.start()
        XCTAssertEqual(model.phase, .error("net"))
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyChargingSessionCardTelemetry()
        let (model, source) = makeModel(ChargingSessionCardUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingSessionCardSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegate() {
        let (model, source) = makeModel(ChargingSessionCardUpdate(status: .loaded, session: sample))
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testToggleSelectUpdatesStateAndDelegates() {
        let (model, source) = makeModel(
            ChargingSessionCardUpdate(status: .loaded, session: sample, selectable: true)
        )
        model.start()
        XCTAssertFalse(model.selected)
        model.toggleSelect(true)
        XCTAssertTrue(model.selected)
        XCTAssertEqual(source.toggledTo, [true])
    }

    func testOpenDelegatesSessionId() {
        let (model, source) = makeModel(ChargingSessionCardUpdate(status: .loaded, session: sample))
        model.start()
        model.open()
        XCTAssertEqual(source.openedIds, [7])
    }

    func testConnectionTracksUpdates() {
        let (model, source) = makeModel(ChargingSessionCardUpdate(status: .loading))
        model.start()
        source.push(
            ChargingSessionCardUpdate(status: .loaded, connection: .offline, session: sample, updatedAt: Date())
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the P1/S11 contract can be asserted.
private final class SpyChargingSessionCardTelemetry: ChargingSessionCardTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
