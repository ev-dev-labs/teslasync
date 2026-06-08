//
//  DataPipelineSection.Tests.swift
//  TeslaSync — P4 feature view · 0242 · DataPipelineSection (Apple)
//
//  Unit coverage for the DataPipelineSection surface:
//    • Adapter — the number / percent / int / byte / date formatters (ports of
//      numberFormat.ts + dateFormat.ts + helpers.tsx `formatBytes`), the status
//      classification (web `getStatusIcon` / `statusToBadgeVariant`), and the
//      job-queue counts.
//    • State holder — `DataPipelineProjection` across loading / error / ready and the
//      resolved derivations (savings fraction, header badge flags), plus the
//      `DataPipelineModel` wiring, the P1/S11 `view.opened` telemetry, and the stale
//      auto-refresh transition.
//    • Accessibility — the VoiceOver row + compression label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryDataPipelineSource`, and the locale /
//  time zone are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let nyTimeZone = TimeZone(identifier: "America/New_York") ?? .gmt

private func job(
    id: String = "job",
    type: String = "drives",
    format: String = "csv",
    status: String,
    fileName: String = "export.csv",
    recordCount: Double = 0,
    createdAt: Date? = nil
) -> ExportJobItem {
    ExportJobItem(
        id: id,
        type: type,
        format: format,
        status: status,
        fileName: fileName,
        recordCount: recordCount,
        createdAt: createdAt
    )
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtPercent / fmtInt)

@MainActor
final class DataPipelineFormatNumberTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(DataPipelineFormat.number(1000, locale: enUS), "1,000.00")
        XCTAssertEqual(DataPipelineFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(DataPipelineFormat.number(0, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(DataPipelineFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(DataPipelineFormat.number(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(DataPipelineFormat.number(-.infinity, locale: enUS), "0.00")
    }

    func testPercentAppendsSign() {
        XCTAssertEqual(DataPipelineFormat.percent(62.4, locale: enUS), "62.40%")
        XCTAssertEqual(DataPipelineFormat.percent(100, locale: enUS), "100.00%")
    }

    func testIntGroupsWithoutDecimalsAndRoundsHalfAway() {
        XCTAssertEqual(DataPipelineFormat.int(1_842_390, locale: enUS), "1,842,390")
        XCTAssertEqual(DataPipelineFormat.int(1234.6, locale: enUS), "1,235")
        XCTAssertEqual(DataPipelineFormat.int(.nan, locale: enUS), "0")
    }
}

// MARK: - Byte ladder (port of helpers.tsx formatBytes)

@MainActor
final class DataPipelineFormatBytesTests: XCTestCase {
    func testZeroAndNonPositiveYieldZeroBytes() {
        XCTAssertEqual(DataPipelineFormat.bytes(0, locale: enUS), "0 B")
        XCTAssertEqual(DataPipelineFormat.bytes(-5, locale: enUS), "0 B")
        XCTAssertEqual(DataPipelineFormat.bytes(.nan, locale: enUS), "0 B")
    }

    func testScalesThrough1024Ladder() {
        XCTAssertEqual(DataPipelineFormat.bytes(1024, locale: enUS), "1.0 KB")
        XCTAssertEqual(DataPipelineFormat.bytes(1536, locale: enUS), "1.5 KB")
        XCTAssertEqual(DataPipelineFormat.bytes(5_368_709_120, locale: enUS), "5.0 GB")
    }

    func testSubKilobyteStaysInBytes() {
        XCTAssertEqual(DataPipelineFormat.bytes(512, locale: enUS), "512.0 B")
    }
}

// MARK: - Date formatting (port of dateFormat.ts formatDateTime)

@MainActor
final class DataPipelineFormatDateTests: XCTestCase {
    func testNilYieldsDash() {
        XCTAssertEqual(DataPipelineFormat.dateTime(nil, locale: enUS, timeZone: nyTimeZone), "—")
    }

    func testRendersLocaleOrderedDateTime() {
        var components = DateComponents()
        components.year = 2026
        components.month = 4
        components.day = 4
        components.hour = 9
        components.minute = 5
        components.timeZone = nyTimeZone
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = nyTimeZone
        let date = calendar.date(from: components)
        XCTAssertNotNil(date)

        let rendered = DataPipelineFormat.dateTime(date, locale: enUS, timeZone: nyTimeZone)
        XCTAssertTrue(rendered.contains("Apr"), rendered)
        XCTAssertTrue(rendered.contains("2026"), rendered)
        XCTAssertTrue(rendered.contains("9:05"), rendered)
    }
}

// MARK: - Status classification (web getStatusIcon / statusToBadgeVariant)

@MainActor
final class DataPipelineStatusKindTests: XCTestCase {
    func testClassifiesKnownStatesCaseInsensitively() {
        XCTAssertEqual(DataPipelineStatusKind(raw: "queued"), .queued)
        XCTAssertEqual(DataPipelineStatusKind(raw: "PROCESSING"), .processing)
        XCTAssertEqual(DataPipelineStatusKind(raw: "Ready"), .ready)
        XCTAssertEqual(DataPipelineStatusKind(raw: "failed"), .failed)
    }

    func testUnknownFallback() {
        XCTAssertEqual(DataPipelineStatusKind(raw: "paused"), .unknown)
        XCTAssertEqual(DataPipelineStatusKind(raw: ""), .unknown)
    }

    func testToneMapping() {
        XCTAssertEqual(DataPipelineStatusKind.ready.tone, .success)
        XCTAssertEqual(DataPipelineStatusKind.queued.tone, .warning)
        XCTAssertEqual(DataPipelineStatusKind.processing.tone, .warning)
        XCTAssertEqual(DataPipelineStatusKind.failed.tone, .danger)
        XCTAssertEqual(DataPipelineStatusKind.unknown.tone, .neutral)
    }

    func testSymbolMapping() {
        XCTAssertEqual(DataPipelineStatusKind.ready.symbolName, "checkmark.circle.fill")
        XCTAssertEqual(DataPipelineStatusKind.queued.symbolName, "exclamationmark.triangle.fill")
        XCTAssertEqual(DataPipelineStatusKind.failed.symbolName, "xmark.circle.fill")
        XCTAssertEqual(DataPipelineStatusKind.unknown.symbolName, "exclamationmark.triangle.fill")
    }

    func testLabelKeyAndFallback() {
        XCTAssertEqual(DataPipelineStatusKind.queued.labelKey, "status.queued")
        XCTAssertEqual(DataPipelineStatusKind.queued.labelFallback, "Queued")
        XCTAssertEqual(DataPipelineStatusKind.unknown.labelKey, "")
        XCTAssertEqual(DataPipelineStatusKind.unknown.labelFallback, "")
    }
}

// MARK: - Queue counts (web filter().length tallies)

@MainActor
final class DataPipelineCountsTests: XCTestCase {
    func testTalliesByStatus() {
        let counts = DataPipelineCounts.tally([
            job(status: "queued"),
            job(status: "processing"),
            job(status: "ready"),
            job(status: "ready"),
            job(status: "failed"),
            job(status: "paused")
        ])
        XCTAssertEqual(counts.pending, 1)
        XCTAssertEqual(counts.processing, 1)
        XCTAssertEqual(counts.completed, 2)
        XCTAssertEqual(counts.failed, 1)
        XCTAssertEqual(counts.active, 2)
    }

    func testEmptyListIsAllZero() {
        let counts = DataPipelineCounts.tally([])
        XCTAssertEqual(counts, DataPipelineCounts())
        XCTAssertEqual(counts.active, 0)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor
final class DataPipelineProjectionTests: XCTestCase {
    private let compression = CompressionSnapshot(
        savingsPercent: 62.4,
        estimatedSavedBytes: 5_368_709_120,
        totalPositions: 1_842_390,
        compressedPositions: 1_150_120
    )

    private var sampleJobs: [ExportJobItem] {
        [job(status: "queued"), job(status: "processing"), job(status: "ready"), job(status: "failed")]
    }

    func testErrorTakesPrecedence() {
        let resolved = DataPipelineProjection.resolve(
            DataPipelineInput(compression: compression, jobs: sampleJobs, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertFalse(resolved.hasCompression)
        XCTAssertTrue(resolved.jobs.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = DataPipelineProjection.resolve(DataPipelineInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.jobs.isEmpty)
    }

    func testReadyResolvesCompressionJobsAndCounts() {
        let resolved = DataPipelineProjection.resolve(
            DataPipelineInput(compression: compression, jobs: sampleJobs)
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertTrue(resolved.hasCompression)
        XCTAssertEqual(resolved.jobs.count, 4)
        XCTAssertEqual(resolved.counts.pending, 1)
        XCTAssertEqual(resolved.counts.processing, 1)
        XCTAssertEqual(resolved.counts.completed, 1)
        XCTAssertEqual(resolved.counts.failed, 1)
    }

    func testReadyWithNoSnapshotsIsEmptyButNotHidden() {
        let resolved = DataPipelineProjection.resolve(DataPipelineInput())
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertFalse(resolved.hasCompression)
        XCTAssertFalse(resolved.hasJobs)
        XCTAssertEqual(resolved.counts, DataPipelineCounts())
    }
}

// MARK: - Resolved derivations (gauge fraction + header badge flags)

@MainActor
final class DataPipelineResolvedTests: XCTestCase {
    private func resolved(_ input: DataPipelineInput) -> DataPipelineResolved {
        DataPipelineProjection.resolve(input)
    }

    func testSavingsFractionScalesAndClamps() {
        let normal = resolved(DataPipelineInput(compression: CompressionSnapshot(savingsPercent: 62.4)))
        XCTAssertEqual(normal.savingsFraction, 0.624, accuracy: 1e-9)

        let over = resolved(DataPipelineInput(compression: CompressionSnapshot(savingsPercent: 140)))
        XCTAssertEqual(over.savingsFraction, 1, accuracy: 1e-9)

        let none = resolved(DataPipelineInput())
        XCTAssertEqual(none.savingsFraction, 0, accuracy: 1e-9)
    }

    func testSavingsBadgeOnlyWithCompression() {
        XCTAssertTrue(resolved(DataPipelineInput(compression: CompressionSnapshot())).showSavingsBadge)
        XCTAssertFalse(resolved(DataPipelineInput()).showSavingsBadge)
    }

    func testActiveBadgeWhenPendingOrProcessing() {
        XCTAssertTrue(resolved(DataPipelineInput(jobs: [job(status: "queued")])).showActiveBadge)
        XCTAssertTrue(resolved(DataPipelineInput(jobs: [job(status: "processing")])).showActiveBadge)
        XCTAssertFalse(resolved(DataPipelineInput(jobs: [job(status: "ready")])).showActiveBadge)
        XCTAssertFalse(resolved(DataPipelineInput(jobs: [])).showActiveBadge)
    }

    func testStatusKindOnRow() {
        XCTAssertEqual(job(status: "ready").statusKind, .ready)
        XCTAssertEqual(job(status: "weird").statusKind, .unknown)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class DataPipelineModelTests: XCTestCase {
    private func makeModel(
        _ input: DataPipelineInput,
        telemetry: DataPipelineTelemetry = OSLogDataPipelineTelemetry()
    ) -> (DataPipelineModel, InMemoryDataPipelineSource) {
        let source = InMemoryDataPipelineSource(initial: input)
        let model = DataPipelineModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: DataPipelineInput {
        DataPipelineInput(
            compression: CompressionSnapshot(savingsPercent: 50),
            jobs: [job(status: "queued"), job(status: "ready")]
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyDataPipelineTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.resolved.jobs.count, 2)
        XCTAssertEqual(spy.surfaces, [DataPipelineSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(DataPipelineInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.jobs.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(DataPipelineInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.resolved.counts.active, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DataPipelineInput(compression: dataInput.compression, jobs: dataInput.jobs, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(DataPipelineInput(compression: dataInput.compression, jobs: dataInput.jobs, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(DataPipelineInput(compression: dataInput.compression, jobs: dataInput.jobs, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(DataPipelineSection.surfaceSlug, "DataPipelineSection")
    }
}

// MARK: - Accessibility summary content

@MainActor
final class DataPipelineAccessibilityTests: XCTestCase {
    func testRowLabelJoinsParts() {
        XCTAssertEqual(
            DataPipelineAccessibility.rowLabel(
                status: "Ready",
                type: "drives",
                records: "48,210 Records",
                created: "Apr 4, 2026, 9:05 AM"
            ),
            "Ready, drives, 48,210 Records, Apr 4, 2026, 9:05 AM"
        )
    }

    func testCompressionLabelJoinsParts() {
        XCTAssertEqual(
            DataPipelineAccessibility.compressionLabel(ratio: "62.40% saved", savings: "5.0 GB"),
            "62.40% saved, 5.0 GB"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDataPipelineTelemetry: DataPipelineTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
