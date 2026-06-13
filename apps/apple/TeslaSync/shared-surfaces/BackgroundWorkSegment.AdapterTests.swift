//
//  BackgroundWorkSegment.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + projection): the surface identity + cadence, the
//  connection axis, the kind→glyph map, the projector across loading / empty / error / active and the
//  oldest-first sort, the task-count summary (web `count === 1 ? one : many`), the tooltip + VoiceOver
//  builders (web `<Tooltip content>` + `aria-label`), and value-type equality. Split from
//  BackgroundWorkSegment.ModelTests.swift (the state-holder half) to keep each file within the SwiftLint
//  file-length budget. The derivation is pure — no network, no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class BackgroundWorkSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(BackgroundWorkSurface.slug, "BackgroundWorkSegment")
        XCTAssertEqual(BackgroundWorkSegment.surfaceSlug, "BackgroundWorkSegment")
    }

    func testPollCadenceMatchesWeb() {
        XCTAssertEqual(BackgroundWorkSurface.pollInterval, 5)
    }

    func testConnectionAxisCoversTheThreeLeafStates() {
        XCTAssertEqual(BackgroundWorkConnection.allCases, [.live, .stale, .offline])
    }
}

// MARK: - Kind → glyph (web KIND_ICON: FileDown / Save / Sparkles)

final class BackgroundJobKindTests: XCTestCase {
    func testSystemImagePeersTheWebIcons() {
        XCTAssertEqual(BackgroundJobKind.export.systemImage, "arrow.down.doc")
        XCTAssertEqual(BackgroundJobKind.mutation.systemImage, "square.and.arrow.down")
        XCTAssertEqual(BackgroundJobKind.custom.systemImage, "sparkles")
    }

    func testKindsCoverTheWebUnion() {
        XCTAssertEqual(BackgroundJobKind.allCases, [.export, .mutation, .custom])
    }

    func testAccessibilityKeysAndFallbacks() {
        XCTAssertEqual(BackgroundJobKind.export.accessibilityKey, "statusBar.background.kind.export")
        XCTAssertEqual(BackgroundJobKind.mutation.accessibilityFallback, "Saving")
        XCTAssertEqual(BackgroundJobKind.custom.accessibilityFallback, "Task")
    }
}

// MARK: - Projector (snapshot → resolved)

final class BackgroundWorkProjectorTests: XCTestCase {
    private func job(_ id: String, startedAt: String) -> BackgroundJob {
        BackgroundJob(id: id, kind: .custom, label: "Job \(id)", startedAt: startedAt)
    }

    func testEmptyWhenNoJobsAndQuiet() {
        XCTAssertEqual(BackgroundWorkProjection.resolve(BackgroundWorkSnapshot()).phase, .empty)
    }

    func testLoadingWhenNoJobsAndProbeInFlight() {
        XCTAssertEqual(BackgroundWorkProjection.resolve(BackgroundWorkSnapshot(isLoading: true)).phase, .loading)
    }

    func testErrorWhenNoJobsAndProbeFailed() {
        XCTAssertEqual(
            BackgroundWorkProjection.resolve(BackgroundWorkSnapshot(errorMessage: "boom")).phase,
            .error("boom")
        )
    }

    func testErrorTakesPrecedenceOverLoading() {
        let result = BackgroundWorkProjection.resolve(
            BackgroundWorkSnapshot(isLoading: true, errorMessage: "boom")
        )
        XCTAssertEqual(result.phase, .error("boom"))
    }

    func testEmptyErrorMessageIsNotAnError() {
        XCTAssertEqual(
            BackgroundWorkProjection.resolve(BackgroundWorkSnapshot(isLoading: true, errorMessage: "  ")).phase,
            .loading
        )
    }

    func testActiveWhenJobsPresentEvenWhileLoadingOrErrored() {
        let snapshot = BackgroundWorkSnapshot(
            jobs: [job("a", startedAt: "2026-01-01T00:00:00Z")],
            isLoading: true,
            errorMessage: "ignored"
        )
        let result = BackgroundWorkProjection.resolve(snapshot)
        XCTAssertEqual(result.phase, .active)
        XCTAssertEqual(result.data?.count, 1)
    }

    func testActiveSortsOldestFirstStabilisedById() {
        let snapshot = BackgroundWorkSnapshot(jobs: [
            job("z", startedAt: "2026-01-01T00:02:00Z"),
            job("b", startedAt: "2026-01-01T00:00:00Z"),
            job("a", startedAt: "2026-01-01T00:00:00Z")
        ])
        let ids = BackgroundWorkProjection.resolve(snapshot).data?.jobs.map(\.id)
        XCTAssertEqual(ids, ["a", "b", "z"])
    }

    func testNonEmptyTrimsAndNils() {
        XCTAssertNil(BackgroundWorkProjection.nonEmpty(nil))
        XCTAssertNil(BackgroundWorkProjection.nonEmpty("   "))
        XCTAssertEqual(BackgroundWorkProjection.nonEmpty("  x "), "x")
    }
}

// MARK: - Summary (web `count === 1 ? one : many`)

final class BackgroundWorkSummaryTests: XCTestCase {
    private let resolve: BackgroundWorkResolve = { _, fallback in fallback }

    func testOneTask() {
        XCTAssertEqual(BackgroundWorkSummary.text(count: 1, resolve: resolve), "1 task")
    }

    func testManyTasksInterpolatesCount() {
        XCTAssertEqual(BackgroundWorkSummary.text(count: 3, resolve: resolve), "3 tasks")
        XCTAssertEqual(BackgroundWorkSummary.text(count: 0, resolve: resolve), "0 tasks")
    }
}

// MARK: - Accessibility (tooltip + VoiceOver label)

final class BackgroundWorkAccessibilityTests: XCTestCase {
    func testTooltipJoinsWithMiddleDot() {
        let result = BackgroundWorkAccessibility.tooltip(prefix: "Background work in progress", summary: "2 tasks")
        XCTAssertEqual(result, "Background work in progress · 2 tasks")
    }

    func testSegmentLabelFormatsAriaAndSummary() {
        let result = BackgroundWorkAccessibility.segmentLabel(aria: "Background tasks", summary: "1 task")
        XCTAssertEqual(result, "Background tasks: 1 task")
    }
}

// MARK: - Value-type equality

final class BackgroundWorkValueTypeTests: XCTestCase {
    func testJobEquality() {
        let lhs = BackgroundJob(id: "1", kind: .export, label: "a.csv", description: "Queued", startedAt: "t")
        let rhs = BackgroundJob(id: "1", kind: .export, label: "a.csv", description: "Queued", startedAt: "t")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, BackgroundJob(id: "1", kind: .mutation, label: "a.csv", startedAt: "t"))
    }

    func testSnapshotEquality() {
        let job = BackgroundJob(id: "1", kind: .custom, label: "x", startedAt: "t")
        let lhs = BackgroundWorkSnapshot(jobs: [job], connection: .stale)
        let rhs = BackgroundWorkSnapshot(jobs: [job], connection: .stale)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, BackgroundWorkSnapshot(jobs: [job], connection: .offline))
    }

    func testExportOutcomeEquality() {
        XCTAssertEqual(
            ExportJobsProbeOutcome.failed(message: "x", offline: true),
            .failed(message: "x", offline: true)
        )
        XCTAssertNotEqual(
            ExportJobsProbeOutcome.failed(message: "x", offline: true),
            .failed(message: "x", offline: false)
        )
    }
}
