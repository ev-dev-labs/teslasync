//
//  JobProgressDrawer.Tests.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  Adapter + accessibility coverage for the JobProgressDrawer surface:
//    • `ExportDrawerStatus` / `ExportDrawerKind` — active predicate, label resolution, and the
//      unknown-token passthrough (web `prettyType` / `prettyStatus` default arms).
//    • `ExportDrawerJob` — bucket, settled-at anchor, download path, format chip.
//    • `ExportDrawerBytesFormatter` — the faithful `formatBytes` port across every magnitude +
//      the zero-as-empty / null arms.
//    • `ExportDrawerRelative` — the `formatRelative` bucketing against a fixed clock, plus the
//      default date facade's localized rendering.
//    • `JobProgressDrawerProjection` — bucket split, recent cap, the drawer-state machine
//      (auto-promote + ambient hide + pinned suppression), the body phase, and the inline
//      failure envelope.
//    • `JobProgressDrawerAccessibility` — the chip / panel / row VoiceOver content.
//
//  The state-holder coverage lives in JobProgressDrawer.ModelTests.swift. Pure, bundle-free:
//  copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum JobDrawerSampleJobs {
    static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    static func processing(id: String = "1") -> ExportDrawerJob {
        ExportDrawerJob(
            id: id, kind: .drives, format: "csv", status: .processing,
            createdAt: anchor.addingTimeInterval(-90)
        )
    }

    static func queued(id: String = "2") -> ExportDrawerJob {
        ExportDrawerJob(
            id: id, kind: .charging, format: "json", status: .queued,
            createdAt: anchor.addingTimeInterval(-30)
        )
    }

    static func ready(id: String = "3") -> ExportDrawerJob {
        ExportDrawerJob(
            id: id, kind: .analytics, format: "csv", status: .ready,
            fileSize: 1_048_576, createdAt: anchor.addingTimeInterval(-3600),
            completedAt: anchor.addingTimeInterval(-3000)
        )
    }

    static func failed(id: String = "4") -> ExportDrawerJob {
        ExportDrawerJob(
            id: id, kind: .backup, format: "json", status: .failed,
            errorMessage: "Upstream timeout", createdAt: anchor.addingTimeInterval(-7200),
            completedAt: anchor.addingTimeInterval(-7000)
        )
    }

    static func manyRecent(_ count: Int) -> [ExportDrawerJob] {
        (0 ..< count).map { index in
            ExportDrawerJob(
                id: "r\(index)", kind: .drives, format: "csv", status: .ready,
                fileSize: 1024, createdAt: anchor.addingTimeInterval(Double(-index * 60))
            )
        }
    }
}

final class JobProgressDrawerAdapterTests: XCTestCase {
    // MARK: Status

    func testStatusActivePredicate() {
        XCTAssertTrue(ExportDrawerStatus.queued.isActive)
        XCTAssertTrue(ExportDrawerStatus.processing.isActive)
        XCTAssertFalse(ExportDrawerStatus.ready.isActive)
        XCTAssertFalse(ExportDrawerStatus.failed.isActive)
        XCTAssertFalse(ExportDrawerStatus.expired.isActive)
    }

    func testStatusLabelKeysAndFallbacks() {
        XCTAssertEqual(ExportDrawerStatus.queued.labelKey, "export.status.queued")
        XCTAssertEqual(ExportDrawerStatus.processing.labelFallback, "Processing")
        XCTAssertEqual(ExportDrawerStatus.expired.labelFallback, "Expired")
    }

    // MARK: Kind

    func testKindMapsKnownTokens() {
        XCTAssertEqual(ExportDrawerKind(raw: "account"), .account)
        XCTAssertEqual(ExportDrawerKind(raw: "import_drives"), .importDrives)
        XCTAssertEqual(ExportDrawerKind(raw: "import_charging"), .importCharging)
    }

    func testKindPreservesUnknownToken() {
        let kind = ExportDrawerKind(raw: "mystery")
        XCTAssertEqual(kind, .other("mystery"))
        XCTAssertNil(kind.labelKey)
        XCTAssertEqual(kind.label(localize: passthroughLocalize), "mystery")
    }

    func testKindKnownLabelResolves() {
        XCTAssertEqual(ExportDrawerKind.drives.label(localize: passthroughLocalize), "Drives")
        XCTAssertEqual(ExportDrawerKind.importDrives.label(localize: passthroughLocalize), "Import drives")
    }

    // MARK: Job

    func testJobBucketAndSettledAt() {
        XCTAssertEqual(JobDrawerSampleJobs.processing().bucket, .active)
        XCTAssertEqual(JobDrawerSampleJobs.ready().bucket, .recent)
        // settledAt prefers completed_at; falls back to created_at.
        XCTAssertEqual(JobDrawerSampleJobs.ready().settledAt, JobDrawerSampleJobs.anchor.addingTimeInterval(-3000))
        XCTAssertEqual(JobDrawerSampleJobs.queued().settledAt, JobDrawerSampleJobs.anchor.addingTimeInterval(-30))
    }

    func testJobDownloadPathAndFormatLabel() {
        XCTAssertEqual(JobDrawerSampleJobs.ready(id: "42").downloadPath, "/api/v1/export/jobs/42/download")
        XCTAssertEqual(JobDrawerSampleJobs.queued().formatLabel, "JSON")
    }

    // MARK: Bytes formatter

    func testBytesFormatterEmptyArms() {
        XCTAssertEqual(ExportDrawerBytesFormatter.string(nil), "—")
        XCTAssertEqual(ExportDrawerBytesFormatter.string(0, zeroAsEmpty: true), "—")
        XCTAssertEqual(ExportDrawerBytesFormatter.string(0, zeroAsEmpty: false), "0 B")
    }

    func testBytesFormatterMagnitudes() {
        XCTAssertEqual(ExportDrawerBytesFormatter.string(512), "512 B")
        XCTAssertEqual(ExportDrawerBytesFormatter.string(1536), "1.5 KB")
        XCTAssertEqual(ExportDrawerBytesFormatter.string(5_242_880), "5.0 MB")
        XCTAssertEqual(ExportDrawerBytesFormatter.string(1_073_741_824), "1.00 GB")
        XCTAssertEqual(ExportDrawerBytesFormatter.string(2_415_919_104), "2.25 GB")
    }

    // MARK: Relative

    func testRelativeBuckets() {
        let now = JobDrawerSampleJobs.anchor
        XCTAssertEqual(ExportDrawerRelative.from(nil, now: now), .empty)
        XCTAssertEqual(ExportDrawerRelative.from(now.addingTimeInterval(-30), now: now), .justNow)
        XCTAssertEqual(ExportDrawerRelative.from(now.addingTimeInterval(-90), now: now), .minutes(1))
        XCTAssertEqual(ExportDrawerRelative.from(now.addingTimeInterval(-3600), now: now), .hours(1))
        XCTAssertEqual(ExportDrawerRelative.from(now.addingTimeInterval(-90000), now: now), .days(1))
        XCTAssertEqual(
            ExportDrawerRelative.from(now.addingTimeInterval(-700_000), now: now),
            .absolute(now.addingTimeInterval(-700_000))
        )
    }

    func testRelativeBoundaryAtSixtySeconds() {
        let now = JobDrawerSampleJobs.anchor
        XCTAssertEqual(ExportDrawerRelative.from(now.addingTimeInterval(-59), now: now), .justNow)
        XCTAssertEqual(ExportDrawerRelative.from(now.addingTimeInterval(-60), now: now), .minutes(1))
    }

    func testDefaultDateFacadeRendersBuckets() {
        let facade = DefaultExportDrawerDateFormatting()
        XCTAssertEqual(facade.relative(.empty), "—")
        XCTAssertEqual(facade.relative(.justNow), "just now")
        XCTAssertEqual(facade.relative(.minutes(5)), "5m ago")
        XCTAssertEqual(facade.relative(.hours(3)), "3h ago")
        XCTAssertEqual(facade.relative(.days(4)), "4d ago")
        XCTAssertFalse(facade.relative(.absolute(JobDrawerSampleJobs.anchor)).isEmpty)
    }

    // MARK: Projection — buckets

    func testActiveAndRecentSplit() {
        let jobs = [
            JobDrawerSampleJobs.processing(),
            JobDrawerSampleJobs.queued(),
            JobDrawerSampleJobs.ready(),
            JobDrawerSampleJobs.failed()
        ]
        XCTAssertEqual(JobProgressDrawerProjection.activeJobs(jobs).map(\.id), ["1", "2"])
        XCTAssertEqual(JobProgressDrawerProjection.recentJobs(jobs, maxRecent: 5).map(\.id), ["3", "4"])
    }

    func testRecentCapAndZero() {
        let jobs = JobDrawerSampleJobs.manyRecent(7)
        XCTAssertEqual(JobProgressDrawerProjection.recentJobs(jobs, maxRecent: 5).count, 5)
        XCTAssertEqual(JobProgressDrawerProjection.recentJobs(jobs, maxRecent: 0).count, 0)
    }

    // MARK: Projection — state machine

    func testAutoPromoteFromDismissed() {
        XCTAssertTrue(JobProgressDrawerProjection.shouldPromoteFromDismissed(stored: .dismissed, hasActive: true))
        XCTAssertFalse(JobProgressDrawerProjection.shouldPromoteFromDismissed(stored: .dismissed, hasActive: false))
        XCTAssertFalse(JobProgressDrawerProjection.shouldPromoteFromDismissed(stored: .open, hasActive: true))
    }

    func testVisibilityDismissed() {
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .dismissed, hasActive: false, hasAny: true, isLoading: false, pinned: false
            ),
            .hidden
        )
        // A new active job promotes a dismissed drawer back to the minimized chip.
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .dismissed, hasActive: true, hasAny: true, isLoading: false, pinned: false
            ),
            .minimized
        )
    }

    func testVisibilityAmbientHideAndLoading() {
        // Zero jobs + settled + ambient → hidden (web `allJobs.length === 0 && !isLoading`).
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .minimized, hasActive: false, hasAny: false, isLoading: false, pinned: false
            ),
            .hidden
        )
        // Still loading → the chip stays.
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .minimized, hasActive: false, hasAny: false, isLoading: true, pinned: false
            ),
            .minimized
        )
    }

    func testVisibilityPinnedSuppressesAmbientHide() {
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .open, hasActive: false, hasAny: false, isLoading: false, pinned: true
            ),
            .open
        )
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .open, hasActive: false, hasAny: false, isLoading: false, pinned: false
            ),
            .hidden
        )
    }

    func testVisibilityOpenAndMinimizedWithJobs() {
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .open, hasActive: true, hasAny: true, isLoading: false, pinned: false
            ),
            .open
        )
        XCTAssertEqual(
            JobProgressDrawerProjection.resolveVisibility(
                stored: .minimized, hasActive: true, hasAny: true, isLoading: false, pinned: false
            ),
            .minimized
        )
    }

    // MARK: Projection — body phase + inline failure

    func testBodyPhase() {
        XCTAssertEqual(JobProgressDrawerProjection.bodyPhase(status: .loading, hasAny: false), .loading)
        XCTAssertEqual(JobProgressDrawerProjection.bodyPhase(status: .loading, hasAny: true), .populated)
        XCTAssertEqual(JobProgressDrawerProjection.bodyPhase(status: .loaded, hasAny: false), .empty)
        XCTAssertEqual(JobProgressDrawerProjection.bodyPhase(status: .loaded, hasAny: true), .populated)
        XCTAssertEqual(JobProgressDrawerProjection.bodyPhase(status: .failed("x"), hasAny: false), .error("x"))
        XCTAssertEqual(JobProgressDrawerProjection.bodyPhase(status: .failed("x"), hasAny: true), .populated)
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(JobProgressDrawerProjection.inlineFailure(status: .failed("boom"), hasAny: true), "boom")
        XCTAssertNil(JobProgressDrawerProjection.inlineFailure(status: .failed("boom"), hasAny: false))
        XCTAssertNil(JobProgressDrawerProjection.inlineFailure(status: .loaded, hasAny: true))
    }

    // MARK: Accessibility

    func testMinimizedAndPanelLabels() {
        XCTAssertEqual(
            JobProgressDrawerAccessibility.minimizedLabel(activeCount: 2, localize: passthroughLocalize),
            "Show export jobs (2 active)"
        )
        XCTAssertEqual(
            JobProgressDrawerAccessibility.panelLabel(localize: passthroughLocalize),
            "Export job progress"
        )
    }

    func testRowLabelComposition() {
        let label = JobProgressDrawerAccessibility.rowLabel(
            type: "Drives", format: "CSV", status: "Processing",
            detail: "Processing · started 1m ago", errorMessage: nil
        )
        XCTAssertEqual(label, "Drives, CSV, Processing, Processing · started 1m ago")
        let withError = JobProgressDrawerAccessibility.rowLabel(
            type: "Backup", format: "JSON", status: "Failed",
            detail: "— · 2m ago", errorMessage: "Upstream timeout"
        )
        XCTAssertTrue(withError.hasSuffix("Upstream timeout"))
    }
}
