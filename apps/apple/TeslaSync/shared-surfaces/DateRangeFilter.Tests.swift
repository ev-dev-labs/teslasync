//
//  DateRangeFilter.Tests.swift
//  TeslaSync — P4 shared surface · 0152 · DateRangeFilter (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projector + matcher + ISO
//  helpers + value types live in DateRangeFilter.AdapterTests.swift; split to keep each file within the
//  SwiftLint file-length budget):
//    • DateRangeFilterModel — the once-only `view.opened`, the field-edit routing (string + `DatePicker`
//      `Date` boundary), the verbatim `handlePreset` (atomic `onRangeChange` vs the individual setters, then
//      `onApply`), the `apply()` routing, the unbound-field "now" fallback, and the props/closure update guard.
//    • Views — the public surface + the subviews compose in every branch (default / apply / presets-off /
//      custom subset / injected-model).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks (the values fed to the
//      field + Apply accessibility labels).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DateRangeFilterModel (routing + telemetry + projection)

@MainActor
final class DateRangeFilterModelTests: XCTestCase {
    /// A fixed UTC Gregorian calendar so the resolved ISO days are timezone-independent in CI.
    private let cal = DateRangeFilterDates.gregorian(timeZone: TimeZone(identifier: "UTC")!)

    /// A fixed clock pinned to 2024-03-15 noon UTC.
    private var fixedClock: FixedClock {
        var components = DateComponents()
        components.year = 2024
        components.month = 3
        components.day = 15
        components.hour = 12
        return FixedClock(instant: cal.date(from: components)!)
    }

    private func model(
        _ input: DateRangeFilterInput = DateRangeFilterInput(startDate: "", endDate: ""),
        onStartDateChange: @escaping @MainActor (String) -> Void = { _ in },
        onEndDateChange: @escaping @MainActor (String) -> Void = { _ in },
        onRangeChange: (@MainActor (DateRangeFilterRange) -> Void)? = nil,
        onApply: (@MainActor () -> Void)? = nil,
        telemetry: DateRangeFilterTelemetry = OSLogDateRangeFilterTelemetry()
    ) -> DateRangeFilterModel {
        DateRangeFilterModel(
            input: input,
            onStartDateChange: onStartDateChange,
            onEndDateChange: onEndDateChange,
            onRangeChange: onRangeChange,
            onApply: onApply,
            clock: fixedClock,
            calendar: cal,
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DateRangeFilterSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DateRangeFilterSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionResolvesActivePreset() {
        let holder = model(DateRangeFilterInput(startDate: "2024-03-15", endDate: "2024-03-15"))
        XCTAssertEqual(holder.projection.activePresetID, "today")
    }

    func testSetStartRoutesISOToClosure() {
        var received: String?
        let holder = model(onStartDateChange: { received = $0 })
        holder.setStart("2024-02-01")
        XCTAssertEqual(received, "2024-02-01")
    }

    func testSetEndRoutesISOToClosure() {
        var received: String?
        let holder = model(onEndDateChange: { received = $0 })
        holder.setEnd("2024-02-28")
        XCTAssertEqual(received, "2024-02-28")
    }

    func testSetStartDateFormatsAndRoutes() throws {
        var received: String?
        let holder = model(onStartDateChange: { received = $0 })
        var components = DateComponents()
        components.year = 2024
        components.month = 6
        components.day = 20
        components.hour = 12
        let picked = try XCTUnwrap(cal.date(from: components))
        holder.setStart(date: picked)
        XCTAssertEqual(received, "2024-06-20")
    }

    func testHandlePresetWithoutOnRangeChangeRoutesIndividualSettersThenApply() {
        var start: String?
        var end: String?
        var applied = 0
        let holder = model(
            onStartDateChange: { start = $0 },
            onEndDateChange: { end = $0 },
            onApply: { applied += 1 }
        )
        holder.handlePreset(DateRangeFilterRange(start: "2024-03-09", end: "2024-03-15"))
        XCTAssertEqual(start, "2024-03-09")
        XCTAssertEqual(end, "2024-03-15")
        XCTAssertEqual(applied, 1)
    }

    func testHandlePresetWithOnRangeChangeRoutesAtomicThenApply() {
        var atomic: DateRangeFilterRange?
        var individualCalls = 0
        var applied = 0
        let holder = model(
            onStartDateChange: { _ in individualCalls += 1 },
            onEndDateChange: { _ in individualCalls += 1 },
            onRangeChange: { atomic = $0 },
            onApply: { applied += 1 }
        )
        holder.handlePreset(DateRangeFilterRange(start: "2024-01-01", end: "2024-03-15"))
        XCTAssertEqual(atomic, DateRangeFilterRange(start: "2024-01-01", end: "2024-03-15"))
        XCTAssertEqual(individualCalls, 0, "atomic path must not also fire the individual setters")
        XCTAssertEqual(applied, 1)
        XCTAssertEqual(holder.lastRange, atomic)
    }

    func testHandlePresetWithoutOnApplyDoesNotCrash() {
        var atomic: DateRangeFilterRange?
        let holder = model(onRangeChange: { atomic = $0 })
        holder.handlePreset(DateRangeFilterRange(start: "2024-03-01", end: "2024-03-15"))
        XCTAssertEqual(atomic?.start, "2024-03-01")
    }

    func testApplyRoutesOnApply() {
        var applied = 0
        let holder = model(onApply: { applied += 1 })
        holder.apply()
        XCTAssertEqual(applied, 1)
    }

    func testApplyIsNoOpWhenNoOnApply() {
        let holder = model()
        holder.apply()
        XCTAssertNil(holder.lastRange)
    }

    func testUnboundFieldFallsBackToNow() {
        let holder = model(DateRangeFilterInput(startDate: "", endDate: ""))
        XCTAssertEqual(DateRangeFilterDates.iso(from: holder.startDate, calendar: cal), "2024-03-15")
        XCTAssertEqual(DateRangeFilterDates.iso(from: holder.endDate, calendar: cal), "2024-03-15")
    }

    func testBoundFieldParsesISO() {
        let holder = model(DateRangeFilterInput(startDate: "2023-11-05", endDate: "2023-12-25"))
        XCTAssertEqual(DateRangeFilterDates.iso(from: holder.startDate, calendar: cal), "2023-11-05")
        XCTAssertEqual(DateRangeFilterDates.iso(from: holder.endDate, calendar: cal), "2023-12-25")
    }

    func testUpdateRefreshesPropsAndClosures() {
        var applied = 0
        let holder = model()
        holder.update(
            DateRangeFilterInput(startDate: "2024-03-01", endDate: "2024-03-15", showApply: true),
            onStartDateChange: { _ in },
            onEndDateChange: { _ in },
            onRangeChange: nil,
            onApply: { applied += 1 }
        )
        XCTAssertEqual(holder.projection.activePresetID, "mtd")
        XCTAssertTrue(holder.projection.showApply)
        holder.apply()
        XCTAssertEqual(applied, 1)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class DateRangeFilterViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = DateRangeFilter(startDate: "", endDate: "", onStartDateChange: { _ in }, onEndDateChange: { _ in })
        _ = DateRangeFilter(
            startDate: "2024-03-01",
            endDate: "2024-03-15",
            onStartDateChange: { _ in },
            onEndDateChange: { _ in },
            onApply: {}
        )
        _ = DateRangeFilter(
            startDate: "",
            endDate: "",
            onStartDateChange: { _ in },
            onEndDateChange: { _ in },
            presets: false
        )
        _ = DateRangeFilter(
            startDate: "",
            endDate: "",
            onStartDateChange: { _ in },
            onEndDateChange: { _ in },
            presetIDs: ["7d", "30d", "90d"]
        )
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = DateRangeFilterModel(
            input: DateRangeFilterInput(startDate: "2024-03-15", endDate: "2024-03-15", showApply: true),
            telemetry: SpyTelemetry()
        )
        _ = DateRangeFilter(model: injected)
        XCTAssertEqual(DateRangeFilter.surfaceSlug, "DateRangeFilter")
    }

    func testSubviewsCompose() {
        _ = DateRangeFilterField(
            start: .constant(Date()),
            end: .constant(Date()),
            startLabel: "Start date",
            endLabel: "End date"
        )
        _ = DateRangeFilterApplyButton(title: "Apply") {}
        _ = DateRangeFilterFlowLayout()
    }
}

// MARK: - Strings facade (P1/S10) — the accessibility-label sources

final class DateRangeFilterStringsTests: XCTestCase {
    func testStartLabelFallback() {
        XCTAssertEqual(DateRangeFilterStrings.startLabel, "Start date")
    }

    func testEndLabelFallback() {
        XCTAssertEqual(DateRangeFilterStrings.endLabel, "End date")
    }

    func testApplyLabelFallback() {
        XCTAssertEqual(DateRangeFilterStrings.applyLabel, "Apply")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: DateRangeFilterTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// A clock pinned to a fixed instant, so the active-preset resolution + unbound fallback are deterministic.
private struct FixedClock: DateRangeFilterClock {
    let instant: Date

    func now() -> Date {
        instant
    }
}
