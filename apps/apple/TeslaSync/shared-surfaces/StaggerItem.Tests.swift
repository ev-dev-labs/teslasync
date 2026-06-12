//
//  StaggerItem.Tests.swift
//  TeslaSync — P4 shared surface · 0194 · StaggerItem (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in StaggerItem.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • StaggerItemModel — the once-only `view.opened`, the reveal phase flip (hidden → shown) + its
//      idempotence, the reduce-motion / props rebinds re-deriving the projection.
//    • StaggerItemMotion — the entrance animation is nil under reduced motion and present otherwise.
//    • Views — the public surface + the subviews compose in every branch (full motion / reduced / empty /
//      injected model / cascade index).
//    • Strings — the empty-leaf copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - StaggerItemModel (lifecycle + reveal + rebinds)

@MainActor
final class StaggerItemModelTests: XCTestCase {
    private func model(
        _ input: StaggerItemInput = StaggerItemInput(),
        reduceMotion: Bool = false,
        telemetry: StaggerItemTelemetry = OSLogStaggerItemTelemetry()
    ) -> StaggerItemModel {
        StaggerItemModel(input: input, reduceMotion: reduceMotion, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [StaggerItemSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [StaggerItemSurface.slug], "view.opened fires once per instance")
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
        XCTAssertEqual(holder.projection.hiddenOffsetY, 15, accuracy: 0.0001)
        holder.update(reduceMotion: true)
        XCTAssertTrue(holder.projection.reduce)
        XCTAssertEqual(holder.projection.hiddenOffsetY, 0, accuracy: 0.0001)
        XCTAssertEqual(holder.projection.hiddenOpacity, 1, accuracy: 0.0001)
    }

    func testUpdateInputReDerivesProjection() {
        let holder = model(StaggerItemInput(index: 0))
        XCTAssertEqual(holder.projection.staggerDelaySeconds, 0, accuracy: 0.0001)
        holder.update(StaggerItemInput(index: 5))
        XCTAssertEqual(holder.projection.staggerDelaySeconds, 0.30, accuracy: 0.0001)
    }
}

// MARK: - StaggerItemMotion (entrance animation honors Reduce Motion)

@MainActor
final class StaggerItemMotionTests: XCTestCase {
    func testEntranceIsNilUnderReducedMotion() {
        let projection = StaggerItemProjector.resolve(StaggerItemInput(), reduceMotion: true)
        XCTAssertNil(StaggerItemMotion.entrance(for: projection))
    }

    func testEntrancePresentWhenMotionAllowed() {
        let projection = StaggerItemProjector.resolve(StaggerItemInput(index: 2), reduceMotion: false)
        XCTAssertNotNil(StaggerItemMotion.entrance(for: projection))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class StaggerItemViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = StaggerItem { Text(verbatim: "single") }
        _ = StaggerItem(index: 3) { Text(verbatim: "cascade") }
        _ = StaggerItem(index: 1, defaultMs: 200) { Text(verbatim: "custom duration") }
        _ = StaggerItem { StaggerItemEmptyContent() }
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = StaggerItemModel(input: StaggerItemInput(index: 2), telemetry: SpyTelemetry())
        _ = StaggerItem(model: injected) { Text(verbatim: "injected") }
        XCTAssertEqual(StaggerItem<Text>.surfaceSlug, "StaggerItem")
    }

    func testSubviewsCompose() {
        let holder = StaggerItemModel(input: StaggerItemInput())
        _ = StaggerItemRevealModifier(model: holder)
        _ = StaggerItemEmptyContent()
    }
}

// MARK: - Strings facade (P1/S10)

final class StaggerItemStringsTests: XCTestCase {
    func testEmptyLeafFallbacks() {
        XCTAssertEqual(StaggerItemStrings.emptyTitle, "Nothing to show yet")
        XCTAssertEqual(StaggerItemStrings.emptyMessage, "Items appear here as they become available.")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: StaggerItemTelemetry, @unchecked Sendable {
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
