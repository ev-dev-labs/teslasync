//
//  CronParser.Tests.swift
//  TeslaSync — P4 feature view · 0014 · CronParser (Apple)
//
//  Unit coverage for the CronParser surface:
//    • Adapter (expression → projection) — `CronEvaluator` parity with the web
//      describeCron / getNextCronRuns / matchField helpers, the field splitter, the run
//      formatter, and the `CronResult` accessors.
//    • State holder — `CronParserModel` result derivation across empty / parsed, the
//      input didSet recompute, preset application, run-row projection, and the P1/S11
//      `view.opened` telemetry contract.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter + model are pure, driven directly. The pure-adapter subset is
//  additionally executed in the host validation harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared helpers

private func utcCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    return calendar
}

/// 2026-01-01 12:00:00 UTC — a fixed reference so "next runs" are deterministic.
private let cronReference = Date(timeIntervalSince1970: 1_767_268_800)

/// English-fallback localizer (bundle-free): returns each key's web default.
private let echoLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Adapter: describe (parity with web describeCron)

final class CronEvaluatorDescribeTests: XCTestCase {
    func testEveryMinute() {
        XCTAssertEqual(
            CronEvaluator.describe(["*", "*", "*", "*", "*"], localize: echoLocalize),
            "Every minute"
        )
    }

    func testAtMinuteOfEveryHour() {
        XCTAssertEqual(
            CronEvaluator.describe(["5", "*", "*", "*", "*"], localize: echoLocalize),
            "At minute 5 of every hour"
        )
    }

    func testAtTimeZeroPadded() {
        XCTAssertEqual(
            CronEvaluator.describe(["5", "9", "*", "*", "*"], localize: echoLocalize),
            "At 09:05"
        )
    }

    func testEveryMinuteOfHour() {
        XCTAssertEqual(
            CronEvaluator.describe(["*", "9", "*", "*", "*"], localize: echoLocalize),
            "Every minute of hour 9"
        )
    }

    func testDayOfMonthAndMonth() {
        XCTAssertEqual(
            CronEvaluator.describe(["30", "9", "15", "6", "*"], localize: echoLocalize),
            "At 09:30 on day 15 in month 6"
        )
    }

    func testWeekdayNames() {
        XCTAssertEqual(
            CronEvaluator.describe(["0", "0", "*", "*", "1"], localize: echoLocalize),
            "At 00:00 on Mon"
        )
        XCTAssertEqual(
            CronEvaluator.describe(["0", "0", "*", "*", "0"], localize: echoLocalize),
            "At 00:00 on Sun"
        )
    }

    func testWeekdayOutOfRangeFallsBackToRaw() {
        XCTAssertEqual(
            CronEvaluator.describe(["0", "0", "*", "*", "7"], localize: echoLocalize),
            "At 00:00 on 7"
        )
    }

    func testInvalidWhenNotFiveFields() {
        XCTAssertEqual(
            CronEvaluator.describe(["*", "*"], localize: echoLocalize),
            "Invalid cron expression"
        )
    }
}

// MARK: - Adapter: matchField (parity with web matchField)

final class CronEvaluatorMatchFieldTests: XCTestCase {
    func testWildcardMatchesEverything() {
        XCTAssertTrue(CronEvaluator.matchField("*", 7))
    }

    func testStep() {
        XCTAssertTrue(CronEvaluator.matchField("*/5", 0))
        XCTAssertTrue(CronEvaluator.matchField("*/5", 10))
        XCTAssertFalse(CronEvaluator.matchField("*/5", 3))
    }

    func testStepZeroIsFalse() {
        XCTAssertFalse(CronEvaluator.matchField("*/0", 0))
    }

    func testList() {
        XCTAssertTrue(CronEvaluator.matchField("1,15,30", 15))
        XCTAssertFalse(CronEvaluator.matchField("1,15,30", 2))
    }

    func testRange() {
        XCTAssertTrue(CronEvaluator.matchField("1-5", 3))
        XCTAssertFalse(CronEvaluator.matchField("1-5", 6))
    }

    func testExact() {
        XCTAssertTrue(CronEvaluator.matchField("7", 7))
        XCTAssertFalse(CronEvaluator.matchField("7", 8))
    }

    func testNonNumericIsFalse() {
        XCTAssertFalse(CronEvaluator.matchField("abc", 1))
    }
}

// MARK: - Adapter: fields splitter (parity with expr.trim().split(/\s+/))

final class CronEvaluatorFieldsTests: XCTestCase {
    func testBlankIsZeroFields() {
        XCTAssertTrue(CronEvaluator.fields("   ").isEmpty)
        XCTAssertTrue(CronEvaluator.fields("").isEmpty)
    }

    func testCollapsesRepeatedWhitespace() {
        XCTAssertEqual(CronEvaluator.fields("  */5   *  *  * * "), ["*/5", "*", "*", "*", "*"])
    }
}

// MARK: - Adapter: nextRuns (parity with web getNextCronRuns)

final class CronEvaluatorNextRunsTests: XCTestCase {
    func testEveryMinuteFromReference() {
        let runs = CronEvaluator.nextRuns(
            ["*", "*", "*", "*", "*"],
            count: 5,
            from: cronReference,
            calendar: utcCalendar()
        )
        XCTAssertEqual(runs.count, 5)
        XCTAssertEqual(runs.first, cronReference.addingTimeInterval(60))
        XCTAssertEqual(runs.last, cronReference.addingTimeInterval(300))
    }

    func testDailyMidnight() {
        let runs = CronEvaluator.nextRuns(
            ["0", "0", "*", "*", "*"],
            count: 3,
            from: cronReference,
            calendar: utcCalendar()
        )
        XCTAssertEqual(runs.count, 3)
        // First upcoming midnight after 2026-01-01 12:00 UTC is 2026-01-02 00:00 UTC.
        XCTAssertEqual(runs.first, Date(timeIntervalSince1970: 1_767_312_000))
    }

    func testNotFiveFieldsIsEmpty() {
        XCTAssertTrue(
            CronEvaluator.nextRuns(["*", "*"], count: 5, from: cronReference, calendar: utcCalendar()).isEmpty
        )
    }
}

// MARK: - Adapter: run formatter

final class CronRunFormatterTests: XCTestCase {
    func testFormatsKnownInstant() {
        let formatter = CronRunFormatter(
            locale: Locale(identifier: "en_US_POSIX"),
            timeZone: TimeZone(identifier: "UTC") ?? .current
        )
        let text = formatter.string(from: Date(timeIntervalSince1970: 1_767_312_000))
        XCTAssertTrue(text.contains("2026"))
        XCTAssertTrue(text.contains("Jan"))
    }
}

// MARK: - Adapter: evaluate (top-level projection)

final class CronEvaluatorEvaluateTests: XCTestCase {
    func testEmptyForBlank() {
        let result = CronEvaluator.evaluate(
            expression: "",
            count: 5,
            now: cronReference,
            calendar: utcCalendar(),
            localize: echoLocalize
        )
        XCTAssertEqual(result, .empty)
    }

    func testEmptyForWrongFieldCount() {
        let result = CronEvaluator.evaluate(
            expression: "* * *",
            count: 5,
            now: cronReference,
            calendar: utcCalendar(),
            localize: echoLocalize
        )
        XCTAssertEqual(result, .empty)
    }

    func testParsedCarriesDescriptionAndRuns() {
        let result = CronEvaluator.evaluate(
            expression: "* * * * *",
            count: 5,
            now: cronReference,
            calendar: utcCalendar(),
            localize: echoLocalize
        )
        XCTAssertEqual(result.descriptionText, "Every minute")
        XCTAssertEqual(result.runs.count, 5)
    }
}

// MARK: - State holder: CronParserModel

@MainActor
final class CronParserModelTests: XCTestCase {
    private func makeModel(_ input: String) -> CronParserModel {
        CronParserModel(
            input: input,
            calendar: utcCalendar(),
            referenceDate: cronReference,
            telemetry: SpyCronParserTelemetry()
        )
    }

    func testInitialEmpty() {
        XCTAssertEqual(makeModel("").result, .empty)
    }

    func testParsedAfterInput() {
        let model = makeModel("* * * * *")
        XCTAssertNotNil(model.result.descriptionText)
        XCTAssertEqual(model.result.runs.count, 5)
    }

    func testInputDidSetRecomputes() {
        let model = makeModel("")
        XCTAssertEqual(model.result, .empty)
        model.input = "0 0 * * *"
        XCTAssertEqual(model.result.runs.count, 5)
    }

    func testApplyPreset() {
        let model = makeModel("")
        model.apply(preset: "* * * * *")
        XCTAssertEqual(model.input, "* * * * *")
        XCTAssertNotNil(model.result.descriptionText)
    }

    func testRunRowsAreIndexed() {
        let rows = makeModel("* * * * *").runRows()
        XCTAssertEqual(rows.count, 5)
        XCTAssertEqual(rows.first?.index, 1)
        XCTAssertEqual(rows.last?.index, 5)
        XCTAssertFalse(rows.first?.label.isEmpty ?? true)
    }

    func testPresetsMatchSource() {
        let values = CronPreset.all.map(\.value)
        XCTAssertEqual(values, ["* * * * *", "0 * * * *", "0 0 * * *", "0 0 * * 0", "0 0 1 * *"])
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyCronParserTelemetry()
        let model = CronParserModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["CronParser"])
        XCTAssertEqual(CronParserSurface.slug, "CronParser")
    }
}

// MARK: - Accessibility: VoiceOver summary

final class CronParserAccessibilityTests: XCTestCase {
    private let formatter = CronRunFormatter(
        locale: Locale(identifier: "en_US_POSIX"),
        timeZone: TimeZone(identifier: "UTC") ?? .current
    )

    func testEmptySummary() {
        let summary = CronParserAccessibility.summary(result: .empty, localize: echoLocalize, formatter: formatter)
        XCTAssertEqual(summary, "Enter a cron expression to see its schedule")
    }

    func testParsedSummaryIncludesDescriptionAndRuns() {
        let summary = CronParserAccessibility.summary(
            result: .parsed(description: "Every minute", runs: [Date(timeIntervalSince1970: 1_767_312_000)]),
            localize: echoLocalize,
            formatter: formatter
        )
        XCTAssertTrue(summary.contains("Every minute"))
        XCTAssertTrue(summary.contains("Next Runs"))
        XCTAssertTrue(summary.contains("2026"))
    }

    func testParsedSummaryNoRuns() {
        let summary = CronParserAccessibility.summary(
            result: .parsed(description: "Every minute", runs: []),
            localize: echoLocalize,
            formatter: formatter
        )
        XCTAssertTrue(summary.contains("No upcoming runs"))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyCronParserTelemetry: CronParserTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
