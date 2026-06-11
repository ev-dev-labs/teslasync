//
//  ClimatePanel.ProjectionTests.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  Projection + temperature-math coverage for the ClimatePanel surface:
//    • Math — the °C → display conversion + `formatTemperature` parity (null → em-dash, the no-
//      space °unit suffix, the precision default, and the Fahrenheit branch).
//    • Projection — the Cabin / Outside temperature cards, the Driver / Passenger setpoint rows,
//      the HVAC-state row (web nullish `?? '—'`), the six-bar fan meter (clamp + raw value), and
//      the Defrost / Climate / Precondition badges across the active, idle, and absent inputs.
//
//  The state-holder (`CabinClimatePanelModel`) wiring is covered in ClimatePanel.Tests.swift.
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so projected strings can be asserted without
/// the catalog (the P1/S10 facade is exercised separately).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Celsius-preference bag pinned to en_US so number formatting is deterministic in tests.
private let cPrefs = CabinClimatePanelUnitPrefs(temperature: .celsius, localeIdentifier: "en_US")
private let fPrefs = CabinClimatePanelUnitPrefs(temperature: .fahrenheit, localeIdentifier: "en_US")

// MARK: - Temperature math (web `convertTempFromSI` / `formatTemperature`)

final class CabinClimatePanelMathTests: XCTestCase {
    func testCelsiusPassesThrough() {
        XCTAssertEqual(CabinClimatePanelMath.convertTemperatureFromSI(21.5, to: .celsius), 21.5)
    }

    func testFahrenheitConversion() {
        XCTAssertEqual(CabinClimatePanelMath.convertTemperatureFromSI(0, to: .fahrenheit), 32)
        XCTAssertEqual(CabinClimatePanelMath.convertTemperatureFromSI(100, to: .fahrenheit), 212)
        XCTAssertEqual(CabinClimatePanelMath.convertTemperatureFromSI(21.5, to: .fahrenheit), 70.7, accuracy: 0.0001)
    }

    func testInlineNilIsEmDash() {
        XCTAssertEqual(
            CabinClimatePanelMath.temperatureInline(nil, unit: .celsius, precision: nil, localeIdentifier: "en_US"),
            "—"
        )
        XCTAssertEqual(
            CabinClimatePanelMath.temperatureInline(.nan, unit: .celsius, precision: nil, localeIdentifier: "en_US"),
            "—"
        )
    }

    func testInlineDefaultPrecisionAndNoSpaceSuffix() {
        // Web default temperature precision = 1, no space between number and °unit.
        XCTAssertEqual(
            CabinClimatePanelMath.temperatureInline(21.5, unit: .celsius, precision: nil, localeIdentifier: "en_US"),
            "21.5°C"
        )
        XCTAssertEqual(
            CabinClimatePanelMath.temperatureInline(8, unit: .celsius, precision: nil, localeIdentifier: "en_US"),
            "8.0°C"
        )
    }

    func testInlineFahrenheitAndPrecisionOverride() {
        XCTAssertEqual(
            CabinClimatePanelMath.temperatureInline(21.5, unit: .fahrenheit, precision: nil, localeIdentifier: "en_US"),
            "70.7°F"
        )
        XCTAssertEqual(
            CabinClimatePanelMath.temperatureInline(22, unit: .celsius, precision: 0, localeIdentifier: "en_US"),
            "22°C"
        )
    }
}

// MARK: - Projection: temperature cards + setpoint rows

@MainActor final class CabinClimatePanelTemperatureTests: XCTestCase {
    private let snapshot = CabinClimatePanelSnapshot(
        insideTempC: 21.5,
        outsideTempC: 8.0,
        driverSetpointC: 22.0,
        passengerSetpointC: 21.0
    )

    func testCabinAndOutsideCards() {
        let model = CabinClimatePanelProjection.content(snapshot: snapshot, prefs: cPrefs, localize: echo)
        XCTAssertEqual(model.cabin.label, "Cabin")
        XCTAssertEqual(model.cabin.value, "21.5°C")
        XCTAssertEqual(model.cabin.accessibilityLabel, "Cabin: 21.5°C")
        XCTAssertEqual(model.outside.label, "Outside")
        XCTAssertEqual(model.outside.value, "8.0°C")
    }

    func testSetpointRows() {
        let model = CabinClimatePanelProjection.content(snapshot: snapshot, prefs: cPrefs, localize: echo)
        XCTAssertEqual(model.driverSetpoint.label, "Driver Setpoint")
        XCTAssertEqual(model.driverSetpoint.value, "22.0°C")
        XCTAssertEqual(model.driverSetpoint.accessibilityLabel, "Driver Setpoint: 22.0°C")
        XCTAssertEqual(model.passengerSetpoint.label, "Passenger Setpoint")
        XCTAssertEqual(model.passengerSetpoint.value, "21.0°C")
    }

    func testFahrenheitPreferenceConvertsEveryTemperature() {
        let model = CabinClimatePanelProjection.content(snapshot: snapshot, prefs: fPrefs, localize: echo)
        XCTAssertEqual(model.cabin.value, "70.7°F")
        XCTAssertEqual(model.outside.value, "46.4°F")
        XCTAssertEqual(model.driverSetpoint.value, "71.6°F")
    }

    func testNilTemperaturesRenderEmDash() {
        let model = CabinClimatePanelProjection.content(
            snapshot: CabinClimatePanelSnapshot(),
            prefs: cPrefs,
            localize: echo
        )
        XCTAssertEqual(model.cabin.value, "—")
        XCTAssertEqual(model.outside.value, "—")
        XCTAssertEqual(model.driverSetpoint.value, "—")
        XCTAssertEqual(model.passengerSetpoint.value, "—")
    }

    func testNilSnapshotRendersEmDashTemperatures() {
        let model = CabinClimatePanelProjection.content(snapshot: nil, prefs: cPrefs, localize: echo)
        XCTAssertEqual(model.cabin.value, "—")
        XCTAssertEqual(model.driverSetpoint.value, "—")
    }
}

// MARK: - Projection: HVAC-state row (web `hvac_state ?? '—'`)

@MainActor final class CabinClimatePanelHVACStateTests: XCTestCase {
    private func hvac(_ state: String?) -> CabinClimatePanelRowModel {
        CabinClimatePanelProjection.content(
            snapshot: CabinClimatePanelSnapshot(hvacState: state),
            prefs: cPrefs,
            localize: echo
        ).hvacState
    }

    func testLabelAndPresentState() {
        XCTAssertEqual(hvac("On").label, "HVAC State")
        XCTAssertEqual(hvac("On").value, "On")
        XCTAssertEqual(hvac("On").accessibilityLabel, "HVAC State: On")
    }

    func testNilUsesEmDash() {
        XCTAssertEqual(hvac(nil).value, "—")
    }

    func testEmptyStringIsVerbatimNotEmDash() {
        // Web `hvac_state ?? '—'` is nullish — a non-nil empty string passes through verbatim.
        XCTAssertEqual(hvac("").value, "")
    }
}

// MARK: - Projection: fan meter (web `fan_status ?? 0` + six bars)

@MainActor final class CabinClimatePanelFanTests: XCTestCase {
    private func fan(_ status: Int?) -> CabinClimatePanelFanModel {
        CabinClimatePanelProjection.content(
            snapshot: CabinClimatePanelSnapshot(fanStatus: status),
            prefs: cPrefs,
            localize: echo
        ).fan
    }

    func testLabelAndMidLevel() {
        XCTAssertEqual(fan(4).label, "Fan Speed")
        XCTAssertEqual(fan(4).rawLevel, 4)
        XCTAssertEqual(fan(4).valueText, "4")
        XCTAssertEqual(fan(4).filledBars, 4)
        XCTAssertEqual(fan(4).accessibilityLabel, "Fan Speed: 4")
    }

    func testNilFanIsZero() {
        XCTAssertEqual(fan(nil).rawLevel, 0)
        XCTAssertEqual(fan(nil).valueText, "0")
        XCTAssertEqual(fan(nil).filledBars, 0)
    }

    func testFilledBarsClampToBarCountButRawValueIsVerbatim() {
        // A fan_status above the six-bar range fills all bars but still shows the raw number.
        XCTAssertEqual(fan(8).filledBars, CabinClimatePanelFanModel.barCount)
        XCTAssertEqual(fan(8).valueText, "8")
        XCTAssertEqual(fan(8).rawLevel, 8)
    }
}

// MARK: - Projection: system badges (web Defrost / Climate / Precondition)

@MainActor final class CabinClimatePanelBadgeTests: XCTestCase {
    private func badges(_ snapshot: CabinClimatePanelSnapshot) -> [CabinClimatePanelBadgeModel] {
        CabinClimatePanelProjection.content(snapshot: snapshot, prefs: cPrefs, localize: echo).badges
    }

    private func badge(_ snapshot: CabinClimatePanelSnapshot, _ id: String) -> CabinClimatePanelBadgeModel? {
        badges(snapshot).first { $0.id == id }
    }

    func testBadgeOrder() {
        XCTAssertEqual(badges(CabinClimatePanelSnapshot()).map(\.id), ["defrost", "climate", "precondition"])
    }

    func testActiveBadges() {
        let snapshot = CabinClimatePanelSnapshot(
            defrostMode: "Front",
            isClimateOn: true,
            isPreconditioning: true
        )
        XCTAssertEqual(badge(snapshot, "defrost")?.text, "Defrost Front")
        XCTAssertEqual(badge(snapshot, "defrost")?.active, true)
        XCTAssertEqual(badge(snapshot, "defrost")?.tone, .info)
        XCTAssertEqual(badge(snapshot, "defrost")?.systemImage, "snowflake")
        XCTAssertEqual(badge(snapshot, "climate")?.text, "Climate On")
        XCTAssertEqual(badge(snapshot, "climate")?.tone, .success)
        XCTAssertEqual(badge(snapshot, "precondition")?.text, "Precondition On")
        XCTAssertEqual(badge(snapshot, "precondition")?.tone, .warning)
        // Web precondition pill has no leading icon.
        XCTAssertNil(badge(snapshot, "precondition")?.systemImage)
    }

    func testInactiveBadges() {
        let snapshot = CabinClimatePanelSnapshot(
            defrostMode: "Off",
            isClimateOn: false,
            isPreconditioning: false
        )
        XCTAssertEqual(badge(snapshot, "defrost")?.text, "Defrost Off")
        XCTAssertEqual(badge(snapshot, "defrost")?.active, false)
        XCTAssertEqual(badge(snapshot, "defrost")?.tone, .neutral)
        XCTAssertEqual(badge(snapshot, "climate")?.text, "Climate Off")
        XCTAssertEqual(badge(snapshot, "climate")?.tone, .neutral)
        XCTAssertEqual(badge(snapshot, "precondition")?.text, "Precondition Off")
        XCTAssertEqual(badge(snapshot, "precondition")?.tone, .neutral)
    }

    func testNilBooleansAreInactive() {
        let snapshot = CabinClimatePanelSnapshot()
        XCTAssertEqual(badge(snapshot, "defrost")?.text, "Defrost Off")
        XCTAssertEqual(badge(snapshot, "defrost")?.active, false)
        XCTAssertEqual(badge(snapshot, "climate")?.text, "Climate Off")
        XCTAssertEqual(badge(snapshot, "precondition")?.text, "Precondition Off")
    }
}

// MARK: - Defrost-active guard (web `mode && mode !== 'Off'`)

final class CabinClimatePanelDefrostGuardTests: XCTestCase {
    func testGuardBranches() {
        XCTAssertFalse(CabinClimatePanelProjection.isDefrostActive(nil))
        XCTAssertFalse(CabinClimatePanelProjection.isDefrostActive(""))
        XCTAssertFalse(CabinClimatePanelProjection.isDefrostActive("Off"))
        XCTAssertTrue(CabinClimatePanelProjection.isDefrostActive("Front"))
        XCTAssertTrue(CabinClimatePanelProjection.isDefrostActive("Front & Rear"))
    }
}
