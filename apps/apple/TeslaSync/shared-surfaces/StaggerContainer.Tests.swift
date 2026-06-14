//
//  StaggerContainer.Tests.swift
//  TeslaSync — P4 shared surface · 0193 · StaggerContainer (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in StaggerContainer.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • StaggerContainerModel — the once-only `view.opened`, the reveal phase flip (hidden → shown) + its
//      idempotence, the reduce-motion / props rebinds re-deriving the projection.
//    • StaggerContainerMotion — the child entrance animation is nil under reduced motion and present
//      otherwise, with the per-index cascade delay.
//    • Views — the public surface + the cascade child modifier + the empty leaf compose in every branch
//      (full motion / reduced / empty / injected model / stray child).
//    • Strings — the empty-leaf copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - StaggerContainerModel (lifecycle + reveal + rebinds)

@MainActor
final class StaggerContainerModelTests: XCTestCase {
    private func model(
        _ input: StaggerContainerInput = StaggerContainerInput(),
        reduceMotion: Bool = false,
        telemetry: StaggerContainerTelemetry = OSLogStaggerContainerTelemetry()
    ) -> StaggerContainerModel {
        StaggerContainerModel(input: input, reduceMotion: reduceMotion, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [StaggerContainerSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [StaggerContainerSurface.slug], "view.opened fires once per instance")
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
        XCTAssertEqual(holder.projection.staggerStepSeconds, 0.06, accuracy: 0.0001)
        XCTAssertEqual(holder.projection.childHiddenOffsetY, 15, accuracy: 0.0001)
        holder.update(reduceMotion: true)
        XCTAssertTrue(holder.projection.reduce)
        XCTAssertEqual(holder.projection.staggerStepSeconds, 0, accuracy: 0.0001)
        XCTAssertEqual(holder.projection.childHiddenOffsetY, 0, accuracy: 0.0001)
        XCTAssertEqual(holder.projection.childHiddenOpacity, 1, accuracy: 0.0001)
    }

    func testUpdateInputReDerivesProjection() {
        let holder = model(StaggerContainerInput(stepSeconds: 0.06))
        XCTAssertEqual(holder.projection.delaySeconds(forIndex: 5), 0.30, accuracy: 0.0001)
        holder.update(StaggerContainerInput(stepSeconds: 0.1))
        XCTAssertEqual(holder.projection.delaySeconds(forIndex: 5), 0.50, accuracy: 0.0001)
    }
}

// MARK: - StaggerContainerMotion (child entrance honors Reduce Motion + cascade)

@MainActor
final class StaggerContainerMotionTests: XCTestCase {
    func testChildEntranceIsNilUnderReducedMotion() {
        let projection = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: true)
        XCTAssertNil(StaggerContainerMotion.childEntrance(for: projection, index: 2))
    }

    func testChildEntrancePresentWhenMotionAllowed() {
        let projection = StaggerContainerProjector.resolve(StaggerContainerInput(), reduceMotion: false)
        XCTAssertNotNil(StaggerContainerMotion.childEntrance(for: projection, index: 0))
        XCTAssertNotNil(StaggerContainerMotion.childEntrance(for: projection, index: 4))
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class StaggerContainerViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = StaggerContainer {
            ForEach(0 ..< 3, id: \.self) { index in
                Text(verbatim: "row \(index)").staggerChild(index: index)
            }
        }
        _ = StaggerContainer(spacing: TSSpacing.lg, alignment: .center) {
            Text(verbatim: "centered").staggerChild(index: 0)
        }
        _ = StaggerContainer(stepSeconds: 0.1, childDurationMs: 200) {
            Text(verbatim: "custom timing").staggerChild(index: 1)
        }
        _ = StaggerContainer {
            StaggerContainerEmptyContent()
        }
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = StaggerContainerModel(input: StaggerContainerInput(), telemetry: SpyTelemetry())
        _ = StaggerContainer(model: injected) {
            Text(verbatim: "injected").staggerChild(index: 0)
        }
        XCTAssertEqual(StaggerContainer<Text>.surfaceSlug, "StaggerContainer")
    }

    func testCascadeChildAndEmptyLeafCompose() {
        _ = Text(verbatim: "stray").staggerChild(index: 3)
        _ = StaggerContainerChildModifier(index: 1)
        _ = StaggerContainerEmptyContent()
    }
}

// MARK: - Strings facade (P1/S10)

final class StaggerContainerStringsTests: XCTestCase {
    func testEmptyLeafFallbacks() {
        XCTAssertEqual(StaggerContainerStrings.emptyTitle, "Nothing to show yet")
        XCTAssertEqual(StaggerContainerStrings.emptyMessage, "Items appear here as they become available.")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: StaggerContainerTelemetry, @unchecked Sendable {
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
