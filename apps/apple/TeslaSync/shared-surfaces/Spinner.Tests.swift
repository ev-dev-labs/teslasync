//
//  Spinner.Tests.swift
//  TeslaSync — P4 shared surface · 0140 · Spinner (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in Spinner.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • SpinnerModel — the once-only `view.opened`, the reduce-motion / props rebinds re-deriving the
//      projection, and the resolved accessibility + caption text (web `aria-label={label ?? 'Loading'}`).
//    • SpinnerMotion — the strike-draw cycle runs only when motion is allowed (honors Reduce Motion).
//    • Views — the public surface + the subviews compose in every real branch, and the bolt `Shape` traces
//      a non-empty outline inside its box.
//    • Strings — the `"Loading"` fallback + the accessibility-label resolver go through the P1/S10 facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - SpinnerModel (lifecycle + rebinds + resolved text)

@MainActor
final class SpinnerModelTests: XCTestCase {
    private func model(
        _ input: SpinnerInput = SpinnerInput(),
        reduceMotion: Bool = false,
        telemetry: SpinnerTelemetry = OSLogSpinnerTelemetry()
    ) -> SpinnerModel {
        SpinnerModel(input: input, reduceMotion: reduceMotion, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [SpinnerSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [SpinnerSurface.slug], "view.opened fires once per instance")
    }

    func testUpdateReduceMotionReDerivesProjection() {
        let holder = model()
        XCTAssertFalse(holder.projection.reduce)
        XCTAssertEqual(holder.projection.restingFillOpacity, 0, accuracy: 0.0001)
        holder.update(reduceMotion: true)
        XCTAssertTrue(holder.projection.reduce)
        XCTAssertEqual(holder.projection.restingFillOpacity, 1, accuracy: 0.0001)
    }

    func testUpdateInputReDerivesProjection() {
        let holder = model(SpinnerInput(size: .sm))
        XCTAssertEqual(holder.projection.dimension, 24, accuracy: 0.0001)
        holder.update(SpinnerInput(size: .lg))
        XCTAssertEqual(holder.projection.dimension, 80, accuracy: 0.0001)
    }

    func testAccessibilityLabelUsesProvidedLabelOrLoadingFallback() {
        XCTAssertEqual(model(SpinnerInput(label: "Loading drives…")).accessibilityLabel, "Loading drives…")
        XCTAssertEqual(model(SpinnerInput(label: nil)).accessibilityLabel, "Loading")
        XCTAssertEqual(model(SpinnerInput(label: "")).accessibilityLabel, "Loading")
    }

    func testCaptionTextMirrorsLabel() {
        XCTAssertEqual(model(SpinnerInput(label: "Loading drives…")).captionText, "Loading drives…")
        XCTAssertEqual(model(SpinnerInput(label: nil)).captionText, "")
    }
}

// MARK: - SpinnerMotion (honors Reduce Motion)

final class SpinnerMotionTests: XCTestCase {
    func testBoltAnimatesOnlyWhenMotionAllowed() {
        XCTAssertTrue(SpinnerMotion.boltAnimates(reduce: false))
        XCTAssertFalse(SpinnerMotion.boltAnimates(reduce: true))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class SpinnerViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = Spinner()
        _ = Spinner(size: .sm)
        _ = Spinner(size: .lg, label: "Loading drives…")
        _ = Spinner(model: SpinnerModel(input: SpinnerInput(size: .md), reduceMotion: true))
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = SpinnerModel(input: SpinnerInput(size: .lg, label: "Loading"), telemetry: SpyTelemetry())
        _ = Spinner(model: injected)
        XCTAssertEqual(Spinner.surfaceSlug, "Spinner")
    }

    func testSubviewsCompose() {
        let animated = SpinnerProjector.resolve(SpinnerInput(size: .md), reduceMotion: false)
        let reduced = SpinnerProjector.resolve(SpinnerInput(size: .lg), reduceMotion: true)
        _ = SpinnerBoltMark(projection: animated)
        _ = SpinnerBoltMark(projection: reduced)
        _ = SpinnerStaticBolt(projection: reduced)
        _ = SpinnerAnimatedBolt(projection: animated)
        _ = SpinnerBoltStroke.style(width: animated.strokeWidthPoints)
    }
}

// MARK: - Bolt Shape (web SVG path traces a non-empty outline)

final class SpinnerBoltShapeTests: XCTestCase {
    func testShapeTracesOutlineInsideItsBox() {
        let rect = CGRect(x: 0, y: 0, width: 100, height: 100)
        let path = SpinnerBoltShape().path(in: rect)
        XCTAssertFalse(path.isEmpty)
        XCTAssertTrue(rect.contains(path.boundingRect))
    }
}

// MARK: - Strings facade (P1/S10)

final class SpinnerStringsTests: XCTestCase {
    func testLoadingFallback() {
        XCTAssertEqual(SpinnerStrings.loading, "Loading")
    }

    func testAccessibilityLabelResolver() {
        XCTAssertEqual(SpinnerStrings.accessibilityLabel(for: "Loading drives…"), "Loading drives…")
        XCTAssertEqual(SpinnerStrings.accessibilityLabel(for: nil), "Loading")
        XCTAssertEqual(SpinnerStrings.accessibilityLabel(for: ""), "Loading")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: SpinnerTelemetry, @unchecked Sendable {
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
