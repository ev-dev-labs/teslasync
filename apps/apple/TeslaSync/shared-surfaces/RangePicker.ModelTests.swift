//
//  RangePicker.ModelTests.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The state-holder + calendar-geometry + view-composition half of the coverage (the pure adapter / presets
//  / projector live in RangePicker.Tests.swift; split for the SwiftLint file budget):
//    • RangePickerCalendarBuilder — the week start, the month grid (leading padding / day count / bounds),
//      the selection-role classification, the anchor month, and the multi-month sequence.
//    • RangePickerModel — the once-only `view.opened`, the phase derivation (loading / content / empty /
//      error), the stale auto-refresh-once + offline-keeps-cached freshness contract, the routed preset
//      commit + Apply (web `onChange`) and compare toggle (web `onCompareChange`), the staging lifecycle.
//    • Views — the public surface + subviews compose in every branch.
//  Deterministic: a fixed UTC calendar + clock; no network. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let mtCal = RangePickerDates.gregorian(timeZone: TimeZone(identifier: "UTC") ?? .current)

private func mtDay(_ year: Int, _ month: Int, _ day: Int) -> Date {
    mtCal.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) ?? Date()
}

private let mtNow = mtDay(2026, 3, 15)

// MARK: - Calendar geometry

final class RangePickerCalendarBuilderTests: XCTestCase {
    func testFirstWeekdayPerLanguage() {
        XCTAssertEqual(RangePickerCalendarBuilder.firstWeekday(forLanguage: "en"), 1)
        XCTAssertEqual(RangePickerCalendarBuilder.firstWeekday(forLanguage: "en-US"), 1)
        XCTAssertEqual(RangePickerCalendarBuilder.firstWeekday(forLanguage: "fr"), 2)
        XCTAssertEqual(RangePickerCalendarBuilder.firstWeekday(forLanguage: "de"), 2)
    }

    func testMonthGridShape() {
        let grid = RangePickerCalendarBuilder.monthGrid(
            monthStart: mtDay(2026, 3, 1), firstWeekday: 1, minISO: nil, maxISO: nil, calendar: mtCal
        )
        XCTAssertEqual(grid.id, "2026-03")
        XCTAssertTrue(grid.weeks.allSatisfy { $0.days.count == 7 })
        let realDays = grid.weeks.flatMap(\.days).filter { $0.iso != nil }
        XCTAssertEqual(realDays.count, 31)
        XCTAssertEqual(realDays.first?.dayNumber, 1)
        let weekday = mtCal.component(.weekday, from: mtDay(2026, 3, 1))
        let leading = grid.weeks.first?.days.prefix { $0.iso == nil }.count
        XCTAssertEqual(leading, ((weekday - 1) + 7) % 7)
    }

    func testMonthGridBounds() {
        let grid = RangePickerCalendarBuilder.monthGrid(
            monthStart: mtDay(2026, 3, 1), firstWeekday: 1,
            minISO: "2026-03-10", maxISO: "2026-03-20", calendar: mtCal
        )
        let days = grid.weeks.flatMap(\.days)
        func cell(_ number: Int) -> RangePickerDay? {
            days.first { $0.dayNumber == number }
        }
        XCTAssertEqual(cell(9)?.isDisabled, true)
        XCTAssertEqual(cell(10)?.isDisabled, false)
        XCTAssertEqual(cell(20)?.isDisabled, false)
        XCTAssertEqual(cell(21)?.isDisabled, true)
    }

    func testSelectionRoles() {
        let select = RangePickerCalendarBuilder.selection
        XCTAssertEqual(select("2026-03-05", "2026-03-05", "2026-03-10"), .start)
        XCTAssertEqual(select("2026-03-10", "2026-03-05", "2026-03-10"), .end)
        XCTAssertEqual(select("2026-03-07", "2026-03-05", "2026-03-10"), .inRange)
        XCTAssertEqual(select("2026-03-05", "2026-03-05", "2026-03-05"), .single)
        XCTAssertEqual(select("2026-03-05", "2026-03-05", nil), .single)
        XCTAssertEqual(select("2026-03-01", "2026-03-05", "2026-03-10"), .none)
        XCTAssertEqual(select("2026-03-05", nil, nil), .none)
    }

    func testAnchorMonthAndSequence() {
        let anchor = RangePickerCalendarBuilder.anchorMonth(endISO: "2026-03-15", maxISO: nil, calendar: mtCal)
        XCTAssertEqual(mtCal.component(.month, from: anchor), 3)
        let clamped = RangePickerCalendarBuilder.anchorMonth(
            endISO: "2026-05-20", maxISO: "2026-03-31", calendar: mtCal
        )
        XCTAssertEqual(mtCal.component(.month, from: clamped), 3)
        let grids = RangePickerCalendarBuilder.months(
            count: 2,
            anchor: mtDay(2026, 3, 15),
            config: RangePickerCalendarConfig(firstWeekday: 1, minISO: nil, maxISO: nil, calendar: mtCal)
        )
        XCTAssertEqual(grids.map(\.id), ["2026-03", "2026-04"])
    }
}

// MARK: - Model lifecycle + phase + freshness

@MainActor
final class RangePickerModelLifecycleTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyRangePickerTelemetry()
        let (model, _) = makeModel(telemetry: spy, autoStart: false)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RangePickerSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyRangePickerTelemetry()
        let (model, _) = makeModel(telemetry: spy, autoStart: false)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [RangePickerSurface.slug])
    }

    func testPhaseDerivation() {
        XCTAssertEqual(makeModel().0.phase, .content)
        XCTAssertEqual(makeModel(isLoading: true).0.phase, .loading)
        XCTAssertEqual(makeModel(errorMessage: "boom").0.phase, .error("boom"))
        XCTAssertEqual(makeModel(presetIDs: [], presetsOnly: true).0.phase, .empty)
    }

    func testStaleAutoRefreshesOnce() {
        let (_, source) = makeModel(connection: .stale)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineKeepsCachedWithoutRefetch() {
        let (model, source) = makeModel(connection: .offline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveDoesNotAutoRefresh() {
        let (model, source) = makeModel(connection: .live)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testDerivedBounds() {
        let (model, _) = makeModel(minDate: "2026-01-01")
        XCTAssertEqual(model.minISO, "2026-01-01")
        XCTAssertEqual(model.maxISO, "2026-03-31")
        XCTAssertEqual(model.firstWeekday, 1)
        XCTAssertEqual(model.projection.dayCount, 10)
    }
}

// MARK: - Model interactions

@MainActor
final class RangePickerModelInteractionTests: XCTestCase {
    func testSelectPresetCommitsAndCloses() {
        let recorder = ChangeRecorder()
        let (model, _) = makeModel(onChange: { recorder.record($0, $1) })
        model.setOpen(true)
        model.selectPreset("7d")
        XCTAssertEqual(recorder.ids, ["7d"])
        XCTAssertEqual(recorder.values.first, RangePickerValue(start: "2026-03-09", end: "2026-03-15"))
        XCTAssertFalse(model.isOpen)
    }

    func testSelectAllPresetAppliesMinDateFloor() {
        let recorder = ChangeRecorder()
        let (model, _) = makeModel(minDate: "2024-06-01", onChange: { recorder.record($0, $1) })
        model.selectPreset("all")
        XCTAssertEqual(recorder.values.first, RangePickerValue(start: "2024-06-01", end: "2026-03-15"))
        XCTAssertEqual(recorder.ids.first, "all")
    }

    func testOpenStagesCurrentRangeAndCloseClears() {
        let (model, _) = makeModel(value: RangePickerValue(start: "2026-03-01", end: "2026-03-10"))
        model.setOpen(true)
        XCTAssertEqual(model.stagedStart, "2026-03-01")
        XCTAssertEqual(model.stagedEnd, "2026-03-10")
        XCTAssertFalse(model.stagedDirty)
        model.setOpen(false)
        XCTAssertNil(model.stagedStart)
        XCTAssertNil(model.stagedEnd)
    }

    func testPickDaySequence() {
        let (model, _) = makeModel()
        model.setOpen(true)
        model.pickDay("2026-03-05")
        XCTAssertEqual(model.stagedStart, "2026-03-05")
        XCTAssertNil(model.stagedEnd)
        model.pickDay("2026-03-08")
        XCTAssertEqual(model.stagedEnd, "2026-03-08")
        XCTAssertTrue(model.stagedDirty)
        XCTAssertEqual(model.stagedDays, 4)
        model.pickDay("2026-03-02")
        XCTAssertEqual(model.stagedStart, "2026-03-02")
        XCTAssertNil(model.stagedEnd)
        model.pickDay("2026-03-01")
        XCTAssertEqual(model.stagedStart, "2026-03-01")
    }

    func testApplyCommitsStagedRange() {
        let recorder = ChangeRecorder()
        let (model, _) = makeModel(onChange: { recorder.record($0, $1) })
        model.setOpen(true)
        model.pickDay("2026-03-04")
        model.pickDay("2026-03-09")
        model.apply()
        XCTAssertEqual(recorder.values.first, RangePickerValue(start: "2026-03-04", end: "2026-03-09"))
        XCTAssertEqual(recorder.ids.first, .some(nil))
        XCTAssertFalse(model.isOpen)
    }

    func testApplyIsNoOpWhenIncomplete() {
        let recorder = ChangeRecorder()
        let (model, _) = makeModel(onChange: { recorder.record($0, $1) })
        model.setOpen(true)
        model.pickDay("2026-03-04")
        model.apply()
        XCTAssertTrue(recorder.values.isEmpty)
        XCTAssertTrue(model.isOpen)
    }

    func testCancelClosesAndDiscards() {
        let (model, _) = makeModel()
        model.setOpen(true)
        model.pickDay("2026-03-02")
        model.cancel()
        XCTAssertFalse(model.isOpen)
        XCTAssertNil(model.stagedStart)
    }

    func testCompareToggleNotifies() {
        let recorder = CompareRecorder()
        let (model, _) = makeModel(enableCompare: true, onCompareChange: { recorder.record($0) })
        model.setCompare(true)
        XCTAssertEqual(recorder.values, [true])
        XCTAssertTrue(model.compare)
    }

    func testToggleOpen() {
        let (model, _) = makeModel()
        XCTAssertFalse(model.isOpen)
        model.toggleOpen()
        XCTAssertTrue(model.isOpen)
        model.toggleOpen()
        XCTAssertFalse(model.isOpen)
    }
}

// MARK: - View composition

@MainActor
final class RangePickerViewCompositionTests: XCTestCase {
    func testSurfaceAndSubviewsCompose() {
        let (model, _) = makeModel()
        _ = RangePicker(model: model)
        _ = RangePicker(source: InMemoryRangePickerSource(
            snapshot: RangePickerSnapshot(input: RangePickerInput(value: RangePickerValue(start: "a", end: "b")))
        ))
        _ = RangePickerTrigger(projection: model.projection, size: .medium) {}
        _ = RangePickerPopoverContent(model: model)
        _ = RangePickerFooter(model: model)
        _ = RangePickerPresetList(presets: model.projection.presets) { _ in }
        _ = RangePickerLoadingTrigger(size: .small)
        _ = RangePickerErrorView(message: "x") {}
        _ = RangePickerEmptyContent()
        _ = RangePickerFreshnessChip(connection: .stale) {}
    }

    func testCalendarAndDayCellCompose() {
        let grid = RangePickerCalendarBuilder.monthGrid(
            monthStart: mtDay(2026, 3, 1), firstWeekday: 1, minISO: nil, maxISO: nil, calendar: mtCal
        )
        _ = RangePickerCalendarView(
            stagedStart: "2026-03-05", stagedEnd: "2026-03-10", endISO: "2026-03-15",
            minISO: nil, maxISO: "2026-03-31", firstWeekday: 1, calendar: mtCal
        ) { _ in }
        _ = RangePickerMonthView(
            grid: grid, firstWeekday: 1, stagedStart: nil, stagedEnd: nil, calendar: mtCal
        ) { _ in }
        let day = grid.weeks.flatMap(\.days).first { $0.iso == "2026-03-05" }
        _ = RangePickerDayCell(day: day ?? .padding(id: "x"), selection: .start, calendar: mtCal) { _ in }
        XCTAssertEqual(RangePicker.surfaceSlug, "RangePicker")
    }
}

// MARK: - Test doubles

@MainActor
private func makeModel(
    value: RangePickerValue = RangePickerValue(start: "2026-03-01", end: "2026-03-10"),
    presetIDs: [String] = RangePickerPresets.defaultIDs,
    minDate: String? = nil,
    presetsOnly: Bool = false,
    enableCompare: Bool = false,
    isLoading: Bool = false,
    errorMessage: String? = nil,
    connection: RangePickerConnection = .live,
    telemetry: any RangePickerTelemetry = OSLogRangePickerTelemetry(),
    onChange: @escaping @MainActor (RangePickerValue, String?) -> Void = { _, _ in },
    onCompareChange: (@MainActor (Bool) -> Void)? = nil,
    autoStart: Bool = true
) -> (RangePickerModel, InMemoryRangePickerSource) {
    let input = RangePickerInput(
        value: value, presetIDs: presetIDs, minDate: minDate, maxDate: "2026-03-31",
        enableCompare: enableCompare, presetsOnly: presetsOnly
    )
    let source = InMemoryRangePickerSource(snapshot: RangePickerSnapshot(
        input: input, isLoading: isLoading, errorMessage: errorMessage, connection: connection
    ))
    let model = RangePickerModel(
        source: source, onChange: onChange, onCompareChange: onCompareChange, telemetry: telemetry,
        now: { mtNow }, calendar: mtCal, locale: Locale(identifier: "en_US")
    )
    if autoStart { model.start() }
    return (model, source)
}

/// Records `viewOpened` surfaces; lock-guarded for the `Sendable` telemetry seam under Swift 6.
private final class SpyRangePickerTelemetry: RangePickerTelemetry, @unchecked Sendable {
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

/// Records the committed ranges routed through the page's `onChange` (web commit callback).
@MainActor
private final class ChangeRecorder {
    private(set) var values: [RangePickerValue] = []
    private(set) var ids: [String?] = []

    func record(_ value: RangePickerValue, _ id: String?) {
        values.append(value)
        ids.append(id)
    }
}

/// Records the compare-toggle flips routed through `onCompareChange`.
@MainActor
private final class CompareRecorder {
    private(set) var values: [Bool] = []

    func record(_ next: Bool) {
        values.append(next)
    }
}
