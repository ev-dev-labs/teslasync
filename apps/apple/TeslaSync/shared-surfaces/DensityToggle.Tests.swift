//
//  DensityToggle.Tests.swift
//  TeslaSync — P4 shared surface · 0153 · DensityToggle (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in DensityToggle.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • DensityToggleModel — the once-only `view.opened`, the props/closure update guard, the routed direct
//      selection (web `onClick`) with its non-option guard, and the routed arrow-key move (web `onKeyDown`)
//      with wraparound + the not-in-options no-op.
//    • Views — the public surface + the subviews compose in every branch (default / constrained / custom
//      label / empty / injected-model).
//    • Strings — the copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DensityToggleModel (state + routing)

@MainActor
final class DensityToggleModelTests: XCTestCase {
    private func model(
        _ input: DensityToggleInput,
        onChange: @escaping @MainActor (Density) -> Void = { _ in },
        telemetry: DensityToggleTelemetry = OSLogDensityToggleTelemetry()
    ) -> DensityToggleModel {
        DensityToggleModel(input: input, onChange: onChange, telemetry: telemetry, resolve: { _, fallback in fallback })
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(DensityToggleInput(value: .table), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DensityToggleSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(DensityToggleInput(value: .table), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [DensityToggleSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let holder = model(DensityToggleInput(value: .compact, options: [.compact, .comfortable]))
        XCTAssertEqual(holder.projection.segments.count, 2)
        XCTAssertEqual(holder.projection.selectedIndex, 0)
        XCTAssertEqual(holder.projection.groupLabel, "List density")
    }

    func testSelectReportsTheChosenDensity() {
        let recorder = Recorder()
        let holder = model(DensityToggleInput(value: .table), onChange: { recorder.record($0) })
        holder.select(.comfortable)
        XCTAssertEqual(recorder.values, [.comfortable])
    }

    func testSelectGuardsAgainstNonOption() {
        let recorder = Recorder()
        let holder = model(
            DensityToggleInput(value: .compact, options: [.compact, .comfortable]),
            onChange: { recorder.record($0) }
        )
        holder.select(.table)
        XCTAssertTrue(recorder.values.isEmpty, "a density outside the options is never reported")
    }

    func testMoveForwardReportsNextAndWraps() {
        let recorder = Recorder()
        let holder = model(DensityToggleInput(value: .comfortable), onChange: { recorder.record($0) })
        holder.move(.forward)
        XCTAssertEqual(recorder.values, [.table], "forward from the last option wraps to the first")
    }

    func testMoveBackwardReportsPreviousAndWraps() {
        let recorder = Recorder()
        let holder = model(DensityToggleInput(value: .table), onChange: { recorder.record($0) })
        holder.move(.backward)
        XCTAssertEqual(recorder.values, [.comfortable], "backward from the first option wraps to the last")
    }

    func testMoveIsNoOpWhenValueNotInOptions() {
        let recorder = Recorder()
        let holder = model(
            DensityToggleInput(value: .table, options: [.compact, .comfortable]),
            onChange: { recorder.record($0) }
        )
        holder.move(.forward)
        XCTAssertTrue(recorder.values.isEmpty)
    }

    func testUpdateRefreshesPropsAndClosure() {
        let first = Recorder()
        let second = Recorder()
        let holder = model(DensityToggleInput(value: .table), onChange: { first.record($0) })
        holder.update(
            DensityToggleInput(value: .compact, options: [.compact, .comfortable]),
            onChange: { second.record($0) }
        )
        XCTAssertEqual(holder.input.value, .compact)
        XCTAssertEqual(holder.projection.segments.count, 2)
        holder.select(.comfortable)
        XCTAssertEqual(second.values, [.comfortable], "the refreshed closure receives the selection")
        XCTAssertTrue(first.values.isEmpty, "the stale closure is no longer called")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class DensityToggleViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = DensityToggle(value: .comfortable, onChange: { _ in })
        _ = DensityToggle(value: .compact, onChange: { _ in }, options: [.compact, .comfortable])
        _ = DensityToggle(value: .table, onChange: { _ in }, ariaLabel: "Row spacing")
        _ = DensityToggle(value: .table, onChange: { _ in }, options: [], identifier: "dt")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = DensityToggleModel(input: DensityToggleInput(value: .table), telemetry: SpyTelemetry())
        _ = DensityToggle(model: injected)
        XCTAssertEqual(DensityToggle.surfaceSlug, "DensityToggle")
    }

    func testSubviewsCompose() {
        let projection = DensityToggleProjector.resolve(
            DensityToggleInput(value: .table),
            strings: { _, fallback in fallback }
        )
        _ = DensityToggleTrack(
            projection: projection,
            showsLabels: true,
            reduceMotion: false,
            onSelect: { _ in },
            onMove: { _ in }
        )
        let segment = projection.segments[0]
        _ = DensitySegmentButton(segment: segment, showsLabel: true, reduceMotion: false, identifier: "dt-table") {}
        _ = DensitySegmentButton(segment: segment, showsLabel: false, reduceMotion: true, identifier: "dt-table") {}
        _ = DensityToggleEmptyView()
    }
}

// MARK: - Strings facade (P1/S10)

final class DensityToggleStringsTests: XCTestCase {
    func testOptionLabelFallbacks() {
        XCTAssertEqual(DensityToggleStrings.label(for: .table), "Table")
        XCTAssertEqual(DensityToggleStrings.label(for: .compact), "Compact")
        XCTAssertEqual(DensityToggleStrings.label(for: .comfortable), "Comfortable")
    }

    func testGroupAndEmptyFallbacks() {
        XCTAssertEqual(DensityToggleStrings.groupLabel, "List density")
        XCTAssertEqual(DensityToggleStrings.empty, "No density options")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: DensityToggleTelemetry, @unchecked Sendable {
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

/// Records the densities the model reports through `onChange` (the `@MainActor` selection seam).
@MainActor
private final class Recorder {
    private(set) var values: [Density] = []

    func record(_ density: Density) {
        values.append(density)
    }
}
