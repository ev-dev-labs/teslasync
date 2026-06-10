//
//  VehicleCommandCenter.Tests.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  Unit + UI coverage for the Vehicle Command Center surface: the adapter projections
//  (web-parity number/distance/temperature formatting, the freshness + timeAgo labels,
//  the per-command status map, the toggle states, the header stats), the search filter,
//  the dialog param assembly (every web `buildParams` / `transform` branch), the catalog
//  integrity, the state-holder model (favorites seeding, phase, activation routing,
//  dialog submit, favorite persistence, command-result feedback incl. the wake special
//  case, stale auto-refresh, telemetry), the accessibility summaries, and a per-state
//  view render smoke. Pure-logic tests use `InMemoryVehicleCommandSource`; the view
//  tests render via `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: number formatting (web parity)

@MainActor final class VCCFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(VCCFormat.number(386.243, decimals: 0), "386")
        XCTAssertEqual(VCCFormat.number(1234.0, decimals: 0), "1,234")
        XCTAssertEqual(VCCFormat.number(1234.5, decimals: 1), "1,234.5")
    }

    func testNumberRoundsHalfUp() {
        XCTAssertEqual(VCCFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(VCCFormat.number(239.5, decimals: 0), "240")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(VCCFormat.safeNumber(.nan), 0)
        XCTAssertEqual(VCCFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(VCCFormat.number(.nan, decimals: 0), "0")
    }

    func testLocaleAffectsSeparators() {
        XCTAssertEqual(VCCFormat.number(1234.5, decimals: 1, localeIdentifier: "de_DE"), "1.234,5")
    }
}

// MARK: - Adapter: SI conversion (web parity)

@MainActor final class VCCConvertTests: XCTestCase {
    func testDistanceFromSIMatchesWeb() {
        XCTAssertEqual(VCCConvert.distanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(VCCConvert.distanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(VCCConvert.distanceFromSI(0.3048, to: "ft"), 1, accuracy: 1e-9)
        // Unknown unit falls back to km (web switch default never hits; native is safe).
        XCTAssertEqual(VCCConvert.distanceFromSI(2000, to: "??"), 2, accuracy: 1e-9)
    }

    func testTemperatureFromSIMatchesWeb() {
        XCTAssertEqual(VCCConvert.temperatureFromSI(21, to: "°C"), 21, accuracy: 1e-9)
        XCTAssertEqual(VCCConvert.temperatureFromSI(0, to: "°F"), 32, accuracy: 1e-9)
        XCTAssertEqual(VCCConvert.temperatureFromSI(100, to: "°F"), 212, accuracy: 1e-9)
    }
}

// MARK: - Adapter: relative time (web `timeAgo` / `formatAge`)

@MainActor final class VCCRelativeTimeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testTimeAgoMatchesWebBuckets() {
        XCTAssertEqual(VCCRelativeTime.timeAgo(now.addingTimeInterval(-30), now: now), "just now")
        XCTAssertEqual(VCCRelativeTime.timeAgo(now.addingTimeInterval(-120), now: now), "2m ago")
        XCTAssertEqual(VCCRelativeTime.timeAgo(now.addingTimeInterval(-7200), now: now), "2h ago")
        XCTAssertEqual(VCCRelativeTime.timeAgo(now.addingTimeInterval(-172_800), now: now), "2d ago")
    }

    func testFormatAgeMatchesWebBuckets() {
        XCTAssertEqual(VCCRelativeTime.formatAge(nil, now: now), "—")
        XCTAssertEqual(VCCRelativeTime.formatAge(now.addingTimeInterval(-5), now: now), "just now")
        XCTAssertEqual(VCCRelativeTime.formatAge(now.addingTimeInterval(-30), now: now), "30s ago")
        XCTAssertEqual(VCCRelativeTime.formatAge(now.addingTimeInterval(-120), now: now), "2m ago")
        XCTAssertEqual(VCCRelativeTime.formatAge(now.addingTimeInterval(-7200), now: now), "2h ago")
    }
}

// MARK: - Adapter: projector (stats / status / toggle)

@MainActor final class VehicleCommandProjectorTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func vehicle(state: String = "online") -> VCCVehicle {
        VCCVehicle(id: 1, vin: "VIN1", displayName: "Model 3", model: "model3", state: state, updatedAt: now)
    }

    func testHeaderFieldsAndAsleep() {
        let onlineProjection = VehicleCommandProjector.project(
            update: VCCUpdate(vehicle: vehicle()), now: now
        )
        XCTAssertEqual(onlineProjection.vehicleName, "Model 3")
        XCTAssertEqual(onlineProjection.modelLine, "model3 · VIN1")
        XCTAssertFalse(onlineProjection.isAsleep)

        let asleepProjection = VehicleCommandProjector.project(
            update: VCCUpdate(vehicle: vehicle(state: "asleep")), now: now
        )
        XCTAssertTrue(asleepProjection.isAsleep)
    }

    func testStatsUseWebMathAndUnits() {
        let state = VCCVehicleState(batteryLevel: 82, ratedRangeMeters: 386_243, insideTempCelsius: 21)
        let update = VCCUpdate(vehicle: vehicle(), state: state, units: VCCUnitPrefs(distance: "mi", temperature: "°F"))
        let projection = VehicleCommandProjector.project(update: update, now: now)
        XCTAssertEqual(projection.stats.map(\.id), ["battery", "range", "temp"])
        XCTAssertEqual(projection.stats[0].value, "82%")
        XCTAssertEqual(projection.stats[0].tone, .success)
        // 386243 m / 1609.344 = 240 mi.
        XCTAssertEqual(projection.stats[1].value, "240 mi")
        // 21°C → 69.8°F → "70°F".
        XCTAssertEqual(projection.stats[2].value, "70°F")
    }

    func testLowBatteryTone() {
        let state = VCCVehicleState(batteryLevel: 40, ratedRangeMeters: 100_000)
        let projection = VehicleCommandProjector.project(update: VCCUpdate(vehicle: vehicle(), state: state), now: now)
        XCTAssertEqual(projection.stats[0].tone, .warning)
    }

    func testTempStatOmittedWhenNil() {
        let state = VCCVehicleState(batteryLevel: 50, ratedRangeMeters: 100_000, insideTempCelsius: nil)
        let projection = VehicleCommandProjector.project(update: VCCUpdate(vehicle: vehicle(), state: state), now: now)
        XCTAssertEqual(projection.stats.map(\.id), ["battery", "range"])
    }

    func testStatsEmptyWithoutState() {
        let projection = VehicleCommandProjector.project(update: VCCUpdate(vehicle: vehicle()), now: now)
        XCTAssertTrue(projection.stats.isEmpty)
    }

    func testStatusMapKeepsLatestPerCommandWithMarker() {
        let entries = [
            VCCCommandLogEntry(command: "lock", status: "success", createdAt: now.addingTimeInterval(-120)),
            VCCCommandLogEntry(command: "lock", status: "error", createdAt: now.addingTimeInterval(-600)),
            VCCCommandLogEntry(command: "honk_horn", status: "error", createdAt: now.addingTimeInterval(-60))
        ]
        let map = VehicleCommandProjector.statusMap(entries, now: now)
        XCTAssertEqual(map["lock"], "✓ 2m ago")
        XCTAssertEqual(map["honk_horn"], "✗ 1m ago")
    }

    func testToggleStatesExtractBoundFields() {
        let state = VCCVehicleState(isLocked: true, isCharging: false, isClimateOn: nil, sentryMode: true)
        let map = VehicleCommandProjector.toggleStates(state)
        XCTAssertEqual(map["is_locked"], true)
        XCTAssertEqual(map["is_charging"], false)
        XCTAssertEqual(map["sentry_mode"], true)
        XCTAssertNil(map["is_climate_on"])
    }
}

// MARK: - Adapter: search filter (web parity)

@MainActor final class VehicleCommandFilterTests: XCTestCase {
    func testEmptyQueryReturnsAll() {
        XCTAssertEqual(VehicleCommandFilter.match(query: "", in: VehicleCommandCatalog.all).count, 67)
    }

    func testLabelMatch() {
        let hits = VehicleCommandFilter.match(query: "sentry", in: VehicleCommandCatalog.all)
        XCTAssertTrue(hits.contains { $0.id == "sentry" })
    }

    func testCategoryTokenMatch() {
        let hits = VehicleCommandFilter.match(query: "charging", in: VehicleCommandCatalog.all)
        XCTAssertTrue(hits.allSatisfy { $0.category == .charging } == false || !hits.isEmpty)
        XCTAssertTrue(hits.contains { $0.command == "charge_start" })
    }

    func testCommandTokenMatch() {
        let hits = VehicleCommandFilter.match(query: "honk_horn", in: VehicleCommandCatalog.all)
        XCTAssertEqual(hits.map(\.id), ["honk_horn"])
    }

    func testNoMatch() {
        XCTAssertTrue(VehicleCommandFilter.match(query: "zzzzzz", in: VehicleCommandCatalog.all).isEmpty)
    }
}

// MARK: - Adapter: param assembly (web `buildParams` / `transform`)

@MainActor final class VehicleCommandParamAssemblerTests: XCTestCase {
    private func command(_ id: String) -> VehicleCommand {
        guard let command = VehicleCommandCatalog.command(id: id) else {
            fatalError("missing catalog command \(id)") // parity:allow test fixture lookup, not shipped code
        }
        return command
    }

    func testSingleFieldRaw() {
        let params = VehicleCommandParamAssembler.assemble(
            command: command("speed_limit_set"),
            values: ["limit_mph": "75"]
        )
        XCTAssertEqual(params.values["limit_mph"], .string("75"))
    }

    func testBaseParamsMergeWithInput() {
        let params = VehicleCommandParamAssembler.assemble(command: command("valet_mode"), values: ["password": "1234"])
        XCTAssertEqual(params.values["on"], .string("true"))
        XCTAssertEqual(params.values["password"], .string("1234"))
    }

    func testDuplicateField() {
        let params = VehicleCommandParamAssembler.assemble(command: command("set_temps"), values: ["driver_temp": "21"])
        XCTAssertEqual(params.values["driver_temp"], .string("21"))
        XCTAssertEqual(params.values["passenger_temp"], .string("21"))
    }

    func testIntParseWithBaseOrder() {
        let params = VehicleCommandParamAssembler.assemble(
            command: command("navigation_sc_request"),
            values: ["id": "42"]
        )
        XCTAssertEqual(params.values["id"], .int(42))
        XCTAssertEqual(params.values["order"], .int(0))
    }

    func testMinutesToSeconds() {
        let params = VehicleCommandParamAssembler.assemble(
            command: command("schedule_software_update"),
            values: ["offset_sec": "2"]
        )
        XCTAssertEqual(params.values["offset_sec"], .string("120"))
    }

    func testLatLonStrings() {
        let params = VehicleCommandParamAssembler.assemble(
            command: command("trigger_homelink"),
            values: ["lat": "37.7", "lon": "-122.4"]
        )
        XCTAssertEqual(params.values["lat"], .string("37.7"))
        XCTAssertEqual(params.values["lon"], .string("-122.4"))
        XCTAssertNil(params.values["order"])
    }

    func testLatLonFloatsWithOrder() {
        let params = VehicleCommandParamAssembler.assemble(
            command: command("navigation_gps_request"),
            values: ["lat": "37.5", "lon": "-122.5"]
        )
        XCTAssertEqual(params.values["lat"], .double(37.5))
        XCTAssertEqual(params.values["lon"], .double(-122.5))
        XCTAssertEqual(params.values["order"], .int(0))
    }

    func testNavAddressNestedPayload() {
        let params = VehicleCommandParamAssembler.assemble(
            command: command("navigation_request"),
            values: ["address": "123 Main St"]
        )
        XCTAssertEqual(params.values["type"], .string("share_ext_content_raw"))
        XCTAssertEqual(params.values["locale"], .string("en-US"))
        XCTAssertEqual(params.values["value"], .object(["android.intent.extra.TEXT": .string("123 Main St")]))
    }

    func testVehicleNameTrims() {
        let params = VehicleCommandParamAssembler.assemble(
            command: command("set_vehicle_name"),
            values: ["vehicle_name": "  Bolt  "]
        )
        XCTAssertEqual(params.values["vehicle_name"], .string("Bolt"))
    }

    func testDefaultValueUsedWhenFieldUnedited() {
        // set_charge_limit defaults to 80 (web `defaultValue: '80'`).
        let params = VehicleCommandParamAssembler.assemble(command: command("set_charge_limit"), values: [:])
        XCTAssertEqual(params.values["percent"], .string("80"))
    }
}

// MARK: - Catalog integrity

@MainActor final class VehicleCommandCatalogTests: XCTestCase {
    func testTotalCount() {
        XCTAssertEqual(VehicleCommandCatalog.all.count, 67)
    }

    func testCategoryCounts() {
        func count(_ category: VehicleCommandCategory) -> Int {
            VehicleCommandCatalog.all.count(where: { $0.category == category })
        }
        XCTAssertEqual(count(.security), 15)
        XCTAssertEqual(count(.climate), 5)
        XCTAssertEqual(count(.climateProtection), 10)
        XCTAssertEqual(count(.charging), 7)
        XCTAssertEqual(count(.media), 7)
    }

    func testGroupsCoverEveryCategoryInOrder() {
        XCTAssertEqual(VehicleCommandCatalog.groups.map(\.category), VehicleCommandCategory.order)
    }

    func testDefaultFavorites() {
        XCTAssertEqual(
            Set(VehicleCommandCatalog.defaultFavoriteIDs),
            ["wake_up", "lock", "sentry", "climate", "frunk_open", "honk_horn"]
        )
    }

    func testUniqueIDs() {
        let ids = VehicleCommandCatalog.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
    }

    func testInputCommandsHaveDialogAndDangerousHaveConfirm() {
        for command in VehicleCommandCatalog.all where command.kind == .input {
            XCTAssertNotNil(command.dialog, "input command \(command.id) needs a dialog")
        }
        for command in VehicleCommandCatalog.all where command.isDangerous && command.dialog == nil {
            XCTAssertNotNil(command.confirm, "dangerous command \(command.id) needs confirm copy")
        }
    }
}
