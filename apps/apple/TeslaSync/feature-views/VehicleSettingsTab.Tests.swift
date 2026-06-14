//
//  VehicleSettingsTab.Tests.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  Pure-core unit coverage for the VehicleSettingsTab surface (the state-holder model
//  is covered in VehicleSettingsTab.ModelTests.swift):
//    • Adapter — the supported-key catalogue (order/kinds/options/maxLength), the
//      effective-source parse, the RFC3339 ⇄ Date conversion, and the draft
//      parse/validation gate ported from the web row helpers.
//    • Projection — the render gate + P4 leaf contract across loading / empty / error /
//      data, plus the per-key source-resolution fallbacks (web `findEffectiveSetting`).
//    • Accessibility — the row spoken-label composition + the source-pill label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Catalogue (web `VEHICLE_SETTING_DESCRIPTORS`)

@MainActor final class VehicleSettingsCatalogTests: XCTestCase {
    func testOrderMatchesWebSource() {
        XCTAssertEqual(
            VehicleSettingsCatalog.descriptors.map(\.key),
            ["nickname", "mute_until", "charge_cost_tariff_id", "units_distance", "units_temperature", "units_energy"]
        )
    }

    func testKindsMatchWebSource() {
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "nickname")?.kind, .text)
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "mute_until")?.kind, .timestamp)
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "charge_cost_tariff_id")?.kind, .text)
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "units_distance")?.kind, .select)
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "units_temperature")?.kind, .select)
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "units_energy")?.kind, .select)
    }

    func testSelectOptionsMatchWebSource() {
        XCTAssertEqual(
            VehicleSettingsCatalog.descriptor(for: "units_distance")?.options.map(\.value),
            ["mi", "km"]
        )
        XCTAssertEqual(
            VehicleSettingsCatalog.descriptor(for: "units_temperature")?.options.map(\.symbol),
            ["°C", "°F"]
        )
        XCTAssertEqual(
            VehicleSettingsCatalog.descriptor(for: "units_energy")?.options.map(\.value),
            ["kWh"]
        )
    }

    func testTextMaxLength() {
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "nickname")?.maxLength, 64)
        XCTAssertEqual(VehicleSettingsCatalog.descriptor(for: "charge_cost_tariff_id")?.maxLength, 64)
    }

    func testUnknownKeyIsNil() {
        XCTAssertNil(VehicleSettingsCatalog.descriptor(for: "not_a_key"))
    }
}

// MARK: - Effective source (web `EffectiveSettingSource`)

@MainActor final class EffectiveSettingSourceTests: XCTestCase {
    func testRawValuesMatchWire() {
        XCTAssertEqual(EffectiveSettingSource.override.rawValue, "override")
        XCTAssertEqual(EffectiveSettingSource.user.rawValue, "user")
        XCTAssertEqual(EffectiveSettingSource.vehicle.rawValue, "vehicle")
        XCTAssertEqual(EffectiveSettingSource.systemDefault.rawValue, "default")
    }

    func testParseFallsBackToDefault() {
        XCTAssertEqual(EffectiveSettingSource.parse("override"), .override)
        XCTAssertEqual(EffectiveSettingSource.parse(nil), .systemDefault)
        XCTAssertEqual(EffectiveSettingSource.parse(""), .systemDefault)
        XCTAssertEqual(EffectiveSettingSource.parse("nope"), .systemDefault)
    }
}

// MARK: - Datetime (port of `rfc3339ToLocalInput` / `localInputToRFC3339`)

@MainActor final class VehicleSettingsDateFormatTests: XCTestCase {
    func testParsesInternetDateTime() {
        XCTAssertNotNil(VehicleSettingsDateFormat.parse("2026-06-20T09:30:00Z"))
    }

    func testParsesFractionalSeconds() {
        XCTAssertNotNil(VehicleSettingsDateFormat.parse("2026-06-20T09:30:00.250Z"))
    }

    func testRoundTripIsLossless() throws {
        let iso = "2026-06-20T09:30:00Z"
        let date = VehicleSettingsDateFormat.parse(iso)
        XCTAssertNotNil(date)
        XCTAssertEqual(try VehicleSettingsDateFormat.rfc3339(from: XCTUnwrap(date)), iso)
    }

    func testEmptyOrGarbageIsNil() {
        XCTAssertNil(VehicleSettingsDateFormat.parse(nil))
        XCTAssertNil(VehicleSettingsDateFormat.parse(""))
        XCTAssertNil(VehicleSettingsDateFormat.parse("not-a-date"))
    }
}

// MARK: - Draft helpers (web `effectiveToDraft` / `parseDraft`)

@MainActor final class VehicleSettingsDraftTests: XCTestCase {
    private let nickname = VehicleSettingsCatalog.descriptor(for: "nickname")!
    private let mute = VehicleSettingsCatalog.descriptor(for: "mute_until")!
    private let distance = VehicleSettingsCatalog.descriptor(for: "units_distance")!

    func testInitialDraftPerKind() {
        XCTAssertEqual(VehicleSettingsDraft.initialDraft(for: nickname, value: "Lightning"), .text("Lightning"))
        XCTAssertEqual(VehicleSettingsDraft.initialDraft(for: nickname, value: nil), .text(""))
        XCTAssertEqual(VehicleSettingsDraft.initialDraft(for: distance, value: "km"), .selection("km"))
        XCTAssertEqual(VehicleSettingsDraft.initialDraft(for: distance, value: nil), .selection(""))

        let expectedDate = VehicleSettingsDateFormat.parse("2026-06-20T09:30:00Z")
        XCTAssertEqual(
            VehicleSettingsDraft.initialDraft(for: mute, value: "2026-06-20T09:30:00Z"),
            .timestamp(expectedDate)
        )
        XCTAssertEqual(VehicleSettingsDraft.initialDraft(for: mute, value: nil), .timestamp(nil))
    }

    func testParseTextTrimsAndRejectsEmpty() {
        XCTAssertEqual(VehicleSettingsDraft.parse(nickname, .text("  Bolt  ")), .ok(.string("Bolt")))
        XCTAssertEqual(VehicleSettingsDraft.parse(nickname, .text("   ")), .empty)
        XCTAssertEqual(VehicleSettingsDraft.parse(nickname, .text("")), .empty)
    }

    func testParseSelectValidatesAgainstOptions() {
        XCTAssertEqual(VehicleSettingsDraft.parse(distance, .selection("km")), .ok(.string("km")))
        XCTAssertEqual(VehicleSettingsDraft.parse(distance, .selection("")), .empty)
        if case let .invalid(messageKey, _) = VehicleSettingsDraft.parse(distance, .selection("lightyears")) {
            XCTAssertEqual(messageKey, "vehicleSettings.validation.invalid")
        } else {
            XCTFail("expected invalid for an out-of-set option")
        }
    }

    func testParseTimestamp() throws {
        let date = try XCTUnwrap(VehicleSettingsDateFormat.parse("2026-06-20T09:30:00Z"))
        XCTAssertEqual(VehicleSettingsDraft.parse(mute, .timestamp(date)), .ok(.string("2026-06-20T09:30:00Z")))
        XCTAssertEqual(VehicleSettingsDraft.parse(mute, .timestamp(nil)), .empty)
    }
}

// MARK: - Projection (render gate + P4 leaf contract + source resolution)

@MainActor final class VehicleSettingsProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = VehicleSettingsProjection.resolve(
            VehicleSettingsInput(isLoading: true, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(VehicleSettingsProjection.resolve(VehicleSettingsInput(isLoading: true)).phase, .loading)
    }

    func testEmptyWhenNoDescriptors() {
        let resolved = VehicleSettingsProjection.resolve(VehicleSettingsInput(), descriptors: [])
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testDataRendersEveryDescriptorInOrder() {
        let resolved = VehicleSettingsProjection.resolve(VehicleSettingsInput())
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.map(\.descriptor.key), VehicleSettingsCatalog.descriptors.map(\.key))
    }

    func testMissingRowFallsBackToDefault() {
        // No settings at all → every row resolves to the system default (web undefined).
        let resolved = VehicleSettingsProjection.resolve(VehicleSettingsInput())
        let nickname = resolved.rows.first { $0.descriptor.key == "nickname" }
        XCTAssertEqual(nickname?.source, .systemDefault)
        XCTAssertNil(nickname?.value)
    }

    func testResolvedRowCarriesSourceAndValue() {
        let input = VehicleSettingsInput(settings: [
            ResolvedSetting(key: "nickname", value: "Lightning", source: .override)
        ])
        let nickname = VehicleSettingsProjection.resolve(input).rows.first { $0.descriptor.key == "nickname" }
        XCTAssertEqual(nickname?.source, .override)
        XCTAssertEqual(nickname?.value, "Lightning")
    }
}

// MARK: - Accessibility + source label

@MainActor final class VehicleSettingsAccessibilityTests: XCTestCase {
    func testRowLabelJoinsParts() {
        XCTAssertEqual(
            VehicleSettingsAccessibility.rowLabel(label: "Nickname", source: "Override"),
            "Nickname, Override"
        )
    }

    func testSourceLabelResolvesFallback() {
        XCTAssertEqual(VehicleSettingsSourcePill.label(for: .override), "Override")
        XCTAssertEqual(VehicleSettingsSourcePill.label(for: .user), "User default")
        XCTAssertEqual(VehicleSettingsSourcePill.label(for: .vehicle), "Vehicle name")
        XCTAssertEqual(VehicleSettingsSourcePill.label(for: .systemDefault), "System default")
    }
}
