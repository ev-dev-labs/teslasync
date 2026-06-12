//
//  SortControl.Tests.swift
//  TeslaSync — P4 shared surface · 0159 · SortControl (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in SortControl.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • SortControlModel — the once-only `view.opened`, the props/closure update guard, the routed field
//      selection (web `<select>` `onChange`) with its non-option guard, and the routed direction flip (web
//      `flip`) in both directions.
//    • Views — the public surface + the subviews compose in every branch (default / descending /
//      not-in-options / custom label / empty / injected-model).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let menuOptions: [SortOption] = [
    SortOption(value: "date", label: "Date"),
    SortOption(value: "distance", label: "Distance"),
    SortOption(value: "score", label: "Score")
]

// MARK: - SortControlModel (state + routing)

@MainActor
final class SortControlModelTests: XCTestCase {
    private func model(
        field: String = "date",
        direction: SortDirection = .asc,
        options: [SortOption] = menuOptions,
        onFieldChange: @escaping @MainActor (String) -> Void = { _ in },
        onDirectionChange: @escaping @MainActor (SortDirection) -> Void = { _ in },
        telemetry: SortControlTelemetry = OSLogSortControlTelemetry()
    ) -> SortControlModel {
        SortControlModel(
            input: SortControlInput(field: field, direction: direction, options: options),
            onFieldChange: onFieldChange,
            onDirectionChange: onDirectionChange,
            telemetry: telemetry,
            resolve: { _, fallback in fallback }
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [SortControlSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [SortControlSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let holder = model(field: "distance", direction: .desc)
        XCTAssertEqual(holder.projection.selectedOption?.value, "distance")
        XCTAssertEqual(holder.projection.directionSystemImage, "arrow.down")
        XCTAssertEqual(holder.projection.fieldMenuLabel, "Sort by")
    }

    func testSelectFieldReportsTheChosenField() {
        let recorder = FieldRecorder()
        let holder = model(onFieldChange: { recorder.record($0) })
        holder.selectField("score")
        XCTAssertEqual(recorder.values, ["score"])
    }

    func testSelectFieldGuardsAgainstNonOption() {
        let recorder = FieldRecorder()
        let holder = model(onFieldChange: { recorder.record($0) })
        holder.selectField("energy")
        XCTAssertTrue(recorder.values.isEmpty, "a field outside the options is never reported")
    }

    func testToggleDirectionReportsFlippedFromAsc() {
        let recorder = DirectionRecorder()
        let holder = model(direction: .asc, onDirectionChange: { recorder.record($0) })
        holder.toggleDirection()
        XCTAssertEqual(recorder.values, [.desc])
    }

    func testToggleDirectionReportsFlippedFromDesc() {
        let recorder = DirectionRecorder()
        let holder = model(direction: .desc, onDirectionChange: { recorder.record($0) })
        holder.toggleDirection()
        XCTAssertEqual(recorder.values, [.asc])
    }

    func testUpdateRefreshesPropsAndClosures() {
        let firstField = FieldRecorder()
        let secondField = FieldRecorder()
        let secondDirection = DirectionRecorder()
        let holder = model(onFieldChange: { firstField.record($0) })
        holder.update(
            SortControlInput(field: "distance", direction: .desc, options: menuOptions),
            onFieldChange: { secondField.record($0) },
            onDirectionChange: { secondDirection.record($0) }
        )
        XCTAssertEqual(holder.input.field, "distance")
        XCTAssertEqual(holder.input.direction, .desc)
        holder.selectField("score")
        holder.toggleDirection()
        XCTAssertEqual(secondField.values, ["score"], "the refreshed field closure receives the selection")
        XCTAssertEqual(secondDirection.values, [.asc], "the refreshed direction closure receives the flip")
        XCTAssertTrue(firstField.values.isEmpty, "the stale closure is no longer called")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class SortControlViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = SortControl(
            field: "distance",
            direction: .asc,
            options: menuOptions,
            onFieldChange: { _ in },
            onDirectionChange: { _ in }
        )
        _ = SortControl(
            field: "date",
            direction: .desc,
            options: menuOptions,
            onFieldChange: { _ in },
            onDirectionChange: { _ in }
        )
        _ = SortControl(
            field: "energy",
            direction: .desc,
            options: menuOptions,
            onFieldChange: { _ in },
            onDirectionChange: { _ in }
        )
        _ = SortControl(
            field: "score",
            direction: .asc,
            options: menuOptions,
            onFieldChange: { _ in },
            onDirectionChange: { _ in },
            directionAriaLabel: "Toggle ranking order",
            identifier: "drives-sort"
        )
        _ = SortControl(
            field: "date",
            direction: .asc,
            options: [],
            onFieldChange: { _ in },
            onDirectionChange: { _ in }
        )
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = SortControlModel(
            input: SortControlInput(field: "date", direction: .asc, options: menuOptions),
            telemetry: SpyTelemetry()
        )
        _ = SortControl(model: injected)
        XCTAssertEqual(SortControl.surfaceSlug, "SortControl")
    }

    func testSubviewsCompose() {
        let projection = SortControlProjector.resolve(
            SortControlInput(field: "distance", direction: .asc, options: menuOptions),
            strings: { _, fallback in fallback }
        )
        _ = SortControlFieldMenu(projection: projection, onSelect: { _ in })
        _ = SortControlDirectionButton(projection: projection, reduceMotion: false, action: {})
        _ = SortControlDirectionButton(projection: projection, reduceMotion: true, action: {})
        _ = SortControlEmptyFieldView()
        _ = SortControlRow(
            projection: projection,
            reduceMotion: false,
            onSelectField: { _ in },
            onToggleDirection: {}
        )
        let emptyProjection = SortControlProjector.resolve(
            SortControlInput(field: "date", direction: .asc, options: []),
            strings: { _, fallback in fallback }
        )
        _ = SortControlRow(
            projection: emptyProjection,
            reduceMotion: true,
            onSelectField: { _ in },
            onToggleDirection: {}
        )
    }
}

// MARK: - Strings facade (P1/S10)

final class SortControlStringsTests: XCTestCase {
    func testDirectionLabelFallbacks() {
        XCTAssertEqual(SortControlStrings.directionLabel(for: .asc), "Ascending")
        XCTAssertEqual(SortControlStrings.directionLabel(for: .desc), "Descending")
    }

    func testFieldDirectionAndEmptyFallbacks() {
        XCTAssertEqual(SortControlStrings.fieldMenuLabel, "Sort by")
        XCTAssertEqual(SortControlStrings.directionWord, "Sort direction")
        XCTAssertEqual(SortControlStrings.empty, "No sort fields")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: SortControlTelemetry, @unchecked Sendable {
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

/// Records the field keys the model reports through `onFieldChange` (the `@MainActor` selection seam).
@MainActor
private final class FieldRecorder {
    private(set) var values: [String] = []

    func record(_ value: String) {
        values.append(value)
    }
}

/// Records the directions the model reports through `onDirectionChange` (the `@MainActor` flip seam).
@MainActor
private final class DirectionRecorder {
    private(set) var values: [SortDirection] = []

    func record(_ direction: SortDirection) {
        values.append(direction)
    }
}
