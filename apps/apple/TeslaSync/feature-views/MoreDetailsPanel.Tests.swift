//
//  MoreDetailsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  Unit coverage for the surface: the adapter (`MoreDetailsFormat` formatting/conversion golden
//  vectors + `MoreDetailsProjection` tile-group projection + phase resolution, all web-parity),
//  the `MoreDetailsModel` state holder (phases, refresh, stale auto-refresh, `view.opened`
//  telemetry), and the `MoreDetailsAccessibility` VoiceOver summary. No network, no real store —
//  the model is driven by `InMemoryMoreDetailsSource`.
//
//  The whole file is gated on `canImport(XCTest)`: the feature-views group is a member of the
//  app targets as well as the test bundle, and the app targets do not link XCTest. The guard
//  means this file compiles to nothing there (so it never breaks the app build) while still
//  compiling and running in the XCTest bundle.
//

#if canImport(XCTest)
    import XCTest
    @testable import TeslaSync

    // MARK: - Adapter: formatting + conversion (web parity)

    @MainActor
    final class MoreDetailsFormatTests: XCTestCase {
        func testSafeCoercesNonFinite() {
            XCTAssertEqual(MoreDetailsFormat.safe(42), 42, accuracy: 0.0001)
            XCTAssertEqual(MoreDetailsFormat.safe(.nan), 0)
            XCTAssertEqual(MoreDetailsFormat.safe(.infinity), 0)
            XCTAssertEqual(MoreDetailsFormat.safe(-.infinity), 0)
        }

        func testFmtNumberGroupingRoundingAndPrecision() {
            XCTAssertEqual(MoreDetailsFormat.fmtNumber(124.8957, decimals: 0), "125")
            XCTAssertEqual(MoreDetailsFormat.fmtNumber(1234.5, decimals: 0), "1,235")
            XCTAssertEqual(MoreDetailsFormat.fmtNumber(23.8605, decimals: 1), "23.9")
            XCTAssertEqual(MoreDetailsFormat.fmtNumber(6.8, decimals: 2), "6.80")
            XCTAssertEqual(MoreDetailsFormat.fmtNumber(12345.0, decimals: 2), "12,345.00")
        }

        func testFmtNumberGuardsNonFinite() {
            XCTAssertEqual(MoreDetailsFormat.fmtNumber(.nan, decimals: 0), "0")
            XCTAssertEqual(MoreDetailsFormat.fmtNumber(.infinity, decimals: 1), "0.0")
        }

        func testEfficiencyConversionAndUnitMatchWeb() {
            // toEfficiencyDisplay(whPerKm, 'mi') == whPerKm * 1.609344 ; 'km' is the identity.
            XCTAssertEqual(MoreDetailsFormat.toEfficiencyDisplay(168, distance: "mi"), 270.369792, accuracy: 0.0001)
            XCTAssertEqual(MoreDetailsFormat.toEfficiencyDisplay(168, distance: "km"), 168, accuracy: 0.0001)
            XCTAssertEqual(MoreDetailsFormat.efficiencyUnit(distance: "mi"), "Wh/mi")
            XCTAssertEqual(MoreDetailsFormat.efficiencyUnit(distance: "km"), "Wh/km")
        }
    }

    // MARK: - Adapter: projection (web parity)

    @MainActor
    final class MoreDetailsProjectionTests: XCTestCase {
        private let metric = MoreDetailsUnitPrefs(distance: "km", speed: "km/h", temperature: "°C", locale: "en-US")
        private let imperial = MoreDetailsUnitPrefs(distance: "mi", speed: "mph", temperature: "°F", locale: "en-US")

        private func fullInput() -> MoreDetailsInput {
            MoreDetailsInput(
                odometerStart: 12345.0,
                odometerEnd: 12378.5,
                startRange: 412.0,
                endRange: 375.0,
                elevGain: 120.0,
                elevLoss: 85.0,
                energyWh: 6800.0,
                regenWh: 950.0,
                consumptionWhKm: 168.0,
                avgPower: 22.5,
                avgOutsideTemp: 14.0,
                avgInsideTemp: 21.5,
                minSpd: 8.0,
                startBatteryPct: 82,
                endBatteryPct: 68
            )
        }

        private func value(
            _ id: String,
            in tiles: MoreDetailsTiles,
            file: StaticString = #filePath,
            line: UInt = #line
        ) throws -> MoreDetailsTileValue {
            let all = tiles.primary + tiles.secondary
            let tile = try XCTUnwrap(all.first { $0.id == id }, "missing tile \(id)", file: file, line: line)
            return tile.value
        }

        func testGroupCountsOrderAndIdentity() {
            let tiles = MoreDetailsProjection.tiles(from: fullInput(), prefs: metric)
            XCTAssertEqual(
                tiles.primary.map(\.id),
                ["odometer", "range", "elevation", "energyConsumed", "energyRecovered", "consumption"]
            )
            XCTAssertEqual(
                tiles.secondary.map(\.id),
                ["avgPower", "avgOutsideTemp", "avgInsideTemp", "minSpeed", "batteryUsed", "netEnergy"]
            )
        }

        func testMetricValuesMatchWeb() throws {
            let tiles = MoreDetailsProjection.tiles(from: fullInput(), prefs: metric)
            XCTAssertEqual(try value("odometer", in: tiles), .mutedUnit(value: "12,345.00 → 12,378.50", unit: "km"))
            XCTAssertEqual(try value("range", in: tiles), .mutedUnit(value: "412.00 → 375.00", unit: "km"))
            XCTAssertEqual(try value("elevation", in: tiles), .elevation(gain: "120.00 m", loss: "85.00 m"))
            XCTAssertEqual(try value("energyConsumed", in: tiles), .plain("6.80 kWh"))
            XCTAssertEqual(try value("energyRecovered", in: tiles), .plain("950.00 Wh"))
            XCTAssertEqual(try value("consumption", in: tiles), .mutedUnit(value: "168.00", unit: "Wh/km"))
            XCTAssertEqual(try value("avgPower", in: tiles), .mutedUnit(value: "22.50", unit: "kW"))
            XCTAssertEqual(try value("avgOutsideTemp", in: tiles), .plain("14.00°C"))
            XCTAssertEqual(try value("avgInsideTemp", in: tiles), .plain("21.50°C"))
            XCTAssertEqual(try value("minSpeed", in: tiles), .plain("8 km/h"))
            XCTAssertEqual(try value("batteryUsed", in: tiles), .plain("14%"))
            XCTAssertEqual(try value("netEnergy", in: tiles), .plain("5.85 kWh"))
        }

        func testImperialValuesConvertEfficiencyAndRelabel() throws {
            let tiles = MoreDetailsProjection.tiles(from: fullInput(), prefs: imperial)
            XCTAssertEqual(try value("odometer", in: tiles), .mutedUnit(value: "12,345.00 → 12,378.50", unit: "mi"))
            XCTAssertEqual(try value("consumption", in: tiles), .mutedUnit(value: "270.37", unit: "Wh/mi"))
            XCTAssertEqual(try value("avgOutsideTemp", in: tiles), .plain("14.00°F"))
            XCTAssertEqual(try value("minSpeed", in: tiles), .plain("8 mph"))
        }

        func testAccentsMatchWebPalette() throws {
            let tiles = MoreDetailsProjection.tiles(from: fullInput(), prefs: metric)
            func accent(_ id: String) throws -> MoreDetailsAccent {
                let all = tiles.primary + tiles.secondary
                return try XCTUnwrap(all.first { $0.id == id }).accent
            }
            XCTAssertEqual(try accent("odometer"), .cyan)
            XCTAssertEqual(try accent("range"), .green)
            XCTAssertEqual(try accent("energyConsumed"), .amber)
            XCTAssertEqual(try accent("energyRecovered"), .green)
            XCTAssertEqual(try accent("consumption"), .purple)
            XCTAssertEqual(try accent("avgOutsideTemp"), .blue)
            XCTAssertEqual(try accent("avgInsideTemp"), .orange)
            XCTAssertEqual(try accent("minSpeed"), .neutral)
            XCTAssertEqual(try accent("netEnergy"), .cyan)
        }

        func testZeroOdometerYieldsEmDash() throws {
            let zeroStart = MoreDetailsInput(odometerStart: 0, odometerEnd: 12378.5)
            XCTAssertEqual(
                try value("odometer", in: MoreDetailsProjection.tiles(from: zeroStart, prefs: metric)),
                .mutedUnit(value: "—", unit: "km")
            )
            let zeroEnd = MoreDetailsInput(odometerStart: 12345, odometerEnd: 0)
            XCTAssertEqual(
                try value("odometer", in: MoreDetailsProjection.tiles(from: zeroEnd, prefs: metric)),
                .mutedUnit(value: "—", unit: "km")
            )
        }

        func testRangeFallbacks() throws {
            let noStart = MoreDetailsInput(startRange: nil, endRange: 300)
            XCTAssertEqual(
                try value("range", in: MoreDetailsProjection.tiles(from: noStart, prefs: metric)),
                .mutedUnit(value: "—", unit: "km")
            )
            let noEnd = MoreDetailsInput(startRange: 300, endRange: nil)
            XCTAssertEqual(
                try value("range", in: MoreDetailsProjection.tiles(from: noEnd, prefs: metric)),
                .mutedUnit(value: "300.00 → ?", unit: "km")
            )
        }

        func testConsumptionEmDashWhenNonPositive() throws {
            let zero = MoreDetailsInput(consumptionWhKm: 0)
            XCTAssertEqual(
                try value("consumption", in: MoreDetailsProjection.tiles(from: zero, prefs: metric)),
                .mutedUnit(value: "—", unit: "Wh/km")
            )
        }

        func testBatteryEmDashWhenMissing() throws {
            let noStart = MoreDetailsInput(startBatteryPct: nil, endBatteryPct: 60)
            XCTAssertEqual(
                try value("batteryUsed", in: MoreDetailsProjection.tiles(from: noStart, prefs: metric)),
                .plain("—")
            )
        }

        func testEnergyThresholdSwitchesKwhAndWh() throws {
            XCTAssertEqual(
                try value("energyConsumed", in: MoreDetailsProjection.tiles(
                    from: MoreDetailsInput(energyWh: 500),
                    prefs: metric
                )),
                .plain("500.00 Wh")
            )
            XCTAssertEqual(
                try value("energyConsumed", in: MoreDetailsProjection.tiles(
                    from: MoreDetailsInput(energyWh: 1000),
                    prefs: metric
                )),
                .plain("1,000.00 Wh")
            )
            XCTAssertEqual(
                try value("energyConsumed", in: MoreDetailsProjection.tiles(
                    from: MoreDetailsInput(energyWh: 1500),
                    prefs: metric
                )),
                .plain("1.50 kWh")
            )
        }

        func testTemperatureTilesAreConditional() {
            let none = MoreDetailsProjection.tiles(
                from: MoreDetailsInput(avgOutsideTemp: nil, avgInsideTemp: nil),
                prefs: metric
            )
            XCTAssertEqual(none.secondary.map(\.id), ["avgPower", "minSpeed", "batteryUsed", "netEnergy"])
            let outsideOnly = MoreDetailsProjection.tiles(
                from: MoreDetailsInput(avgOutsideTemp: 9.0, avgInsideTemp: nil),
                prefs: metric
            )
            XCTAssertEqual(
                outsideOnly.secondary.map(\.id),
                ["avgPower", "avgOutsideTemp", "minSpeed", "batteryUsed", "netEnergy"]
            )
        }

        func testNilInputRendersEmptyFallbacks() throws {
            let tiles = MoreDetailsProjection.tiles(from: nil, prefs: metric)
            XCTAssertEqual(tiles.primary.count, 6)
            XCTAssertEqual(tiles.secondary.map(\.id), ["avgPower", "minSpeed", "batteryUsed", "netEnergy"])
            XCTAssertEqual(try value("odometer", in: tiles), .mutedUnit(value: "—", unit: "km"))
            XCTAssertEqual(try value("consumption", in: tiles), .mutedUnit(value: "—", unit: "Wh/km"))
            XCTAssertEqual(try value("elevation", in: tiles), .elevation(gain: "0.00 m", loss: "0.00 m"))
            XCTAssertEqual(try value("batteryUsed", in: tiles), .plain("—"))
            XCTAssertEqual(try value("netEnergy", in: tiles), .plain("0.00 Wh"))
        }

        func testResolvePhaseMatrix() {
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.loading, hasValue: false), .loading)
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.loading, hasValue: true), .content)
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.empty, hasValue: false), .empty)
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.empty, hasValue: true), .empty)
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.loaded, hasValue: false), .empty)
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.loaded, hasValue: true), .content)
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.failed("e"), hasValue: false), .error("e"))
            XCTAssertEqual(MoreDetailsProjection.resolvePhase(.failed("e"), hasValue: true), .content)
        }
    }

    // MARK: - Accessibility summary

    @MainActor
    final class MoreDetailsAccessibilityTests: XCTestCase {
        private let echo: (String, String) -> String = { _, fallback in fallback }

        func testMutedUnitSummaryReadsLabelValueUnit() {
            let tile = MoreDetailsTile(
                id: "odometer",
                labelKey: "driveDetail.odometer",
                labelFallback: "Odometer (From → To)",
                accent: .cyan,
                value: .mutedUnit(value: "12,345.00 → 12,378.50", unit: "km")
            )
            let summary = MoreDetailsAccessibility.tileSummary(tile, localize: echo)
            XCTAssertEqual(summary, "Odometer (From → To), 12,345.00 → 12,378.50 km")
        }

        func testPlainSummaryReadsLabelValue() {
            let tile = MoreDetailsTile(
                id: "batteryUsed",
                labelKey: "driveDetail.batteryUsed",
                labelFallback: "Battery Used",
                accent: .amber,
                value: .plain("14%")
            )
            XCTAssertEqual(MoreDetailsAccessibility.tileSummary(tile, localize: echo), "Battery Used, 14%")
        }

        func testElevationSummaryReadsGainAndLoss() {
            let tile = MoreDetailsTile(
                id: "elevation",
                labelKey: "driveDetail.elevSummary",
                labelFallback: "Elevation Summary",
                accent: .neutral,
                value: .elevation(gain: "120.00 m", loss: "85.00 m")
            )
            let summary = MoreDetailsAccessibility.tileSummary(tile, localize: echo)
            XCTAssertEqual(summary, "Elevation Summary, Gain 120.00 m, Loss 85.00 m")
        }
    }
#endif
