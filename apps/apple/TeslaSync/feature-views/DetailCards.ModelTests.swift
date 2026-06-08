//
//  DetailCards.ModelTests.swift
//  TeslaSync — P4 feature view · 0153 · DetailCards (Apple)
//
//  State-holder coverage for the DetailCards surface, split from
//  `DetailCards.Tests.swift` to keep each test file focused: `DetailCardsModel`
//  phase resolution across loading / loaded / empty / error, projection wiring, the
//  P1/S11 `view.opened` telemetry + source wiring, and connection tracking. Driven
//  by `InMemoryDetailCardsSource` — no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class DetailCardsModelTests: XCTestCase {
    private func makeModel(
        _ update: DetailCardsUpdate,
        telemetry: DetailCardsTelemetry = OSLogDetailCardsTelemetry()
    ) -> (DetailCardsModel, InMemoryDetailCardsSource) {
        let source = InMemoryDetailCardsSource(initial: update)
        let model = DetailCardsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sampleHealth: DetailCardsHealth {
        DetailCardsHealth(frontMotorTempC: 48.0, rearMotorTempC: 52.5, inverterTempC: 41.2, batteryTempC: 33.8)
    }

    func testLoadingWithoutContentShowsLoading() {
        let (model, _) = makeModel(DetailCardsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isEmpty)
    }

    func testEmptyStatusShowsLoadedSoCardsRender() {
        let (model, _) = makeModel(DetailCardsUpdate(status: .empty))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isEmpty)
        XCTAssertEqual(model.temperatureRows.count, 4)
        XCTAssertTrue(model.temperatureRows.allSatisfy { $0.value == "—" })
        XCTAssertTrue(model.powerRows.allSatisfy { $0.value == "—" })
    }

    func testFailedWithoutContentShowsError() {
        let (model, _) = makeModel(DetailCardsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testContentPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(DetailCardsUpdate(status: .loading, health: sampleHealth))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(DetailCardsUpdate(status: .failed("net"), peakPower: 312))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertFalse(failed.isEmpty)
    }

    func testProjectionsAreComputedFromSnapshot() {
        let (model, _) = makeModel(
            DetailCardsUpdate(
                status: .loaded,
                health: sampleHealth,
                peakPower: 312,
                avgPowerMax: 128.6,
                minRegenPower: -64.3,
                stats: DetailCardsStats(regenEnergyWh: 248_600, co2SavedKg: 612.4)
            )
        )
        model.start()
        XCTAssertEqual(model.temperatureRows.first?.value, "48.0°C")
        XCTAssertEqual(model.powerRows.map(\.value), ["312 kW", "128.6 kW", "64.3 kW", "248.6 kWh", "612.4 kg"])
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDetailCardsTelemetry()
        let (model, source) = makeModel(DetailCardsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DetailCards.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DetailCardsUpdate(status: .loaded, health: sampleHealth))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndContentTrackUpdates() {
        let (model, source) = makeModel(DetailCardsUpdate(status: .loading))
        model.start()
        source.push(
            DetailCardsUpdate(
                status: .loaded,
                connection: .offline,
                health: sampleHealth,
                peakPower: 312,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDetailCardsTelemetry: DetailCardsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
