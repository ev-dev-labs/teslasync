//
//  VersionInfoWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0111 · VersionInfoWidget (Apple)
//
//  Unit coverage: adapter (cached → projection — defensive reads, truncatedSha,
//  kvItems / statItems, fmtNumber/fmtInt/formatBytes), state holder (phase/
//  freshness/telemetry/source wiring), registry, and the VoiceOver summary. No
//  network/real store — the model is driven by `InMemoryVersionInfoSource`.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Adapter: cached payload → projection (port parity with the web body)

@MainActor final class VersionInfoProjectionTests: XCTestCase {
    private func snapshot(
        chartVersion: String? = "v2.18.3", goVersion: String? = "go1.25.1",
        buildDate: String? = "2026-06-01", gitCommit: String? = "a1b2c3d4e5f6",
        uptime: String? = "12d 4h", osName: String? = "linux", arch: String? = "arm64",
        capture: VersionCaptureStats? = nil
    ) -> VersionInfoSnapshot {
        VersionInfoSnapshot(
            version: VersionInfoData(
                chartVersion: chartVersion, goVersion: goVersion, buildDate: buildDate,
                gitCommit: gitCommit, uptime: uptime, osName: osName, arch: arch
            ),
            capture: capture
        )
    }

    func testFullSnapshotMapsEveryField() {
        let vitals = VersionInfoProjection.vitals(from: snapshot(
            capture: VersionCaptureStats(
                signalsPerSec: 142.7, messagesToday: 1284, bytesProcessed: 2048, avgLatencyMs: 3.4
            )
        ))
        XCTAssertEqual(vitals.chartVersion, "v2.18.3")
        XCTAssertEqual(vitals.goVersion, "go1.25.1")
        XCTAssertEqual(vitals.buildDate, "2026-06-01")
        XCTAssertEqual(vitals.uptime, "12d 4h")
        XCTAssertEqual(vitals.osName, "linux")
        XCTAssertEqual(vitals.arch, "arm64")
        XCTAssertEqual(vitals.truncatedSha, "a1b2c3d")
        XCTAssertEqual(vitals.signalsPerSec, 142.7)
        XCTAssertEqual(vitals.messagesToday, 1284)
        XCTAssertEqual(vitals.bytesProcessed, 2048)
        XCTAssertEqual(vitals.avgLatency, 3.4)
    }

    func testEmptySnapshotFallsBackToEmDashAndZero() {
        let vitals = VersionInfoProjection.vitals(from: VersionInfoSnapshot())
        for value in [
            vitals.chartVersion,
            vitals.goVersion,
            vitals.buildDate,
            vitals.uptime,
            vitals.osName,
            vitals.arch,
            vitals.truncatedSha
        ] {
            XCTAssertEqual(value, "—")
        }
        XCTAssertNil(vitals.gitCommit)
        XCTAssertEqual(vitals.signalsPerSec, 0)
        XCTAssertEqual(vitals.messagesToday, 0)
        XCTAssertEqual(vitals.bytesProcessed, 0)
        XCTAssertEqual(vitals.avgLatency, 0)
    }

    func testMissingVersionFieldsFallThroughButCapturePresent() {
        // version.data present (so renderable) but its optional extras absent.
        let vitals = VersionInfoProjection.vitals(from: snapshot(
            buildDate: nil, gitCommit: nil, uptime: nil,
            capture: VersionCaptureStats(signalsPerSec: 5)
        ))
        XCTAssertEqual(vitals.buildDate, "—")
        XCTAssertEqual(vitals.uptime, "—")
        XCTAssertEqual(vitals.truncatedSha, "—")
        XCTAssertEqual(vitals.chartVersion, "v2.18.3")
        XCTAssertEqual(vitals.signalsPerSec, 5)
    }

    func testBlankWhitespaceFieldTreatedAsAbsent() {
        let vitals = VersionInfoProjection.vitals(from: snapshot(chartVersion: "   ", buildDate: ""))
        XCTAssertEqual(vitals.chartVersion, "—")
        XCTAssertEqual(vitals.buildDate, "—")
    }

    func testTruncatedShaTakesFirstSevenOrEmDash() {
        XCTAssertEqual(VersionInfoProjection.truncatedSha("a1b2c3d4e5f6a7b8"), "a1b2c3d")
        XCTAssertEqual(VersionInfoProjection.truncatedSha("abc"), "abc")
        XCTAssertEqual(VersionInfoProjection.truncatedSha(nil), "—")
    }

    func testKVItemsOrderLabelsAndAccents() {
        let vitals = VersionInfoProjection.vitals(from: snapshot())
        let items = VersionInfoProjection.kvItems(from: vitals)
        XCTAssertEqual(items.map(\.labelKey), [
            "widget.versionInfo.version", "widget.versionInfo.buildDate", "widget.versionInfo.gitSha",
            "widget.versionInfo.goVersion", "widget.versionInfo.uptime"
        ])
        XCTAssertEqual(items.map(\.defaultLabel), ["Version", "Build Date", "Git SHA", "Go Version", "Uptime"])
        // Version is bold; Git SHA is monospaced.
        XCTAssertTrue(items[0].isBold)
        XCTAssertTrue(items[2].isMono)
        XCTAssertEqual(items[2].value, "a1b2c3d")
        XCTAssertFalse(items[1].isBold)
        XCTAssertFalse(items[1].isMono)
    }

    func testStatItemsNarrowHasTwoWideHasFour() {
        let vitals = VersionInfoProjection.vitals(from: snapshot(
            capture: VersionCaptureStats(
                signalsPerSec: 142.7, messagesToday: 1_284_553, bytesProcessed: 4096, avgLatencyMs: 3.4
            )
        ))
        let narrow = VersionInfoProjection.statItems(from: vitals, isWide: false, locale: enUS)
        XCTAssertEqual(narrow.map(\.labelKey), [
            "widget.versionInfo.signalsPerSec", "widget.versionInfo.messagesToday"
        ])
        XCTAssertEqual(narrow[0].value, "142.7")
        XCTAssertEqual(narrow[1].value, "1,284,553")

        let wide = VersionInfoProjection.statItems(from: vitals, isWide: true, locale: enUS)
        XCTAssertEqual(wide.map(\.labelKey), [
            "widget.versionInfo.signalsPerSec", "widget.versionInfo.messagesToday",
            "widget.versionInfo.bytesProcessed", "widget.versionInfo.avgLatency"
        ])
        XCTAssertEqual(wide[2].value, "4.0 KB")
        XCTAssertEqual(wide[3].value, "3.4 ms")
    }
}

// MARK: - Formatters: fmtNumber + fmtInt + formatBytes + cell strings

@MainActor final class VersionInfoFormatTests: XCTestCase {
    func testNumberFixedPrecisionAndGrouping() {
        XCTAssertEqual(VersionInfoFormat.number(142.74, decimals: 1, locale: enUS), "142.7")
        XCTAssertEqual(VersionInfoFormat.number(1234.5, decimals: 0, locale: enUS), "1,235")
        XCTAssertEqual(VersionInfoFormat.number(Double.nan, decimals: 1, locale: enUS), "0.0")
        XCTAssertEqual(VersionInfoFormat.number(Double.infinity, decimals: 2, locale: enUS), "0.00")
    }

    func testIntGroupingRoundsHalfUp() {
        XCTAssertEqual(VersionInfoFormat.int(1_284_553, locale: enUS), "1,284,553")
        XCTAssertEqual(VersionInfoFormat.int(0, locale: enUS), "0")
        XCTAssertEqual(VersionInfoFormat.int(2.6, locale: enUS), "3")
    }

    func testLatencySuffix() {
        XCTAssertEqual(VersionInfoFormat.latency(3.42, locale: enUS), "3.4 ms")
        XCTAssertEqual(VersionInfoFormat.latency(0, locale: enUS), "0.0 ms")
    }

    func testBytesScalesAcrossBoundaries() {
        // Web formatBytes: B (fmtInt) → KB/MB (1 dp) → GB (2 dp).
        XCTAssertEqual(VersionInfoFormat.bytes(512, locale: enUS), "512 B")
        XCTAssertEqual(VersionInfoFormat.bytes(1023, locale: enUS), "1,023 B")
        XCTAssertEqual(VersionInfoFormat.bytes(1024, locale: enUS), "1.0 KB")
        XCTAssertEqual(VersionInfoFormat.bytes(1536, locale: enUS), "1.5 KB")
        XCTAssertEqual(VersionInfoFormat.bytes(1_048_576, locale: enUS), "1.0 MB")
        XCTAssertEqual(VersionInfoFormat.bytes(5_242_880, locale: enUS), "5.0 MB")
        XCTAssertEqual(VersionInfoFormat.bytes(1_073_741_824, locale: enUS), "1.00 GB")
        XCTAssertEqual(VersionInfoFormat.bytes(4_938_271_233, locale: enUS), "4.60 GB")
    }

    func testBytesHandlesNonFinite() {
        XCTAssertEqual(VersionInfoFormat.bytes(Double.nan, locale: enUS), "0 B")
    }
}

// MARK: - State holder: phases + freshness + telemetry + source wiring

@MainActor final class VersionInfoModelTests: XCTestCase {
    private func makeModel(
        _ update: VersionInfoUpdate,
        telemetry: VersionInfoTelemetry = OSLogVersionInfoTelemetry()
    ) -> (VersionInfoModel, InMemoryVersionInfoSource) {
        let source = InMemoryVersionInfoSource(initial: update)
        let model = VersionInfoModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func dataSnapshot() -> VersionInfoSnapshot {
        VersionInfoSnapshot(
            version: VersionInfoData(chartVersion: "v2.18.3", gitCommit: "a1b2c3d4"),
            capture: VersionCaptureStats(signalsPerSec: 10, messagesToday: 99)
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(VersionInfoUpdate(status: .loading, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutVersionShowsEmpty() {
        let (model, _) = makeModel(VersionInfoUpdate(status: .loaded, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithCaptureButNoVersionIsStillEmpty() {
        // hasData mirrors the web `version.data != null` — capture alone is not enough.
        let snap = VersionInfoSnapshot(version: nil, capture: VersionCaptureStats(signalsPerSec: 1))
        let (model, _) = makeModel(VersionInfoUpdate(status: .loaded, snapshot: snap))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(VersionInfoUpdate(status: .failed("boom"), snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(VersionInfoUpdate(status: .loading, snapshot: dataSnapshot()))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(VersionInfoUpdate(status: .failed("net"), snapshot: dataSnapshot()))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyVersionInfoTelemetry()
        let (model, source) = makeModel(VersionInfoUpdate(status: .loading, snapshot: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VersionInfoWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(VersionInfoUpdate(status: .loaded, snapshot: nil))
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testConnectionVitalsTrackUpdates() {
        let (model, source) = makeModel(VersionInfoUpdate(status: .loading, snapshot: nil))
        model.start()
        source.push(
            VersionInfoUpdate(status: .loaded, connection: .offline, snapshot: dataSnapshot(), updatedAt: Date())
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vitals.chartVersion, "v2.18.3")
        XCTAssertEqual(model.vitals.truncatedSha, "a1b2c3d")
        XCTAssertEqual(model.vitals.signalsPerSec, 10)
    }

    func testIsCompactAndIsWideThresholds() {
        XCTAssertTrue(VersionInfoModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(VersionInfoModel.isCompact(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(VersionInfoModel.isWide(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertTrue(VersionInfoModel.isWide(DashboardWidgetSize(cols: 4, rows: 3)))
    }
}

// MARK: - Registry parity

@MainActor final class VersionInfoRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = VersionInfoWidget.registration
        XCTAssertEqual(registration.id, "version-info")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = VersionInfoWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)), DashboardWidgetSize(cols: 2, rows: 6))
    }
}

// MARK: - Accessibility summary content

@MainActor final class VersionInfoAccessibilityTests: XCTestCase {
    private func vitals() -> VersionInfoVitals {
        VersionInfoProjection.vitals(from: VersionInfoSnapshot(
            version: VersionInfoData(
                chartVersion: "v2.18.3", goVersion: "go1.25.1", buildDate: "2026-06-01",
                gitCommit: "a1b2c3d4e5f6", uptime: "12d 4h", osName: "linux", arch: "arm64"
            ),
            capture: VersionCaptureStats(
                signalsPerSec: 142.7, messagesToday: 1284, bytesProcessed: 4096, avgLatencyMs: 3.4
            )
        ))
    }

    func testSummaryIncludesTitleKVAndStats() {
        let summary = VersionInfoAccessibility.summary(from: vitals(), isWide: false, locale: enUS)
        XCTAssertTrue(summary.contains("Version Info"))
        XCTAssertTrue(summary.contains("Version: v2.18.3"))
        XCTAssertTrue(summary.contains("Git SHA: a1b2c3d"))
        XCTAssertTrue(summary.contains("Signals/sec: 142.7"))
        XCTAssertTrue(summary.contains("Messages Today: 1,284"))
        // Narrow summary omits the wide-only OS/Arch + bytes/latency.
        XCTAssertFalse(summary.contains("Bytes Processed"))
    }

    func testWideSummaryAddsOsArchAndExtraStats() {
        let summary = VersionInfoAccessibility.summary(from: vitals(), isWide: true, locale: enUS)
        XCTAssertTrue(summary.contains("OS: linux"))
        XCTAssertTrue(summary.contains("Arch: arm64"))
        XCTAssertTrue(summary.contains("Bytes Processed: 4.0 KB"))
        XCTAssertTrue(summary.contains("Avg Latency: 3.4 ms"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVersionInfoTelemetry: VersionInfoTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
