//
//  SafetyFeaturesWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  Adapter (cached → projection) coverage for the SafetyFeaturesWidget surface:
//    • `SafetyEnum` normalization parity with the web `lib/safetyEnum.ts`
//      (`cleanRaw` / `isActive`, prefix stripping, bool/number/string narrowing).
//    • The three `SafetyStatusMapper` status helpers.
//    • `SafetyCellsBuilder` cell/active-count projection parity with the web
//      `buildCells` + `activeCount`, plus the status → tone/tint mapping.
//  The state-holder / registry / accessibility tests live in
//  SafetyFeaturesWidget.ModelTests.swift.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: safety-enum normalization (port parity with lib/safetyEnum.ts)

@MainActor final class SafetyEnumCleanRawTests: XCTestCase {
    func testBooleanRendersOnOff() {
        XCTAssertEqual(SafetyEnum.cleanRaw(.boolean(true), field: .forwardCollisionWarning), "On")
        XCTAssertEqual(SafetyEnum.cleanRaw(.boolean(false), field: .forwardCollisionWarning), "Off")
    }

    func testNumberRendersJsStringForm() {
        XCTAssertEqual(SafetyEnum.cleanRaw(.number(3), field: .cruiseFollowDistance), "3")
        XCTAssertEqual(SafetyEnum.cleanRaw(.number(3.0), field: .cruiseFollowDistance), "3")
        XCTAssertEqual(SafetyEnum.cleanRaw(.number(0), field: .cruiseFollowDistance), "0")
        XCTAssertEqual(SafetyEnum.cleanRaw(.number(2.5), field: .cruiseFollowDistance), "2.5")
    }

    func testTypedEnumStringStripsItsPrefix() {
        XCTAssertEqual(
            SafetyEnum.cleanRaw(.text("ForwardCollisionSensitivityMedium"), field: .forwardCollisionWarning),
            "Medium"
        )
        XCTAssertEqual(
            SafetyEnum.cleanRaw(.text("LaneAssistLevelWarning"), field: .laneDepartureAvoidance),
            "Warning"
        )
        XCTAssertEqual(
            SafetyEnum.cleanRaw(.text("FollowDistance3"), field: .cruiseFollowDistance),
            "3"
        )
    }

    func testSpeedAssistNoneMapsToOff() {
        XCTAssertEqual(
            SafetyEnum.cleanRaw(.text("SpeedAssistLevelNone"), field: .speedLimitWarning),
            "Off"
        )
        // Only speed_limit_warning gets the None→Off conversion.
        XCTAssertEqual(
            SafetyEnum.cleanRaw(.text("LaneAssistLevelNone"), field: .laneDepartureAvoidance),
            "None"
        )
    }

    func testUnprefixedStringPassesThrough() {
        XCTAssertEqual(SafetyEnum.cleanRaw(.text("Chime"), field: .speedLimitWarning), "Chime")
    }

    func testExactPrefixKeepsRawValue() {
        // stripped == "" → web `stripped || raw` keeps the raw string.
        XCTAssertEqual(
            SafetyEnum.cleanRaw(.text("ForwardCollisionSensitivity"), field: .forwardCollisionWarning),
            "ForwardCollisionSensitivity"
        )
    }

    func testEmptyAndAbsentUseFallback() {
        XCTAssertEqual(SafetyEnum.cleanRaw(.text(""), field: .forwardCollisionWarning), "—")
        XCTAssertEqual(SafetyEnum.cleanRaw(.absent, field: .forwardCollisionWarning), "—")
        XCTAssertEqual(SafetyEnum.cleanRaw(.absent, field: .forwardCollisionWarning, fallback: "?"), "?")
    }
}

@MainActor final class SafetyEnumIsActiveTests: XCTestCase {
    func testAbsentIsInactive() {
        XCTAssertFalse(SafetyEnum.isActive(.absent, field: .forwardCollisionWarning))
    }

    func testBooleanPassesThrough() {
        XCTAssertTrue(SafetyEnum.isActive(.boolean(true), field: .forwardCollisionWarning))
        XCTAssertFalse(SafetyEnum.isActive(.boolean(false), field: .forwardCollisionWarning))
    }

    func testNumberZeroIsInactiveNonZeroActive() {
        XCTAssertFalse(SafetyEnum.isActive(.number(0), field: .cruiseFollowDistance))
        XCTAssertTrue(SafetyEnum.isActive(.number(3), field: .cruiseFollowDistance))
    }

    func testOffNoneDisabledZeroClassifyInactiveCaseInsensitively() {
        XCTAssertFalse(SafetyEnum.isActive(.text("SpeedAssistLevelNone"), field: .speedLimitWarning))
        XCTAssertFalse(SafetyEnum.isActive(.text("LaneAssistLevelNone"), field: .laneDepartureAvoidance))
        XCTAssertFalse(SafetyEnum.isActive(.text("disabled"), field: .forwardCollisionWarning))
        XCTAssertFalse(SafetyEnum.isActive(.text("OFF"), field: .forwardCollisionWarning))
        XCTAssertFalse(SafetyEnum.isActive(.text("FollowDistance0"), field: .cruiseFollowDistance))
    }

    func testTypedEnumLevelsAreActive() {
        XCTAssertTrue(SafetyEnum.isActive(.text("ForwardCollisionSensitivityLate"), field: .forwardCollisionWarning))
        XCTAssertTrue(SafetyEnum.isActive(.text("SpeedAssistLevelDisplay"), field: .speedLimitWarning))
        XCTAssertTrue(SafetyEnum.isActive(.text("FollowDistance7"), field: .cruiseFollowDistance))
    }
}

// MARK: - Adapter: status mappers (web boolStatus / invertedBoolStatus / safetyEnumStatus)

@MainActor final class SafetyStatusMapperTests: XCTestCase {
    func testBoolStatus() {
        XCTAssertEqual(SafetyStatusMapper.boolStatus(nil), .unknown)
        XCTAssertEqual(SafetyStatusMapper.boolStatus(true), .ok)
        XCTAssertEqual(SafetyStatusMapper.boolStatus(false), .inactive)
    }

    func testInvertedBoolStatus() {
        XCTAssertEqual(SafetyStatusMapper.invertedBoolStatus(nil), .unknown)
        // The field is an "off" flag — true means the feature is disabled.
        XCTAssertEqual(SafetyStatusMapper.invertedBoolStatus(true), .inactive)
        XCTAssertEqual(SafetyStatusMapper.invertedBoolStatus(false), .ok)
    }

    func testSafetyEnumStatus() {
        XCTAssertEqual(SafetyStatusMapper.safetyEnumStatus(.absent, field: .forwardCollisionWarning), .unknown)
        let fcwActive = SafetyStatusMapper.safetyEnumStatus(
            .text("ForwardCollisionSensitivityMedium"),
            field: .forwardCollisionWarning
        )
        XCTAssertEqual(fcwActive, .ok)
        XCTAssertEqual(
            SafetyStatusMapper.safetyEnumStatus(.text("SpeedAssistLevelNone"), field: .speedLimitWarning),
            .inactive
        )
        XCTAssertEqual(SafetyStatusMapper.safetyEnumStatus(.boolean(false), field: .laneDepartureAvoidance), .inactive)
    }
}

// MARK: - Adapter: cell projection (port parity with the web buildCells)

@MainActor final class SafetyCellsBuilderTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    private func cells(_ input: SafetyLatestInput) -> [String: SafetyStatusCell] {
        let built = SafetyCellsBuilder.build(latest: input, localize: echo)
        return Dictionary(uniqueKeysWithValues: built.map { ($0.id, $0) })
    }

    func testBuildReturnsEmptyWhenNoSnapshot() {
        XCTAssertTrue(SafetyCellsBuilder.build(latest: nil, localize: echo).isEmpty)
    }

    func testBuildProducesEightOrderedCells() {
        let built = SafetyCellsBuilder.build(latest: SafetyLatestInput(), localize: echo)
        XCTAssertEqual(built.map(\.id), ["fcw", "aeb", "lda", "elda", "bsc", "bscw", "slw", "cfd"])
    }

    func testEmergencyBrakingInvertsTheOffFlag() {
        let enabled = cells(SafetyLatestInput(automaticEmergencyBrakingOff: false))["aeb"]
        XCTAssertEqual(enabled?.status, .ok)
        XCTAssertEqual(enabled?.value, "Enabled")

        let disabled = cells(SafetyLatestInput(automaticEmergencyBrakingOff: true))["aeb"]
        XCTAssertEqual(disabled?.status, .inactive)
        XCTAssertEqual(disabled?.value, "Disabled")

        let unknown = cells(SafetyLatestInput(automaticEmergencyBrakingOff: nil))["aeb"]
        XCTAssertEqual(unknown?.status, .unknown)
        XCTAssertEqual(unknown?.value, "—")
    }

    func testPlainBoolCellsMapEnabledDisabledUnknown() {
        let on = cells(SafetyLatestInput(emergencyLaneDepartureAvoidance: true))["elda"]
        XCTAssertEqual(on?.status, .ok)
        XCTAssertEqual(on?.value, "Enabled")

        let off = cells(SafetyLatestInput(automaticBlindSpotCamera: false))["bsc"]
        XCTAssertEqual(off?.status, .inactive)
        XCTAssertEqual(off?.value, "Disabled")

        let unknown = cells(SafetyLatestInput(blindSpotCollisionWarning: nil))["bscw"]
        XCTAssertEqual(unknown?.status, .unknown)
        XCTAssertEqual(unknown?.value, "—")
    }

    func testEnumCellsCleanAndClassify() {
        let fcw = cells(SafetyLatestInput(
            forwardCollisionWarning: .text("ForwardCollisionSensitivityMedium")
        ))["fcw"]
        XCTAssertEqual(fcw?.status, .ok)
        XCTAssertEqual(fcw?.value, "Medium")

        let slw = cells(SafetyLatestInput(speedLimitWarning: .text("SpeedAssistLevelNone")))["slw"]
        XCTAssertEqual(slw?.status, .inactive)
        XCTAssertEqual(slw?.value, "Off")

        let cfd = cells(SafetyLatestInput(cruiseFollowDistance: .number(3)))["cfd"]
        XCTAssertEqual(cfd?.status, .ok)
        XCTAssertEqual(cfd?.value, "3")

        let absentEnum = cells(SafetyLatestInput(forwardCollisionWarning: .absent))["fcw"]
        XCTAssertEqual(absentEnum?.status, .unknown)
        XCTAssertEqual(absentEnum?.value, "—")
    }

    func testActiveCountCountsOnlyOkCells() {
        let engaged = SafetyLatestInput(
            forwardCollisionWarning: .text("ForwardCollisionSensitivityMedium"),
            automaticEmergencyBrakingOff: false,
            laneDepartureAvoidance: .text("LaneAssistLevelWarning"),
            emergencyLaneDepartureAvoidance: true,
            automaticBlindSpotCamera: true,
            blindSpotCollisionWarning: true,
            speedLimitWarning: .text("SpeedAssistLevelDisplay"),
            cruiseFollowDistance: .number(3)
        )
        XCTAssertEqual(SafetyCellsBuilder.activeCount(SafetyCellsBuilder.build(latest: engaged, localize: echo)), 8)

        let mixed = SafetyLatestInput(
            forwardCollisionWarning: .boolean(false),
            automaticEmergencyBrakingOff: true,
            laneDepartureAvoidance: .text("LaneAssistLevelNone"),
            emergencyLaneDepartureAvoidance: false,
            automaticBlindSpotCamera: nil,
            blindSpotCollisionWarning: true,
            speedLimitWarning: .text("SpeedAssistLevelNone"),
            cruiseFollowDistance: .number(1)
        )
        XCTAssertEqual(SafetyCellsBuilder.activeCount(SafetyCellsBuilder.build(latest: mixed, localize: echo)), 2)
    }

    func testActiveCountIsZeroForEmptySnapshot() {
        let cells = SafetyCellsBuilder.build(latest: SafetyLatestInput(), localize: echo)
        XCTAssertEqual(SafetyCellsBuilder.activeCount(cells), 0)
    }

    func testLabelsResolveThroughTheLocalizerKeys() {
        let built = SafetyCellsBuilder.build(latest: SafetyLatestInput(), localize: keyTap)
        XCTAssertEqual(built.map(\.label), [
            "L:widget.safety.fcw",
            "L:widget.safety.aeb",
            "L:widget.safety.lda",
            "L:widget.safety.elda",
            "L:widget.safety.bsc",
            "L:widget.safety.bscw",
            "L:widget.safety.slw",
            "L:widget.safety.cfd"
        ])
    }

    func testEnumDisplayValueRoutesOnOffThroughLocalizer() {
        XCTAssertEqual(
            SafetyCellsBuilder.displayValue(.boolean(true), field: .forwardCollisionWarning, localize: keyTap),
            "L:widget.safety.on"
        )
        XCTAssertEqual(
            SafetyCellsBuilder.displayValue(.boolean(false), field: .forwardCollisionWarning, localize: keyTap),
            "L:widget.safety.off"
        )
        // Data values (stripped enum / number) pass through untouched.
        XCTAssertEqual(
            SafetyCellsBuilder.displayValue(.text("FollowDistance2"), field: .cruiseFollowDistance, localize: keyTap),
            "2"
        )
        XCTAssertEqual(
            SafetyCellsBuilder.displayValue(.absent, field: .forwardCollisionWarning, localize: keyTap),
            "—"
        )
    }
}

// MARK: - Adapter: status → tone / tint mapping (web statusStyles)

@MainActor final class SafetyCellStatusTests: XCTestCase {
    func testToneMapping() {
        XCTAssertEqual(SafetyCellStatus.ok.tone, .success)
        XCTAssertEqual(SafetyCellStatus.warning.tone, .warning)
        XCTAssertEqual(SafetyCellStatus.error.tone, .danger)
        XCTAssertEqual(SafetyCellStatus.inactive.tone, .neutral)
        XCTAssertEqual(SafetyCellStatus.unknown.tone, .neutral)
    }

    func testTintingMatchesWebStatusStyles() {
        XCTAssertTrue(SafetyCellStatus.ok.isTinted)
        XCTAssertTrue(SafetyCellStatus.warning.isTinted)
        XCTAssertTrue(SafetyCellStatus.error.isTinted)
        XCTAssertFalse(SafetyCellStatus.inactive.isTinted)
        XCTAssertFalse(SafetyCellStatus.unknown.isTinted)
    }
}
