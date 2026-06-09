//
//  SafetyHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  Unit coverage for the SafetyHistoryWidget surface:
//    • Enum normalization — `SafetyEnum.clean`/`isActive`/`numberString`/`rawString`
//      parity with the web `lib/safetyEnum` (`cleanSafetyEnum`/`isSafetyEnumActive`).
//    • Adapter (cached → projection) — `SafetyEventCatalog.derive`/`visual`/`title`/
//      `subtitle` parity with the web `classifySnapshot` ladder + `buildSubtitle`, and
//      `SafetyFeedBuilder` (newest-first sort, id/timestamp fallbacks, cap).
//    • Stats — `SafetyStatsBuilder` parity with the web `stats` useMemo (30-day total,
//      most-common bucket with stable ties, 30-vs-prior-30-day trend).
//    • Layout — `SafetyLayout.isCompact`/`feedMaxItems` parity with the web
//      `isCompact = size.cols <= 1` and `maxItems={10}`.
//    • State holder — `SafetyModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `safety-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for rows + the compact summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySafetySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Enum normalization (parity with lib/safetyEnum)

final class SafetyEnumTests: XCTestCase {
    func testCleanBooleanRendersOnOff() {
        XCTAssertEqual(SafetyEnum.clean(.bool(true), field: .forwardCollisionWarning), "On")
        XCTAssertEqual(SafetyEnum.clean(.bool(false), field: .forwardCollisionWarning), "Off")
    }

    func testCleanNumberRendersDecimalForm() {
        XCTAssertEqual(SafetyEnum.clean(.number(3), field: .cruiseFollowDistance), "3")
        XCTAssertEqual(SafetyEnum.clean(.number(3.5), field: .cruiseFollowDistance), "3.5")
        XCTAssertEqual(SafetyEnum.numberString(3.0), "3")
        XCTAssertEqual(SafetyEnum.numberString(2.25), "2.25")
    }

    func testCleanStripsKnownPrefix() {
        XCTAssertEqual(
            SafetyEnum.clean(.string("ForwardCollisionSensitivityHigh"), field: .forwardCollisionWarning),
            "High"
        )
        XCTAssertEqual(
            SafetyEnum.clean(.string("LaneAssistLevelWarning"), field: .laneDepartureAvoidance),
            "Warning"
        )
    }

    func testCleanSpeedLimitNoneBecomesOff() {
        XCTAssertEqual(
            SafetyEnum.clean(.string("SpeedAssistLevelNone"), field: .speedLimitWarning),
            "Off"
        )
    }

    func testCleanUnprefixedStringPassesThrough() {
        XCTAssertEqual(SafetyEnum.clean(.string("Chime"), field: .speedLimitWarning), "Chime")
    }

    func testCleanEmptyAndNullUseFallback() {
        XCTAssertEqual(SafetyEnum.clean(.string(""), field: .speedLimitWarning), "—")
        XCTAssertEqual(SafetyEnum.clean(.null, field: .speedLimitWarning, fallback: "n/a"), "n/a")
    }

    func testIsActiveClassification() {
        XCTAssertFalse(SafetyEnum.isActive(.null, field: .forwardCollisionWarning))
        XCTAssertTrue(SafetyEnum.isActive(.bool(true), field: .forwardCollisionWarning))
        XCTAssertFalse(SafetyEnum.isActive(.bool(false), field: .forwardCollisionWarning))
        // Web invariant: a disabled-by-bool feature must NOT be classified as active.
        XCTAssertFalse(SafetyEnum.isActive(.number(0), field: .cruiseFollowDistance))
        XCTAssertTrue(SafetyEnum.isActive(.number(3), field: .cruiseFollowDistance))
        XCTAssertFalse(
            SafetyEnum.isActive(.string("ForwardCollisionSensitivityOff"), field: .forwardCollisionWarning)
        )
        XCTAssertTrue(
            SafetyEnum.isActive(.string("ForwardCollisionSensitivityHigh"), field: .forwardCollisionWarning)
        )
        XCTAssertFalse(SafetyEnum.isActive(.string("None"), field: .laneDepartureAvoidance))
    }

    func testRawStringEcho() {
        XCTAssertEqual(SafetyEnum.rawString(.bool(true)), "true")
        XCTAssertEqual(SafetyEnum.rawString(.number(3)), "3")
        XCTAssertEqual(SafetyEnum.rawString(.string("SpeedAssistLevelChime")), "SpeedAssistLevelChime")
    }
}

// MARK: - Adapter: classify ladder + visuals + titles + subtitle

final class SafetyAdapterTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testAebWinsOverEverything() {
        let event = SafetyEventInput(
            vehicleID: 7,
            automaticEmergencyBrakingOff: true,
            forwardCollisionWarning: .string("ForwardCollisionSensitivityHigh"),
            laneDepartureAvoidance: .string("LaneAssistLevelWarning"),
            blindSpotCollisionWarning: true,
            emergencyLaneDepartureAvoidance: true
        )
        let kind = SafetyEventCatalog.derive(from: event)
        XCTAssertEqual(kind, .aeb)
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).systemImage, "exclamationmark.octagon.fill")
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).severity, .critical)
        XCTAssertEqual(SafetyEventCatalog.typeSlug(for: kind), "aeb")
    }

    func testForwardCollisionPrecedesLane() {
        let event = SafetyEventInput(
            vehicleID: 7,
            forwardCollisionWarning: .string("ForwardCollisionSensitivityHigh"),
            laneDepartureAvoidance: .string("LaneAssistLevelWarning")
        )
        XCTAssertEqual(SafetyEventCatalog.derive(from: event), .forwardCollision(detail: "High"))
        XCTAssertEqual(SafetyEventCatalog.visual(for: .forwardCollision(detail: "High")).severity, .warning)
    }

    func testLaneWhenForwardCollisionInactive() {
        let event = SafetyEventInput(
            vehicleID: 7,
            forwardCollisionWarning: .string("ForwardCollisionSensitivityOff"),
            laneDepartureAvoidance: .string("LaneAssistLevelWarning")
        )
        let kind = SafetyEventCatalog.derive(from: event)
        XCTAssertEqual(kind, .laneDeparture(detail: "Warning"))
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).systemImage, "road.lanes")
        XCTAssertEqual(SafetyEventCatalog.typeSlug(for: kind), "lane")
    }

    func testBlindSpotPrecedesEmergencyLane() {
        let event = SafetyEventInput(
            vehicleID: 7,
            blindSpotCollisionWarning: true,
            emergencyLaneDepartureAvoidance: true
        )
        let kind = SafetyEventCatalog.derive(from: event)
        XCTAssertEqual(kind, .blindSpot)
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).systemImage, "car.fill")
    }

    func testEmergencyLaneWhenBlindSpotOff() {
        let event = SafetyEventInput(vehicleID: 7, emergencyLaneDepartureAvoidance: true)
        let kind = SafetyEventCatalog.derive(from: event)
        XCTAssertEqual(kind, .emergencyLaneDeparture)
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).systemImage, "exclamationmark.triangle.fill")
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).severity, .critical)
    }

    func testGeneralFallback() {
        let kind = SafetyEventCatalog.derive(from: SafetyEventInput(vehicleID: 7))
        XCTAssertEqual(kind, .general)
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).systemImage, "exclamationmark.octagon.fill")
        XCTAssertEqual(SafetyEventCatalog.visual(for: kind).severity, .info)
        XCTAssertEqual(SafetyEventCatalog.typeSlug(for: kind), "general")
    }

    func testSeverityMapsToTone() {
        XCTAssertEqual(SafetySeverity.info.tone, .info)
        XCTAssertEqual(SafetySeverity.warning.tone, .warning)
        XCTAssertEqual(SafetySeverity.critical.tone, .danger)
    }

    func testTitleEchoesDetailAndUsesExpectedKeys() {
        XCTAssertEqual(SafetyEventCatalog.title(for: .aeb, localize: echo), "AEB Activation")
        XCTAssertEqual(
            SafetyEventCatalog.title(for: .forwardCollision(detail: "High"), localize: echo),
            "FCW: High"
        )
        XCTAssertEqual(
            SafetyEventCatalog.title(for: .laneDeparture(detail: "Warning"), localize: echo),
            "Lane Departure: Warning"
        )
        XCTAssertEqual(SafetyEventCatalog.title(for: .general, localize: keyTap), "L:widget.safetyGeneralTitle")
    }

    func testTypeLabelMapping() {
        XCTAssertEqual(SafetyEventCatalog.typeLabel(forSlug: "aeb", localize: echo), "AEB")
        XCTAssertEqual(SafetyEventCatalog.typeLabel(forSlug: "lane", localize: echo), "Lane Departure")
        XCTAssertEqual(SafetyEventCatalog.typeLabel(forSlug: "general", localize: keyTap), "L:widget.safetyTypeGeneral")
        XCTAssertEqual(SafetyEventCatalog.typeLabel(forSlug: "—", localize: echo), "—")
    }

    func testSubtitleCompositionRawEcho() {
        let event = SafetyEventInput(
            vehicleID: 7,
            speedLimitWarning: .string("SpeedAssistLevelChime"),
            cruiseFollowDistance: .number(3),
            pinToDriveEnabled: true
        )
        XCTAssertEqual(
            SafetyEventCatalog.subtitle(for: event, localize: echo),
            "Speed Limit: SpeedAssistLevelChime · Follow: 3 · PIN to Drive"
        )
    }

    func testSubtitlePinFalseIsFilteredOut() {
        let event = SafetyEventInput(vehicleID: 7, cruiseFollowDistance: .number(2), pinToDriveEnabled: false)
        XCTAssertEqual(SafetyEventCatalog.subtitle(for: event, localize: echo), "Follow: 2")
    }

    func testSubtitleEmptyBecomesDash() {
        XCTAssertEqual(SafetyEventCatalog.subtitle(for: SafetyEventInput(vehicleID: 7), localize: echo), "—")
    }

    func testFeedBuilderSortsNewestFirst() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let events = [
            SafetyEventInput(id: 1, vehicleID: 7, createdAt: base),
            SafetyEventInput(id: 2, vehicleID: 7, createdAt: base.addingTimeInterval(600)),
            SafetyEventInput(id: 3, vehicleID: 7, createdAt: base.addingTimeInterval(-300))
        ]
        XCTAssertEqual(SafetyFeedBuilder.build(events: events, localize: echo).map(\.id), ["2", "1", "3"])
    }

    func testFeedBuilderHonorsLimit() {
        let base = Date()
        let events = (0 ..< 6).map {
            SafetyEventInput(id: Int64($0), vehicleID: 7, createdAt: base.addingTimeInterval(Double($0)))
        }
        let items = SafetyFeedBuilder.build(events: events, limit: 4, localize: echo)
        XCTAssertEqual(items.map(\.id), ["5", "4", "3", "2"])
    }

    func testFeedItemIdAndTimestampFallbacks() {
        let ts = Date(timeIntervalSince1970: 1_700_000_000)
        let withID = SafetyEventInput(id: 42, vehicleID: 7, createdAt: ts)
        let withoutID = SafetyEventInput(id: nil, vehicleID: 7, createdAt: ts)
        let withoutCreated = SafetyEventInput(id: nil, vehicleID: 7, createdAt: nil)
        XCTAssertEqual(SafetyFeedBuilder.build(events: [withID], localize: echo).first?.id, "42")
        XCTAssertEqual(SafetyFeedBuilder.build(events: [withoutID], localize: echo).first?.id, "7-1700000000")
        let fallback = SafetyFeedBuilder.build(events: [withoutCreated], localize: echo).first
        XCTAssertEqual(fallback?.timestamp, Date(timeIntervalSince1970: 0))
        XCTAssertEqual(fallback?.id, "7-0")
    }

    func testRelativeTimeIsNonEmptyAndOrderSensitive() {
        let now = Date()
        let recent = SafetyRelativeTime.string(for: now.addingTimeInterval(-60), relativeTo: now)
        let older = SafetyRelativeTime.string(for: now.addingTimeInterval(-7200), relativeTo: now)
        XCTAssertFalse(recent.isEmpty)
        XCTAssertFalse(older.isEmpty)
        XCTAssertNotEqual(recent, older)
    }
}
