//
//  FadeIn.Tests.swift
//  TeslaSync — P4 shared surface · 0191 · FadeIn (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in FadeIn.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • FadeInModel — the once-only `view.opened`, the reveal phase flip (hidden → shown) + its idempotence,
//      the reduce-motion / props rebinds re-deriving the projection.
//    • FadeInMotion — the entrance animation is nil under reduced motion and present otherwise.
//    • Views — the public surface + the subviews compose in every branch (full motion / reduced / empty /
//      injected model / delayed).
//    • Strings — the empty-leaf copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - FadeInModel (lifecycle + reveal + rebinds)

@MainActor
final class FadeInModelTests: XCTestCase {
    private func model(
        _ input: FadeInInput = FadeInInput(),
        reduceMotion: Bool = false,
        telemetry: FadeInTelemetry = OSLogFadeInTelemetry()
    ) -> FadeInModel {
        FadeInModel(input: input, reduceMotion: reduceMotion, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [FadeInSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [FadeInSurface.slug], "view.opened fires once per instance")
    }

    func testRevealFlipsPhaseToShownAndIsIdempotent() {
        let holder = model()
        XCTAssertEqual(holder.phase, .hidden)
        holder.reveal()
        XCTAssertEqual(holder.phase, .shown)
        holder.reveal()
        XCTAssertEqual(holder.phase, .shown)
    }

    func testResetReturnsToHidden() {
        let holder = model()
        holder.reveal()
        holder.reset()
        XCTAssertEqual(holder.phase, .hidden)
    }

    func testUpdateReduceMotionReDerivesProjection() {
        let holder = model()
        XCTAssertFalse(holder.projection.reduce)
        XCTAssertEqual(holder.projection.hiddenOffsetY, 12, accuracy: 0.0001)
        holder.update(reduceMotion: true)
        XCTAssertTrue(holder.projection.reduce)
        XCTAssertEqual(holder.projection.hiddenOffsetY, 0, accuracy: 0.0001)
        XCTAssertEqual(holder.projection.hiddenOpacity, 1, accuracy: 0.0001)
    }

    func testUpdateInputReDerivesProjection() {
        let holder = model(FadeInInput(delaySeconds: 0))
        XCTAssertEqual(holder.projection.delaySeconds, 0, accuracy: 0.0001)
        holder.update(FadeInInput(delaySeconds: 0.5))
        XCTAssertEqual(holder.projection.delaySeconds, 0.5, accuracy: 0.0001)
    }
}

// MARK: - FadeInMotion (entrance animation honors Reduce Motion)

@MainActor
final class FadeInMotionTests: XCTestCase {
    func testEntranceIsNilUnderReducedMotion() {
        let projection = FadeInProjector.resolve(FadeInInput(), reduceMotion: true)
        XCTAssertNil(FadeInMotion.entrance(for: projection))
    }

    func testEntrancePresentWhenMotionAllowed() {
        let projection = FadeInProjector.resolve(FadeInInput(delaySeconds: 0.2), reduceMotion: false)
        XCTAssertNotNil(FadeInMotion.entrance(for: projection))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class FadeInViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = FadeIn { Text(verbatim: "single") }
        _ = FadeIn(delay: 0.3) { Text(verbatim: "delayed") }
        _ = FadeIn(delay: 0.1, defaultMs: 200) { Text(verbatim: "custom duration") }
        _ = FadeIn { FadeInEmptyContent() }
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = FadeInModel(input: FadeInInput(delaySeconds: 0.2), telemetry: SpyTelemetry())
        _ = FadeIn(model: injected) { Text(verbatim: "injected") }
        XCTAssertEqual(FadeIn<Text>.surfaceSlug, "FadeIn")
    }

    func testSubviewsCompose() {
        let holder = FadeInModel(input: FadeInInput())
        _ = FadeInRevealModifier(model: holder)
        _ = FadeInEmptyContent()
    }
}

// MARK: - Strings facade (P1/S10)

final class FadeInStringsTests: XCTestCase {
    func testEmptyLeafFallbacks() {
        XCTAssertEqual(FadeInStrings.emptyTitle, "Nothing to show yet")
        XCTAssertEqual(FadeInStrings.emptyMessage, "Content appears here as it becomes available.")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: FadeInTelemetry, @unchecked Sendable {
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
