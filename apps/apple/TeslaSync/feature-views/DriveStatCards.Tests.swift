//
//  DriveStatCards.Tests.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  Projection + state-holder coverage for the DriveStatCards surface:
//    • `DriveStatCardsProjection` — the eight-to-ten tile projection (values, conditional
//      cost tiles, em-dash empty fallback, icons, accents) + phase resolution, all parity
//      with the web `convertDistanceFromSI` / `formatDuration` / `fmtInt` / `fmtWithUnit` /
//      `useFormatting` / `energyWh > 0` rules.
//    • `DriveStatCardsModel` — phase resolution across loading / empty / error / content,
//      refresh delegation, stale auto-refresh, and the P1/S11 `view.opened` telemetry.
//
//  Conversion + accessibility coverage lives in DriveStatCards.AdapterTests.swift. These run
//  in the TeslaSync(/-macOS) XCTest targets with no network and no real store: the model is
//  driven by `InMemoryDriveStatCardsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Projection (web parity)

final class DriveStatCardsProjectionTests: XCTestCase {
    private let imperial = DriveStatCardsFormatting(
        distanceUnit: "mi", speedUnit: "mph", locale: "en-US",
        precision: 2, currencySymbol: "$", costPerKwh: 0.12
    )
    private let metric = DriveStatCardsFormatting(
        distanceUnit: "km", speedUnit: "km/h", locale: "en-US",
        precision: 2, currencySymbol: "$", costPerKwh: 0.12
    )

    private func fullInput() -> DriveStatCardsInput {
        DriveStatCardsInput(
            distanceM: 412_700,
            durationS: 16320,
            startBatteryPct: 88,
            endBatteryPct: 24,
            maxSpeed: 125,
            avgSpeed: 64,
            powerMax: 285,
            elevGain: 1240,
            elevLoss: 980,
            energyWh: 62400
        )
    }

    func testCardCountOrderAndIdentity() {
        let cards = DriveStatCardsProjection.cards(from: fullInput(), formatting: imperial)
        XCTAssertEqual(cards.count, 10)
        XCTAssertEqual(
            cards.map(\.id),
            [
                "distance", "duration", "maxSpeed", "avgSpeed", "soc",
                "maxPower", "elevGain", "elevLoss", "tripCost", "costPerUnit"
            ]
        )
    }

    func testImperialValuesMatchWeb() {
        let cards = DriveStatCardsProjection.cards(from: fullInput(), formatting: imperial)
        XCTAssertEqual(
            cards.map(\.value),
            [
                "256.4 mi", // distance  412700 m → mi @1dp
                "4h 32m", // duration  16320 s → 272 min
                "125 mph", // max speed (already display unit)
                "64 mph", // avg speed
                "88% → 24%", // SOC pair
                "285.00 kW", // max power @precision
                "1,240 m ↑", // elev gain (grouped, rounded)
                "980 m ↓", // elev loss
                "$7.49", // trip cost  62.4 kWh × $0.12
                "$0.029" // cost / mi  7.488 / 256.44
            ]
        )
    }

    func testMetricValuesMatchWeb() {
        let cards = DriveStatCardsProjection.cards(from: fullInput(), formatting: metric)
        XCTAssertEqual(cards[0].value, "412.7 km")
        XCTAssertEqual(cards[2].value, "125 km/h")
        XCTAssertEqual(cards[3].value, "64 km/h")
        XCTAssertEqual(cards[9].value, "$0.018") // 7.488 / 412.7
    }

    func testIconsAndAccents() {
        let cards = DriveStatCardsProjection.cards(from: fullInput(), formatting: imperial)
        XCTAssertEqual(
            cards.map(\.systemImage),
            [
                "point.topleft.down.to.point.bottomright.curvepath",
                "clock",
                "speedometer",
                "chart.line.uptrend.xyaxis",
                "battery.100",
                "bolt.fill",
                "location.north.fill",
                "location.north.fill",
                "dollarsign.circle.fill",
                "chart.line.downtrend.xyaxis"
            ]
        )
        XCTAssertEqual(
            cards.map(\.accent),
            [.cyan, .amber, .purple, .green, .green, .amber, .green, .red, .green, .teal]
        )
    }

    func testTripCostHiddenWhenNoEnergy() {
        let input = DriveStatCardsInput(distanceM: 412_700, energyWh: 0)
        let cards = DriveStatCardsProjection.cards(from: input, formatting: imperial)
        XCTAssertEqual(cards.count, 8)
        XCTAssertEqual(cards.last?.id, "elevLoss")
        XCTAssertFalse(cards.contains { $0.id == "tripCost" })
        XCTAssertFalse(cards.contains { $0.id == "costPerUnit" })
    }

    func testCostPerUnitHiddenWhenNoDistance() {
        // energyWh > 0 shows Trip Cost, but distanceM == 0 hides Cost / unit (web `&&`).
        let input = DriveStatCardsInput(distanceM: 0, energyWh: 62400)
        let cards = DriveStatCardsProjection.cards(from: input, formatting: imperial)
        XCTAssertEqual(cards.count, 9)
        XCTAssertEqual(cards.last?.id, "tripCost")
        XCTAssertFalse(cards.contains { $0.id == "costPerUnit" })
    }

    func testNilInputRendersEightEmDashTiles() {
        let cards = DriveStatCardsProjection.cards(from: nil, formatting: imperial)
        XCTAssertEqual(cards.count, 8)
        XCTAssertTrue(cards.allSatisfy { $0.value == DriveStatCardsProjection.emDash })
        XCTAssertEqual(
            cards.map(\.id),
            ["distance", "duration", "maxSpeed", "avgSpeed", "soc", "maxPower", "elevGain", "elevLoss"]
        )
    }

    func testSocNilBatteryRendersZeroPair() {
        let input = DriveStatCardsInput(distanceM: 100, startBatteryPct: nil, endBatteryPct: nil)
        let cards = DriveStatCardsProjection.cards(from: input, formatting: imperial)
        XCTAssertEqual(cards.first { $0.id == "soc" }?.value, "0% → 0%")
    }

    func testSafeAppliesToNonFiniteSpeed() {
        let input = DriveStatCardsInput(distanceM: 100, maxSpeed: .nan, avgSpeed: .infinity)
        let cards = DriveStatCardsProjection.cards(from: input, formatting: imperial)
        XCTAssertEqual(cards.first { $0.id == "maxSpeed" }?.value, "0 mph")
        XCTAssertEqual(cards.first { $0.id == "avgSpeed" }?.value, "0 mph")
    }

    func testCostPerUnitCarriesInterpolationArgument() {
        let cards = DriveStatCardsProjection.cards(from: fullInput(), formatting: imperial)
        let cost = cards.first { $0.id == "costPerUnit" }
        XCTAssertEqual(cost?.labelKey, "driveDetail.costPerUnit")
        XCTAssertEqual(cost?.labelFallback, "Cost / %@")
        XCTAssertEqual(cost?.labelArgs, ["mi"])
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.loading, hasValue: false), .loading)
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.loading, hasValue: true), .content)
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.empty, hasValue: false), .empty)
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.empty, hasValue: true), .empty)
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.loaded, hasValue: false), .empty)
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.loaded, hasValue: true), .content)
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.failed("e"), hasValue: false), .error("e"))
        XCTAssertEqual(DriveStatCardsProjection.resolvePhase(.failed("e"), hasValue: true), .content)
    }

    func testAccentColorsAreDistinctForBrandHues() {
        // purple/teal map to fixed brand chart-series colors (no semantic token); guard they
        // are not silently folded onto the cyan accent.
        XCTAssertNotEqual(DriveStatCardsAccent.purple.color, DriveStatCardsAccent.cyan.color)
        XCTAssertNotEqual(DriveStatCardsAccent.teal.color, DriveStatCardsAccent.cyan.color)
        XCTAssertNotEqual(DriveStatCardsAccent.red.color, DriveStatCardsAccent.green.color)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class DriveStatCardsModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveStatCardsUpdate,
        telemetry: DriveStatCardsTelemetry = OSLogDriveStatCardsTelemetry()
    ) -> (DriveStatCardsModel, InMemoryDriveStatCardsSource) {
        let source = InMemoryDriveStatCardsSource(initial: update)
        let model = DriveStatCardsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleInput() -> DriveStatCardsInput {
        DriveStatCardsInput(
            distanceM: 412_700,
            durationS: 16320,
            startBatteryPct: 88,
            endBatteryPct: 24,
            maxSpeed: 125,
            avgSpeed: 64,
            powerMax: 285,
            elevGain: 1240,
            elevLoss: 980,
            energyWh: 62400
        )
    }

    private func loaded(_ connection: DriveStatCardsConnection = .live) -> DriveStatCardsUpdate {
        DriveStatCardsUpdate(
            status: .loaded,
            input: sampleInput(),
            formatting: DriveStatCardsFormatting(
                distanceUnit: "mi", speedUnit: "mph", locale: "en-US",
                precision: 2, currencySymbol: "$", costPerKwh: 0.12
            ),
            connection: connection,
            updatedAt: Date()
        )
    }

    func testInitialContentPhaseAndCards() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 10)
        XCTAssertEqual(model.cards[0].value, "256.4 mi")
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(DriveStatCardsUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(DriveStatCardsUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testEmptyPhaseStillProjectsEmDashTiles() {
        let (model, _) = makeModel(DriveStatCardsUpdate(status: .empty, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.cards.count, 8)
        XCTAssertTrue(model.cards.allSatisfy { $0.value == DriveStatCardsProjection.emDash })
    }

    func testCachedInputStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(
            DriveStatCardsUpdate(
                status: .failed("net"),
                input: sampleInput(),
                formatting: DriveStatCardsFormatting(distanceUnit: "mi", speedUnit: "mph"),
                connection: .stale
            )
        )
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
        let spy = SpyDriveStatCardsTelemetry()
        let (model, source) = makeModel(DriveStatCardsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveStatCards.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(DriveStatCardsUpdate(status: .loading))
        model.start()
        source.push(
            DriveStatCardsUpdate(
                status: .loaded,
                input: sampleInput(),
                formatting: DriveStatCardsFormatting(distanceUnit: "mi", speedUnit: "mph"),
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
private final class SpyDriveStatCardsTelemetry: DriveStatCardsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
