//
//  TimestampTool.Tests.swift
//  TeslaSync — P4 feature view · 0021 · TimestampTool (Apple)
//
//  Unit coverage for the TimestampTool surface:
//    • Adapter (input → projection) — JS `parseInt` port, the `length > 10` ms/s
//      rule, `toISOString` / floored unix seconds / `getRelativeTime` parity, and
//      ISO parsing.
//    • State holder — per-field phase resolution, the live `tick`, the "Now"
//      autofill, and the P1/S11 `view.opened` telemetry (emitted once).
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets at integration. They have no
//  network and no real store — the surface is a synchronous client-side tool. A
//  fixed `now` + locale + timezone keep every assertion deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum TS0021 {
    /// 2024-01-01T00:00:00Z.
    static let epoch2024 = Date(timeIntervalSince1970: 1_704_067_200)
    static let locale = Locale(identifier: "en_US")
    static let utc = TimeZone(identifier: "UTC") ?? .current
}

// MARK: - JS parseInt port

final class TimestampJSNumberTests: XCTestCase {
    func testParseInt10MatchesJavaScript() {
        XCTAssertEqual(JSNumber.parseInt10("1700000000"), 1_700_000_000)
        XCTAssertEqual(JSNumber.parseInt10("  -123abc"), -123)
        XCTAssertEqual(JSNumber.parseInt10("+42"), 42)
        XCTAssertEqual(JSNumber.parseInt10("12.9"), 12) // stops at '.'
        XCTAssertEqual(JSNumber.parseInt10("0x10"), 0) // stops at 'x'
        XCTAssertEqual(JSNumber.parseInt10("007"), 7)
        XCTAssertNil(JSNumber.parseInt10("abc"))
        XCTAssertNil(JSNumber.parseInt10(""))
        XCTAssertNil(JSNumber.parseInt10("   "))
        XCTAssertNil(JSNumber.parseInt10("-"))
    }
}

// MARK: - Unix parsing (web `useMemo` + the length>10 rule)

final class TimestampUnixParseTests: XCTestCase {
    func testSecondsAndMillisecondsResolveToSameInstant() throws {
        // length ≤ 10 → seconds (×1000); length > 10 → already milliseconds.
        let fromSeconds = try XCTUnwrap(TimestampParser.parseUnix("1700000000"))
        let fromMillis = try XCTUnwrap(TimestampParser.parseUnix("1700000000000"))
        XCTAssertEqual(TimestampFormatter.unixSeconds(fromSeconds), 1_700_000_000)
        XCTAssertEqual(TimestampFormatter.unixSeconds(fromMillis), 1_700_000_000)
    }

    func testEpochAndEmptyAndGarbage() {
        XCTAssertEqual(TimestampParser.parseUnix("0").map(TimestampFormatter.unixSeconds), 0)
        XCTAssertNil(TimestampParser.parseUnix(""))
        XCTAssertNil(TimestampParser.parseUnix("nope"))
    }

    func testOutOfRangeIsNilLikeInvalidDate() {
        // |ms| > 8.64e15 → JS `new Date` is Invalid → web returns null.
        XCTAssertNil(TimestampParser.parseUnix("99999999999999999999"))
    }
}

// MARK: - ISO parsing (web `new Date(iso)`)

final class TimestampISOParseTests: XCTestCase {
    func testCanonicalISO() {
        XCTAssertEqual(
            TimestampParser.parseISO("2024-01-01T00:00:00Z", timeZone: TS0021.utc)
                .map(TimestampFormatter.unixSeconds),
            1_704_067_200
        )
        XCTAssertEqual(
            TimestampParser.parseISO("2023-06-15T12:30:00Z", timeZone: TS0021.utc)
                .map(TimestampFormatter.unixSeconds),
            1_686_832_200
        )
    }

    func testFractionalAndDateOnly() {
        XCTAssertEqual(
            TimestampParser.parseISO("2024-01-01T00:00:00.000Z", timeZone: TS0021.utc)
                .map(TimestampFormatter.unixSeconds),
            1_704_067_200
        )
        // Bare calendar date → UTC midnight, like JS.
        XCTAssertEqual(
            TimestampParser.parseISO("2024-01-01", timeZone: TS0021.utc)
                .map(TimestampFormatter.unixSeconds),
            1_704_067_200
        )
    }

    func testEmptyAndGarbage() {
        XCTAssertNil(TimestampParser.parseISO("", timeZone: TS0021.utc))
        XCTAssertNil(TimestampParser.parseISO("nonsense", timeZone: TS0021.utc))
    }
}

// MARK: - Formatting (toISOString / unix / relative)

final class TimestampFormatterTests: XCTestCase {
    func testISOStringMatchesToISOString() {
        XCTAssertEqual(TimestampFormatter.iso8601(TS0021.epoch2024), "2024-01-01T00:00:00.000Z")
        XCTAssertEqual(
            TimestampFormatter.iso8601(Date(timeIntervalSince1970: 0)),
            "1970-01-01T00:00:00.000Z"
        )
    }

    func testUnixSecondsFloorsLikeMathFloor() {
        XCTAssertEqual(TimestampFormatter.unixSeconds(Date(timeIntervalSince1970: 1_704_067_200.9)), 1_704_067_200)
        // Math.floor rounds toward -∞ for pre-epoch instants.
        XCTAssertEqual(TimestampFormatter.unixSeconds(Date(timeIntervalSince1970: -1.5)), -2)
    }

    func testRelativeBucketsMatchGetRelativeTime() {
        let now = TS0021.epoch2024
        XCTAssertEqual(relative(secondsAgo: 0, now: now).defaultText, "0s ago")
        XCTAssertEqual(relative(secondsAgo: 59, now: now).defaultText, "59s ago")
        XCTAssertEqual(relative(secondsAgo: 60, now: now).defaultText, "1m ago")
        XCTAssertEqual(relative(secondsAgo: 90, now: now).defaultText, "1m ago")
        XCTAssertEqual(relative(secondsAgo: 3600, now: now).defaultText, "1h ago")
        XCTAssertEqual(relative(secondsAgo: 86400, now: now).defaultText, "1d ago")
    }

    func testRelativeUsesAbsoluteDifferenceForFutureDates() {
        let now = TS0021.epoch2024
        let future = now.addingTimeInterval(30)
        XCTAssertEqual(TimestampFormatter.relative(from: future, now: now).defaultText, "30s ago")
    }

    func testLocalIsLocalizedAndNonEmpty() {
        let local = TimestampFormatter.local(TS0021.epoch2024, locale: TS0021.locale, timeZone: TS0021.utc)
        XCTAssertFalse(local.isEmpty)
        XCTAssertTrue(local.contains("2024"))
    }

    private func relative(secondsAgo: TimeInterval, now: Date) -> RelativeTime {
        TimestampFormatter.relative(from: now.addingTimeInterval(-secondsAgo), now: now)
    }
}

// MARK: - Relative localization (facade keeps web default verbatim)

final class TimestampRelativeStringTests: XCTestCase {
    func testFacadeReproducesWebDefault() {
        XCTAssertEqual(TimestampToolStrings.relative(RelativeTime(unit: .seconds, value: 5)), "5s ago")
        XCTAssertEqual(TimestampToolStrings.relative(RelativeTime(unit: .minutes, value: 2)), "2m ago")
        XCTAssertEqual(TimestampToolStrings.relative(RelativeTime(unit: .hours, value: 3)), "3h ago")
        XCTAssertEqual(TimestampToolStrings.relative(RelativeTime(unit: .days, value: 9)), "9d ago")
    }
}

// MARK: - Projector

final class TimestampProjectorTests: XCTestCase {
    func testNowSnapshot() {
        let snapshot = TimestampProjector.now(TS0021.epoch2024)
        XCTAssertEqual(snapshot.unixSeconds, 1_704_067_200)
        XCTAssertEqual(snapshot.iso, "2024-01-01T00:00:00.000Z")
    }

    func testFromUnixProjection() throws {
        let projection = try XCTUnwrap(
            TimestampProjector.fromUnix(
                "1704067200",
                now: TS0021.epoch2024,
                locale: TS0021.locale,
                timeZone: TS0021.utc
            )
        )
        XCTAssertEqual(projection.iso, "2024-01-01T00:00:00.000Z")
        XCTAssertEqual(projection.relative.defaultText, "0s ago")
        XCTAssertFalse(projection.local.isEmpty)
    }

    func testFromISOProjection() throws {
        let projection = try XCTUnwrap(
            TimestampProjector.fromISO(
                "2024-01-01T00:00:00Z",
                now: TS0021.epoch2024,
                locale: TS0021.locale,
                timeZone: TS0021.utc
            )
        )
        XCTAssertEqual(projection.unixSeconds, 1_704_067_200)
        XCTAssertEqual(projection.relative.defaultText, "0s ago")
    }

    func testInvalidProjectionsAreNil() {
        XCTAssertNil(
            TimestampProjector.fromUnix("xx", now: TS0021.epoch2024, locale: TS0021.locale, timeZone: TS0021.utc)
        )
        XCTAssertNil(
            TimestampProjector.fromISO("xx", now: TS0021.epoch2024, locale: TS0021.locale, timeZone: TS0021.utc)
        )
    }
}

// MARK: - State holder: phases + tick + Now + telemetry

@MainActor
final class TimestampToolModelTests: XCTestCase {
    private func makeModel(
        unix: String = "",
        iso: String = "",
        telemetry: any TimestampToolTelemetry = OSLogTimestampToolTelemetry()
    ) -> TimestampToolModel {
        TimestampToolModel(
            now: TS0021.epoch2024,
            unixInput: unix,
            isoInput: iso,
            locale: TS0021.locale,
            timeZone: TS0021.utc,
            telemetry: telemetry
        )
    }

    func testEmptyInputsYieldEmptyPhases() {
        let model = makeModel()
        XCTAssertEqual(model.unixPhase, .empty)
        XCTAssertEqual(model.isoPhase, .empty)
        XCTAssertNil(model.fromUnix)
        XCTAssertNil(model.fromISO)
    }

    func testValidUnixYieldsContent() {
        let model = makeModel(unix: "1700000000")
        XCTAssertEqual(model.unixPhase, .content)
        XCTAssertEqual(model.fromUnix?.iso, "2023-11-14T22:13:20.000Z")
    }

    func testInvalidUnixYieldsInvalidPhase() {
        let model = makeModel(unix: "not-a-number")
        XCTAssertEqual(model.unixPhase, .invalid)
        XCTAssertNil(model.fromUnix)
    }

    func testValidISOYieldsContent() {
        let model = makeModel(iso: "2024-01-01T00:00:00Z")
        XCTAssertEqual(model.isoPhase, .content)
        XCTAssertEqual(model.fromISO?.unixSeconds, 1_704_067_200)
    }

    func testTickUpdatesNowSnapshot() {
        let model = makeModel()
        XCTAssertEqual(model.nowSnapshot.unixSeconds, 1_704_067_200)
        model.tick(Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(model.nowSnapshot.unixSeconds, 1_700_000_000)
    }

    func testUseNowFillsBothFieldsFromCurrentInstant() {
        let model = makeModel()
        model.useNow()
        XCTAssertEqual(model.unixInput, "1704067200")
        XCTAssertEqual(model.isoInput, "2024-01-01T00:00:00.000Z")
        XCTAssertEqual(model.unixPhase, .content)
        XCTAssertEqual(model.isoPhase, .content)
    }

    func testStartEmitsViewOpenedOnceWithSurfaceSlug() {
        let spy = RecordingTimestampToolTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TimestampToolSurface.slug])
        XCTAssertEqual(spy.surfaces, ["TimestampTool"])
    }
}

// MARK: - Accessibility summaries

@MainActor
final class TimestampAccessibilityTests: XCTestCase {
    func testNowSummaryIncludesBothValues() {
        let summary = TimestampAccessibility.nowSummary(TimestampProjector.now(TS0021.epoch2024))
        XCTAssertTrue(summary.contains("Unix"))
        XCTAssertTrue(summary.contains("Iso"))
        XCTAssertTrue(summary.contains("1704067200"))
    }

    func testUnixSummaryIncludesEveryRow() throws {
        let projection = try XCTUnwrap(
            TimestampProjector.fromUnix(
                "1704067200",
                now: TS0021.epoch2024,
                locale: TS0021.locale,
                timeZone: TS0021.utc
            )
        )
        let summary = TimestampAccessibility.unixSummary(projection)
        XCTAssertTrue(summary.contains("Iso"))
        XCTAssertTrue(summary.contains("Local"))
        XCTAssertTrue(summary.contains("Relative"))
    }

    func testISOSummaryIncludesEveryRow() throws {
        let projection = try XCTUnwrap(
            TimestampProjector.fromISO(
                "2024-01-01T00:00:00Z",
                now: TS0021.epoch2024,
                locale: TS0021.locale,
                timeZone: TS0021.utc
            )
        )
        let summary = TimestampAccessibility.isoSummary(projection)
        XCTAssertTrue(summary.contains("Unix"))
        XCTAssertTrue(summary.contains("Local"))
        XCTAssertTrue(summary.contains("Relative"))
    }
}

// MARK: - Test doubles

private final class RecordingTimestampToolTelemetry: TimestampToolTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
