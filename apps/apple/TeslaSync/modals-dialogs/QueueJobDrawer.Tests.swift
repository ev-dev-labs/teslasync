//
//  QueueJobDrawer.Tests.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  Adapter + accessibility coverage for the QueueJobDrawer surface:
//    • `QueueJobStatusTone` — the faithful `STATUS_TONE` map across every notification / export /
//      automation status, plus the unmapped-token → neutral fallback (web `?? primary`).
//    • `QueueJobRowData` — the `title || id` fallback, the derived tone, and the error predicate.
//    • `QueueJobDurationFormatter` — the faithful `formatDurationMsLong` port across every
//      magnitude + the nullish / non-positive `—` arms.
//    • `QueueJobDrawerProjection` — the body phase, the inline reload-failure envelope, the
//      drawer title (with + without a worker name), and the resolved-duration source selection.
//    • `QueueJobDrawerAccessibility` — the close + row VoiceOver content.
//
//  The state-holder coverage lives in QueueJobDrawer.ModelTests.swift. Pure, bundle-free: copy
//  resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

final class QueueJobDrawerAdapterTests: XCTestCase {
    private let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    // MARK: Status tone (web `STATUS_TONE`)

    func testStatusToneSuccessBucket() {
        XCTAssertEqual(QueueJobStatusTone.from(status: "sent"), .success)
        XCTAssertEqual(QueueJobStatusTone.from(status: "ready"), .success)
        XCTAssertEqual(QueueJobStatusTone.from(status: "success"), .success)
    }

    func testStatusToneWarningBucket() {
        XCTAssertEqual(QueueJobStatusTone.from(status: "pending"), .warning)
        XCTAssertEqual(QueueJobStatusTone.from(status: "deferred_dnd"), .warning)
        XCTAssertEqual(QueueJobStatusTone.from(status: "queued"), .warning)
        XCTAssertEqual(QueueJobStatusTone.from(status: "partial"), .warning)
    }

    func testStatusToneInfoDangerMutedBuckets() {
        XCTAssertEqual(QueueJobStatusTone.from(status: "processing"), .info)
        XCTAssertEqual(QueueJobStatusTone.from(status: "running"), .info)
        XCTAssertEqual(QueueJobStatusTone.from(status: "failed"), .danger)
        XCTAssertEqual(QueueJobStatusTone.from(status: "cancelled"), .muted)
        XCTAssertEqual(QueueJobStatusTone.from(status: "skipped"), .muted)
    }

    func testStatusToneUnknownFallsBackToNeutral() {
        XCTAssertEqual(QueueJobStatusTone.from(status: "weird_state"), .neutral)
        XCTAssertEqual(QueueJobStatusTone.from(status: ""), .neutral)
    }

    // MARK: Row data

    func testDisplayTitleFallsBackToId() {
        let titled = QueueJobRowData(id: "9", worker: "w", status: "sent", title: "Digest", startedAt: anchor)
        XCTAssertEqual(titled.displayTitle, "Digest")
        let untitled = QueueJobRowData(id: "9", worker: "w", status: "sent", title: "", startedAt: anchor)
        XCTAssertEqual(untitled.displayTitle, "9")
    }

    func testRowDerivedToneAndErrorPredicate() {
        let failed = QueueJobRowData(
            id: "1", worker: "w", status: "failed", title: "t", startedAt: anchor, error: "boom"
        )
        XCTAssertEqual(failed.statusTone, .danger)
        XCTAssertTrue(failed.hasError)
        let emptyError = QueueJobRowData(id: "2", worker: "w", status: "sent", title: "t", startedAt: anchor, error: "")
        XCTAssertFalse(emptyError.hasError)
        let noError = QueueJobRowData(id: "3", worker: "w", status: "sent", title: "t", startedAt: anchor)
        XCTAssertFalse(noError.hasError)
    }

    // MARK: Duration formatter (web `formatDurationMsLong`)

    func testDurationFormatterEmptyArms() {
        XCTAssertEqual(QueueJobDurationFormatter.string(nil), "—")
        XCTAssertEqual(QueueJobDurationFormatter.string(0), "—")
        XCTAssertEqual(QueueJobDurationFormatter.string(-250), "—")
    }

    func testDurationFormatterMagnitudes() {
        XCTAssertEqual(QueueJobDurationFormatter.string(250), "250ms")
        XCTAssertEqual(QueueJobDurationFormatter.string(999), "999ms")
        XCTAssertEqual(QueueJobDurationFormatter.string(1000), "1.0s")
        XCTAssertEqual(QueueJobDurationFormatter.string(1500), "1.5s")
        XCTAssertEqual(QueueJobDurationFormatter.string(59000), "59.0s")
        XCTAssertEqual(QueueJobDurationFormatter.string(60000), "1m 0s")
        XCTAssertEqual(QueueJobDurationFormatter.string(65000), "1m 5s")
        XCTAssertEqual(QueueJobDurationFormatter.string(90000), "1m 30s")
        XCTAssertEqual(QueueJobDurationFormatter.string(3_661_000), "61m 1s")
    }

    // MARK: Projection — body phase

    func testBodyPhase() {
        XCTAssertEqual(QueueJobDrawerProjection.bodyPhase(status: .loading, hasJobs: false), .loading)
        XCTAssertEqual(QueueJobDrawerProjection.bodyPhase(status: .loading, hasJobs: true), .populated)
        XCTAssertEqual(QueueJobDrawerProjection.bodyPhase(status: .loaded, hasJobs: false), .empty)
        XCTAssertEqual(QueueJobDrawerProjection.bodyPhase(status: .loaded, hasJobs: true), .populated)
        XCTAssertEqual(QueueJobDrawerProjection.bodyPhase(status: .failed("x"), hasJobs: false), .error("x"))
        XCTAssertEqual(QueueJobDrawerProjection.bodyPhase(status: .failed("x"), hasJobs: true), .populated)
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(QueueJobDrawerProjection.inlineFailure(status: .failed("boom"), hasJobs: true), "boom")
        XCTAssertNil(QueueJobDrawerProjection.inlineFailure(status: .failed("boom"), hasJobs: false))
        XCTAssertNil(QueueJobDrawerProjection.inlineFailure(status: .loaded, hasJobs: true))
    }

    // MARK: Projection — title

    func testTitleWithAndWithoutWorkerName() {
        XCTAssertEqual(
            QueueJobDrawerProjection.title(displayName: "Notification", localize: passthroughLocalize),
            "Recent Notification jobs"
        )
        XCTAssertEqual(
            QueueJobDrawerProjection.title(displayName: nil, localize: passthroughLocalize),
            "Recent jobs"
        )
        XCTAssertEqual(
            QueueJobDrawerProjection.title(displayName: "", localize: passthroughLocalize),
            "Recent jobs"
        )
    }

    // MARK: Projection — resolved duration source (web `durationLabel` selection)

    func testResolvedDurationPrefersDurationMs() {
        // duration_ms present → used verbatim, even when finished_at would yield a different span.
        let ms = QueueJobDrawerProjection.resolvedDurationMs(
            durationMs: 500, startedAt: anchor, finishedAt: anchor.addingTimeInterval(60)
        )
        XCTAssertEqual(ms, 500)
    }

    func testResolvedDurationFallsBackToFinishedMinusStarted() {
        let ms = QueueJobDrawerProjection.resolvedDurationMs(
            durationMs: nil, startedAt: anchor, finishedAt: anchor.addingTimeInterval(60)
        )
        XCTAssertEqual(ms, 60000)
    }

    func testResolvedDurationNilWhenNeitherPresent() {
        XCTAssertNil(QueueJobDrawerProjection.resolvedDurationMs(
            durationMs: nil, startedAt: anchor, finishedAt: nil
        ))
    }

    // MARK: Accessibility

    func testCloseLabel() {
        XCTAssertEqual(QueueJobDrawerAccessibility.closeLabel(localize: passthroughLocalize), "Close")
    }

    func testRowLabelComposition() {
        let label = QueueJobDrawerAccessibility.rowLabel(
            title: "Charge complete", status: "Sent",
            detail: "Started Apr 4, 2026 · Took 1.5s", errorMessage: nil
        )
        XCTAssertEqual(label, "Charge complete, Sent, Started Apr 4, 2026 · Took 1.5s")
        let withError = QueueJobDrawerAccessibility.rowLabel(
            title: "Push", status: "Failed", detail: "Started Apr 4, 2026", errorMessage: "BadDeviceToken"
        )
        XCTAssertTrue(withError.hasSuffix("BadDeviceToken"))
    }
}
