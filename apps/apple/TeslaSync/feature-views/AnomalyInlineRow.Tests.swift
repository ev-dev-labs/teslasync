//
//  AnomalyInlineRow.Tests.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  Pure adapter + accessibility coverage for the AnomalyInlineRow surface — the faithful
//  port checks for features/system/components/status/AnomalyInlineRow.tsx:
//    • `AnomalyHealthStatus(severity:)` — the web `SEVERITY_TO_STATUS` map.
//    • `AnomalyInlineRowProjection` — the `webRendersRow` null decision, the resolved
//      content (status / summary), and the phase ladder incl. the cached-row survival.
//    • `AnomalyRelativeTime` — the `formatRelative` s/m/h/d ladder + the `recently` and
//      future-clamped branches.
//    • `AnomalyInlineRowProjection.summary` — the `${count} in 24h · ${signal} …` string.
//    • `AnomalyInlineRowAccessibility` — the `${label} — ${summary}` VoiceOver content.
//    • the `view.opened` telemetry slug + the click-through destination path.
//  The state-holder coverage lives in AnomalyInlineRow.ModelTests.swift. Pure,
//  bundle-free: copy resolves through an identity localizer.
//
//  The whole file is gated on `canImport(XCTest)`: the feature-views group is a member
//  of the app targets as well as the test bundle, and the app targets do not link
//  XCTest — the guard means this file compiles to nothing there while still compiling
//  and running in the XCTest bundle.
//

#if canImport(XCTest)
    import Foundation
    import XCTest
    @testable import TeslaSync

    /// Identity localizer: returns each call's English fallback so assertions read the
    /// real copy / templates without a bundle.
    private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

    private enum SampleAnomaly {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        static func entry(
            signal: String = "battery_temp",
            severity: AnomalySeverity = .critical,
            secondsAgo: TimeInterval = 300
        ) -> AnomalyEntryItem {
            AnomalyEntryItem(
                signal: signal,
                type: .zScore,
                severity: severity,
                detectedAt: now.addingTimeInterval(-secondsAgo),
                message: "deviation"
            )
        }

        static func data(
            count: Int = 3,
            entries: [AnomalyEntryItem]? = nil
        ) -> AnomalyData {
            AnomalyData(anomalies: entries ?? [entry()], anomaliesLast24h: count)
        }
    }

    // MARK: - Severity → status (web `SEVERITY_TO_STATUS`)

    final class AnomalyHealthStatusTests: XCTestCase {
        func testSeverityMapsToStatus() {
            XCTAssertEqual(AnomalyHealthStatus(severity: .critical), .unhealthy)
            XCTAssertEqual(AnomalyHealthStatus(severity: .warning), .degraded)
            XCTAssertEqual(AnomalyHealthStatus(severity: .info), .unknown)
        }

        func testAccessibilityDescriptorsAreDistinct() {
            let keys = AnomalyHealthStatus.allCases.map(\.accessibilityStatusKey)
            XCTAssertEqual(Set(keys).count, AnomalyHealthStatus.allCases.count)
            XCTAssertEqual(AnomalyHealthStatus.unhealthy.accessibilityStatusFallback, "Critical")
            XCTAssertEqual(AnomalyHealthStatus.degraded.accessibilityStatusFallback, "Warning")
            XCTAssertEqual(AnomalyHealthStatus.unknown.accessibilityStatusFallback, "Info")
        }
    }

    // MARK: - Projection: webRendersRow (web `return null` decision)

    final class AnomalyInlineRowProjectionTests: XCTestCase {
        func testWebRendersRowFalseWhenNoData() {
            XCTAssertFalse(AnomalyInlineRowProjection.webRendersRow(nil))
        }

        func testWebRendersRowFalseWhenZeroLast24h() {
            XCTAssertFalse(AnomalyInlineRowProjection.webRendersRow(SampleAnomaly.data(count: 0)))
        }

        func testWebRendersRowFalseWhenNoFirstEntry() {
            XCTAssertFalse(AnomalyInlineRowProjection.webRendersRow(SampleAnomaly.data(count: 3, entries: [])))
        }

        func testWebRendersRowTrueWhenRenderable() {
            XCTAssertTrue(AnomalyInlineRowProjection.webRendersRow(SampleAnomaly.data(count: 3)))
        }

        // MARK: content

        func testContentResolvesStatusSignalAndSummary() {
            let content = AnomalyInlineRowProjection.content(
                from: SampleAnomaly.data(
                    count: 3,
                    entries: [SampleAnomaly.entry(signal: "battery_temp", secondsAgo: 300)]
                ),
                now: SampleAnomaly.now,
                localize: passthroughLocalize
            )
            XCTAssertEqual(content?.status, .unhealthy)
            XCTAssertEqual(content?.signal, "battery_temp")
            XCTAssertEqual(content?.count, 3)
            XCTAssertEqual(content?.summary, "3 in 24h · battery_temp 5m ago")
            XCTAssertEqual(content?.destination, .anomalyDetection)
        }

        func testContentNilWhenDormant() {
            XCTAssertNil(
                AnomalyInlineRowProjection.content(
                    from: SampleAnomaly.data(count: 0),
                    now: SampleAnomaly.now,
                    localize: passthroughLocalize
                )
            )
        }

        // MARK: resolvePhase

        func testLoadingWithoutRenderableIsLoading() {
            XCTAssertEqual(
                AnomalyInlineRowProjection.resolvePhase(
                    status: .loading, data: nil, now: SampleAnomaly.now, localize: passthroughLocalize
                ),
                .loading
            )
        }

        func testLoadingWithCachedRenderableShowsContent() {
            let phase = AnomalyInlineRowProjection.resolvePhase(
                status: .loading, data: SampleAnomaly.data(), now: SampleAnomaly.now, localize: passthroughLocalize
            )
            guard case .content = phase else { return XCTFail("expected content, got \(phase)") }
        }

        func testLoadedDormantResolvesEmpty() {
            XCTAssertEqual(
                AnomalyInlineRowProjection.resolvePhase(
                    status: .loaded, data: SampleAnomaly.data(count: 0),
                    now: SampleAnomaly.now, localize: passthroughLocalize
                ),
                .empty
            )
        }

        func testLoadedRenderableResolvesContent() {
            let phase = AnomalyInlineRowProjection.resolvePhase(
                status: .loaded, data: SampleAnomaly.data(), now: SampleAnomaly.now, localize: passthroughLocalize
            )
            guard case .content = phase else { return XCTFail("expected content, got \(phase)") }
        }

        func testFailedWithoutCacheResolvesError() {
            XCTAssertEqual(
                AnomalyInlineRowProjection.resolvePhase(
                    status: .failed("boom"), data: nil, now: SampleAnomaly.now, localize: passthroughLocalize
                ),
                .error("boom")
            )
        }

        func testFailedWithCachedRenderableKeepsContent() {
            let phase = AnomalyInlineRowProjection.resolvePhase(
                status: .failed("stale read"), data: SampleAnomaly.data(),
                now: SampleAnomaly.now, localize: passthroughLocalize
            )
            guard case .content = phase else { return XCTFail("expected cached content, got \(phase)") }
        }

        // MARK: summary

        func testSummaryFormat() {
            XCTAssertEqual(
                AnomalyInlineRowProjection.summary(
                    count: 12, signal: "tire_pressure_fl", relative: "2h ago", localize: passthroughLocalize
                ),
                "12 in 24h · tire_pressure_fl 2h ago"
            )
        }
    }

    // MARK: - Relative time (web `formatRelative`)

    final class AnomalyRelativeTimeTests: XCTestCase {
        private let now = Date(timeIntervalSince1970: 2_000_000)

        private func relative(secondsAgo: TimeInterval?) -> String {
            let detectedAt = secondsAgo.map { now.addingTimeInterval(-$0) }
            return AnomalyRelativeTime.relative(from: detectedAt, now: now, localize: passthroughLocalize)
        }

        func testNilTimestampIsRecently() {
            XCTAssertEqual(relative(secondsAgo: nil), "recently")
        }

        func testSeconds() {
            XCTAssertEqual(relative(secondsAgo: 0), "0s ago")
            XCTAssertEqual(relative(secondsAgo: 30), "30s ago")
            XCTAssertEqual(relative(secondsAgo: 59), "59s ago")
        }

        func testMinutes() {
            XCTAssertEqual(relative(secondsAgo: 60), "1m ago")
            XCTAssertEqual(relative(secondsAgo: 300), "5m ago")
            XCTAssertEqual(relative(secondsAgo: 3599), "59m ago")
        }

        func testHours() {
            XCTAssertEqual(relative(secondsAgo: 3600), "1h ago")
            XCTAssertEqual(relative(secondsAgo: 3 * 3600), "3h ago")
        }

        func testDays() {
            XCTAssertEqual(relative(secondsAgo: 86400), "1d ago")
            XCTAssertEqual(relative(secondsAgo: 2 * 86400), "2d ago")
        }

        func testFutureTimestampClampsToZeroSeconds() {
            XCTAssertEqual(relative(secondsAgo: -10), "0s ago")
        }
    }

    // MARK: - Accessibility + identity

    final class AnomalyInlineRowAccessibilityTests: XCTestCase {
        func testRowLabelMatchesWebAria() {
            let label = AnomalyInlineRowAccessibility.rowLabel(
                summary: "3 in 24h · battery_temp 5m ago", localize: passthroughLocalize
            )
            XCTAssertEqual(label, "Anomalies — 3 in 24h · battery_temp 5m ago")
        }

        func testEmptyLabel() {
            XCTAssertEqual(
                AnomalyInlineRowAccessibility.emptyLabel(localize: passthroughLocalize),
                "Anomalies — No anomalies in the last 24h"
            )
        }

        func testSurfaceSlugIsStable() {
            XCTAssertEqual(AnomalyInlineRowSurface.slug, "AnomalyInlineRow")
            XCTAssertEqual(AnomalyInlineRow.surfaceSlug, "AnomalyInlineRow")
        }

        func testReportOpenEmitsViewOpenedWithSlug() {
            let sink = BufferedAnomalyInlineRowTelemetry()
            AnomalyInlineRowSurface.reportOpen(to: sink)
            XCTAssertEqual(sink.opened, ["AnomalyInlineRow"])
        }

        func testDestinationPathMatchesWeb() {
            XCTAssertEqual(AnomalyInlineRowDestination.anomalyDetection.path, "/anomaly-detection")
        }
    }

    // MARK: - Test doubles

    /// A thread-safe buffered diagnostics sink for asserting the `view.opened` slug.
    private final class BufferedAnomalyInlineRowTelemetry: AnomalyInlineRowTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var buffer: [String] = []

        var opened: [String] {
            lock.lock()
            defer { lock.unlock() }
            return buffer
        }

        func viewOpened(surface: String) {
            lock.lock()
            defer { lock.unlock() }
            buffer.append(surface)
        }
    }
#endif
