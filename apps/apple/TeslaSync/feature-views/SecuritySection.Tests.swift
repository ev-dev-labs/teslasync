//
//  SecuritySection.Tests.swift
//  TeslaSync — P4 feature view · 0298 · SecuritySection (Apple)
//
//  Unit coverage for the SecuritySection surface:
//    • Adapter — the JS `Number()` / `String()` coercion ports, the door/window signal
//      readings, the `windowOpenCount` (port of the web inline helper), the door
//      resolution, the four-card projection (value + accent + icon), and the value-text
//      resolver.
//    • State holder — `SecuritySectionProjector` phase resolution across loading / error /
//      empty / data, the `SecuritySectionModel` wiring, the stale auto-refresh, and the
//      P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver tile-summary content.
//    • Render — a per-state ImageRenderer smoke pass (data / loading / empty / error /
//      stale / offline) proving every state lays out.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemorySecuritySectionSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - JS Number() / String() coercion ports

final class SecuritySectionNumberTests: XCTestCase {
    func testJsNumberEmptyAndWhitespaceAreZero() {
        XCTAssertEqual(SecuritySectionNumber.jsNumber(""), 0)
        XCTAssertEqual(SecuritySectionNumber.jsNumber("   "), 0)
        XCTAssertEqual(SecuritySectionNumber.jsNumber("\t\n"), 0)
    }

    func testJsNumberNumericStrings() {
        XCTAssertEqual(SecuritySectionNumber.jsNumber("0"), 0)
        XCTAssertEqual(SecuritySectionNumber.jsNumber("25"), 25)
        XCTAssertEqual(SecuritySectionNumber.jsNumber("42.5"), 42.5)
        XCTAssertEqual(SecuritySectionNumber.jsNumber("  17  "), 17)
        XCTAssertEqual(SecuritySectionNumber.jsNumber("-3"), -3)
    }

    func testJsNumberNonNumericIsNaN() {
        XCTAssertTrue(SecuritySectionNumber.jsNumber("abc").isNaN)
        XCTAssertTrue(SecuritySectionNumber.jsNumber("25abc").isNaN)
        XCTAssertTrue(SecuritySectionNumber.jsNumber("Open").isNaN)
    }

    func testJsStringWholeAndFractional() {
        XCTAssertEqual(SecuritySectionNumber.jsString(0), "0")
        XCTAssertEqual(SecuritySectionNumber.jsString(25), "25")
        XCTAssertEqual(SecuritySectionNumber.jsString(-5), "-5")
        XCTAssertEqual(SecuritySectionNumber.jsString(42.5), "42.5")
    }
}

// MARK: - Signal value coercions

final class SecuritySectionSignalValueTests: XCTestCase {
    func testNumericReadingMirrorsTypeofNumberElseNumber() {
        XCTAssertEqual(SecuritySectionSignalValue.number(42).numericReading, 42)
        XCTAssertEqual(SecuritySectionSignalValue.bool(true).numericReading, 1)
        XCTAssertEqual(SecuritySectionSignalValue.bool(false).numericReading, 0)
        XCTAssertEqual(SecuritySectionSignalValue.string("30").numericReading, 30)
        XCTAssertTrue(SecuritySectionSignalValue.string("nope").numericReading.isNaN)
    }

    func testStringValueMirrorsStringCoercion() {
        XCTAssertEqual(SecuritySectionSignalValue.string("Closed").stringValue, "Closed")
        XCTAssertEqual(SecuritySectionSignalValue.bool(true).stringValue, "true")
        XCTAssertEqual(SecuritySectionSignalValue.bool(false).stringValue, "false")
        XCTAssertEqual(SecuritySectionSignalValue.number(0).stringValue, "0")
    }

    func testIsEmptyStringOnlyForEmptyString() {
        XCTAssertTrue(SecuritySectionSignalValue.string("").isEmptyString)
        XCTAssertFalse(SecuritySectionSignalValue.string("x").isEmptyString)
        XCTAssertFalse(SecuritySectionSignalValue.bool(false).isEmptyString)
        XCTAssertFalse(SecuritySectionSignalValue.number(0).isEmptyString)
    }
}

// MARK: - Reading: door resolution + window-open count

final class SecuritySectionReadingTests: XCTestCase {
    func testResolvedDoorStateNilWhenAbsentOrEmpty() {
        XCTAssertNil(SecuritySectionReading().resolvedDoorState)
        XCTAssertNil(SecuritySectionReading(doorState: .string("")).resolvedDoorState)
    }

    func testResolvedDoorStateRendersVerbatimAndCoercion() {
        XCTAssertEqual(SecuritySectionReading(doorState: .string("Driver Open")).resolvedDoorState, "Driver Open")
        // The web `String(door_state)` coerces a non-empty non-string raw value too.
        XCTAssertEqual(SecuritySectionReading(doorState: .bool(false)).resolvedDoorState, "false")
        XCTAssertEqual(SecuritySectionReading(doorState: .number(0)).resolvedDoorState, "0")
    }

    func testWindowOpenCountZeroWhenAllAbsent() {
        XCTAssertEqual(SecuritySectionReading().windowOpenCount, 0)
    }

    func testWindowOpenCountCountsFinitePositiveReadings() {
        let reading = SecuritySectionReading(
            frontDriverWindow: .number(42), // open
            frontPassengerWindow: .bool(true), // open (Number(true) == 1)
            rearDriverWindow: .number(0), // closed
            rearPassengerWindow: .string("0") // closed
        )
        XCTAssertEqual(reading.windowOpenCount, 2)
    }

    func testWindowOpenCountIgnoresNonFiniteAndNonPositive() {
        let reading = SecuritySectionReading(
            frontDriverWindow: .string("Open"), // Number("Open") == NaN → not counted
            frontPassengerWindow: .bool(false), // 0 → not counted
            rearDriverWindow: .string(""), // Number("") == 0 → not counted
            rearPassengerWindow: .number(-5) // negative → not counted
        )
        XCTAssertEqual(reading.windowOpenCount, 0)
    }

    func testWindowOpenCountAllFourOpen() {
        let reading = SecuritySectionReading(
            frontDriverWindow: .number(1),
            frontPassengerWindow: .string("100"),
            rearDriverWindow: .number(0.5),
            rearPassengerWindow: .bool(true)
        )
        XCTAssertEqual(reading.windowOpenCount, 4)
    }
}

// MARK: - Projection: the four cards (value + accent + icon)

final class SecuritySectionProjectionTests: XCTestCase {
    private func cards(_ reading: SecuritySectionReading) -> [SecuritySectionMetricKind: SecuritySectionCard] {
        let projection = SecuritySectionProjection.make(reading: reading)
        return Dictionary(uniqueKeysWithValues: projection.cards.map { ($0.kind, $0) })
    }

    func testCardOrderMatchesWebComposition() {
        let projection = SecuritySectionProjection.make(reading: SecuritySectionReading())
        XCTAssertEqual(projection.cards.map(\.kind), [.locked, .sentry, .doors, .windows])
    }

    func testLockedTileValueAccentAndGlyphFlip() {
        let locked = cards(SecuritySectionReading(isLocked: true))[.locked]
        XCTAssertEqual(locked?.value, .yesNo(true))
        XCTAssertEqual(locked?.accent, .success)
        XCTAssertEqual(locked?.systemImage, "lock.fill")

        let unlocked = cards(SecuritySectionReading(isLocked: false))[.locked]
        XCTAssertEqual(unlocked?.value, .yesNo(false))
        XCTAssertEqual(unlocked?.accent, .info)
        XCTAssertEqual(unlocked?.systemImage, "lock.open.fill")
    }

    func testSentryTileValueAndAccent() {
        let active = cards(SecuritySectionReading(sentryMode: true))[.sentry]
        XCTAssertEqual(active?.value, .activeOff(true))
        XCTAssertEqual(active?.accent, .success)
        XCTAssertEqual(active?.systemImage, "eye.fill")

        let off = cards(SecuritySectionReading(sentryMode: false))[.sentry]
        XCTAssertEqual(off?.value, .activeOff(false))
        XCTAssertEqual(off?.accent, .info)
    }

    func testDoorsTilePresentShowsTextCyanElseClosedGreen() {
        let present = cards(SecuritySectionReading(doorState: .string("Driver Front Open")))[.doors]
        XCTAssertEqual(present?.value, .text("Driver Front Open"))
        XCTAssertEqual(present?.accent, .info)
        XCTAssertEqual(present?.systemImage, "door.left.hand.closed")

        let absent = cards(SecuritySectionReading(doorState: nil))[.doors]
        XCTAssertEqual(absent?.value, .closed)
        XCTAssertEqual(absent?.accent, .success)
    }

    func testWindowsTileOpenShowsCountCyanElseClosedGreen() {
        let open = cards(SecuritySectionReading(
            frontDriverWindow: .number(50),
            frontPassengerWindow: .bool(true)
        ))[.windows]
        XCTAssertEqual(open?.value, .windowsOpen(2))
        XCTAssertEqual(open?.accent, .info)
        XCTAssertEqual(open?.systemImage, "car.fill")

        let closed = cards(SecuritySectionReading())[.windows]
        XCTAssertEqual(closed?.value, .closed)
        XCTAssertEqual(closed?.accent, .success)
    }
}

// MARK: - Value text resolver

final class SecuritySectionValueTextTests: XCTestCase {
    private func resolve(_ value: SecuritySectionValue) -> String {
        SecuritySectionValueText.resolve(
            value,
            words: SecuritySectionValueWords(yes: "Yes", no: "No", active: "Active", off: "Off", closed: "Closed"),
            windowsOpen: { "\($0) open" }
        )
    }

    func testResolvesEveryVariant() {
        XCTAssertEqual(resolve(.yesNo(true)), "Yes")
        XCTAssertEqual(resolve(.yesNo(false)), "No")
        XCTAssertEqual(resolve(.activeOff(true)), "Active")
        XCTAssertEqual(resolve(.activeOff(false)), "Off")
        XCTAssertEqual(resolve(.text("Driver Open")), "Driver Open")
        XCTAssertEqual(resolve(.closed), "Closed")
        XCTAssertEqual(resolve(.windowsOpen(3)), "3 open")
    }
}

// MARK: - i18n facade: {{count}} substitution

final class SecuritySectionStringsTests: XCTestCase {
    func testWindowsOpenSubstitutesCountToken() {
        // The catalog value equals the web default ("{{count}} open"), so the result is
        // robust to bundle presence: the token is always substituted with the raw count.
        XCTAssertEqual(SecuritySectionStrings.windowsOpen(1), "1 open")
        XCTAssertEqual(SecuritySectionStrings.windowsOpen(4), "4 open")
    }
}

// MARK: - Projector: phase resolution

final class SecuritySectionProjectorTests: XCTestCase {
    func testErrorTakesPrecedenceOverData() {
        let input = SecuritySectionInput(reading: SecuritySectionReading(isLocked: true), errorMessage: "boom")
        XCTAssertEqual(SecuritySectionProjector.resolve(input).phase, .error("boom"))
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = SecuritySectionInput(reading: SecuritySectionReading(isLocked: true), isLoading: true)
        XCTAssertEqual(SecuritySectionProjector.resolve(input).phase, .loading)
    }

    func testEmptyWhenNoReading() {
        XCTAssertEqual(SecuritySectionProjector.resolve(SecuritySectionInput()).phase, .empty)
    }

    func testDataWhenReadingPresent() {
        let input = SecuritySectionInput(reading: SecuritySectionReading(isLocked: true))
        let resolved = SecuritySectionProjector.resolve(input)
        guard case let .data(projection) = resolved.phase else { return XCTFail("expected data") }
        XCTAssertEqual(projection.cards.count, 4)
    }

    func testEmptyErrorMessageIsNotError() {
        // An empty error string must fall through (not surface as `.error`); with no
        // reading the branch resolves to `.empty`.
        let resolved = SecuritySectionProjector.resolve(SecuritySectionInput(reading: nil, errorMessage: ""))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testPresentReadingResolvesToData() {
        // Web `securityData ? grid : EmptyState`: a present reading renders the grid.
        let resolved = SecuritySectionProjector.resolve(SecuritySectionInput(reading: SecuritySectionReading()))
        guard case let .data(projection) = resolved.phase else { return XCTFail("expected data") }
        XCTAssertEqual(projection.cards.count, 4)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor
final class SecuritySectionModelTests: XCTestCase {
    private func makeModel(
        _ input: SecuritySectionInput,
        telemetry: SecuritySectionTelemetry = OSLogSecuritySectionTelemetry()
    ) -> (SecuritySectionModel, InMemorySecuritySectionSource) {
        let source = InMemorySecuritySectionSource(initial: input)
        let model = SecuritySectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SecuritySectionSpyTelemetry()
        let input = SecuritySectionInput(reading: SecuritySectionReading(isLocked: true))
        let (model, source) = makeModel(input, telemetry: spy)
        model.start()
        model.start()
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(spy.surfaces, [SecuritySection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SecuritySectionInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjectionAndConnection() {
        let (model, source) = makeModel(SecuritySectionInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(SecuritySectionInput(reading: SecuritySectionReading(isLocked: true), connection: .offline))
        guard case .data = model.phase else { return XCTFail("expected data") }
        XCTAssertEqual(model.connection, .offline)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(SecuritySectionInput(reading: SecuritySectionReading(isLocked: true)))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(SecuritySectionInput(reading: SecuritySectionReading(isLocked: true), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SecuritySectionInput(reading: SecuritySectionReading(isLocked: true), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "no re-refresh while already stale")
    }
}

// MARK: - Accessibility summary

final class SecuritySectionAccessibilityTests: XCTestCase {
    func testTileSummaryJoinsLabelAndValue() {
        let summary = SecuritySectionAccessibility.tileSummary(label: "Locked", value: "Yes")
        XCTAssertEqual(summary, "Locked, Yes")
    }

    func testTileSummaryDropsEmptyFragments() {
        let summary = SecuritySectionAccessibility.tileSummary(label: "Doors", value: "")
        XCTAssertEqual(summary, "Doors")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Per-state render smoke (every state lays out)

@MainActor
final class SecuritySectionRenderTests: XCTestCase {
    private func render(_ input: SecuritySectionInput) throws {
        let source = InMemorySecuritySectionSource(initial: input)
        let model = SecuritySectionModel(source: source)
        model.start()
        let view = SecuritySection(model: model).frame(width: 560, height: 320)
        let renderer = ImageRenderer(content: view)
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage)
        #endif
    }

    func testEveryStateRenders() throws {
        let reading = SecuritySectionReading(
            isLocked: true,
            sentryMode: true,
            doorState: .string("Driver Open"),
            frontDriverWindow: .number(40)
        )
        try render(SecuritySectionInput(isLoading: true))
        try render(SecuritySectionInput(reading: reading))
        try render(SecuritySectionInput(reading: nil))
        try render(SecuritySectionInput(errorMessage: "503"))
        try render(SecuritySectionInput(reading: reading, connection: .stale))
        try render(SecuritySectionInput(reading: reading, connection: .offline))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SecuritySectionSpyTelemetry: SecuritySectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
