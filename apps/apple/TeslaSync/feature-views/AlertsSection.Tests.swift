//
//  AlertsSection.Tests.swift
//  TeslaSync — P4 feature view · 0071 · AlertsSection (Apple)
//
//  Unit coverage for the AlertsSection surface:
//    • Adapter (`AlertsProjection`) — severity ordering + kind mapping, the
//      capitalized-raw-key fallback for unknown severities, negative-count clamping,
//      the donut fraction, content/empty/loading/error phase resolution, and the
//      `fmtInt` parity (parity with the web `metrics.alertsByType` / `alertTotal` /
//      `alertPieData` consumer).
//    • State holder (`AlertsSectionModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (exactly once, re-armed on return to live), and offline keeping cached counts.
//    • Accessibility — the section summary + per-row VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (alertsByType / alertPieData consumer parity)

final class AlertsProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testDataSortsBySeverityPriorityThenKey() {
        let data = AlertsProjection.data(from: [
            "info": 2,
            "critical": 5,
            "warning": 3,
            "zeta": 1,
            "debug": 4
        ])
        XCTAssertEqual(data.map(\.rawKey), ["critical", "warning", "info", "debug", "zeta"])
        XCTAssertEqual(data.map(\.kind), [.critical, .warning, .info, .other, .other])
    }

    func testKindMappingIsCaseInsensitive() {
        XCTAssertEqual(AlertSeverityKind.from("CRITICAL"), .critical)
        XCTAssertEqual(AlertSeverityKind.from("Warning"), .warning)
        XCTAssertEqual(AlertSeverityKind.from("info"), .info)
        XCTAssertEqual(AlertSeverityKind.from("battery_low"), .other)
    }

    func testUnknownSeverityLabelUsesCapitalizedRawKey() {
        let data = AlertsProjection.data(from: ["debug": 4])
        XCTAssertEqual(data.first?.label(localize: echo), "Debug")
    }

    func testKnownSeverityLabelUsesLocalizedName() {
        let data = AlertsProjection.data(from: ["critical": 1])
        XCTAssertEqual(data.first?.label(localize: echo), "Critical")
    }

    func testCapitalizeFirstMatchesWebSlice() {
        XCTAssertEqual(AlertsProjection.capitalizeFirst("debug"), "Debug")
        XCTAssertEqual(AlertsProjection.capitalizeFirst(""), "")
        XCTAssertEqual(AlertsProjection.capitalizeFirst("aBC"), "ABC")
    }

    func testNegativeCountsClampToZero() {
        let data = AlertsProjection.data(from: ["critical": -3])
        XCTAssertEqual(data.first?.count, 0)
    }

    func testTotal() {
        let data = AlertsProjection.data(from: ["critical": 5, "warning": 3, "info": 2])
        XCTAssertEqual(AlertsProjection.total(data), 10)
    }

    func testFractionIsSliceShare() throws {
        let data = AlertsProjection.data(from: ["critical": 5, "warning": 15])
        let critical = try XCTUnwrap(data.first { $0.kind == .critical })
        XCTAssertEqual(AlertsProjection.fraction(critical, of: data), 0.25, accuracy: 0.0001)
    }

    func testFractionGuardsAgainstEmpty() {
        let datum = AlertSeverityDatum(rawKey: "critical", kind: .critical, count: 0)
        XCTAssertEqual(AlertsProjection.fraction(datum, of: []), 0)
    }

    func testResolvePhase() {
        XCTAssertEqual(AlertsProjection.resolvePhase(.loading, total: 0), .loading)
        XCTAssertEqual(AlertsProjection.resolvePhase(.loaded, total: 7), .content)
        XCTAssertEqual(AlertsProjection.resolvePhase(.loaded, total: 0), .empty)
        XCTAssertEqual(AlertsProjection.resolvePhase(.failed("boom"), total: 7), .error("boom"))
    }

    func testCountFormatGroupsThousands() {
        XCTAssertEqual(AlertsFormat.count(1234, locale: Locale(identifier: "en_US")), "1,234")
        XCTAssertEqual(AlertsFormat.count(7, locale: Locale(identifier: "en_US")), "7")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AlertsSectionSurface.slug, "AlertsSection")
        XCTAssertEqual(AlertsSection.surfaceSlug, "AlertsSection")
    }
}

// MARK: - State holder: AlertsSectionModel

@MainActor
final class AlertsSectionModelTests: XCTestCase {
    private func makeModel(
        initial: AlertsUpdate?,
        telemetry: AlertsSectionTelemetry = SpyAlertsTelemetry()
    ) -> (AlertsSectionModel, InMemoryAlertsSectionSource) {
        let source = InMemoryAlertsSectionSource(initial: initial)
        let model = AlertsSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsDataAndTotal() {
        let counts = ["critical": 3, "warning": 4, "info": 1]
        let (model, source) = makeModel(initial: AlertsUpdate(status: .loaded, counts: counts))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.data.count, 3)
        XCTAssertEqual(model.data.map(\.kind), [.critical, .warning, .info])
        XCTAssertEqual(model.total, 8)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: AlertsUpdate(status: .loaded, counts: [:]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.data.isEmpty)
        XCTAssertEqual(model.total, 0)
    }

    func testAllZeroCountsResolveEmpty() {
        let (model, _) = makeModel(initial: AlertsUpdate(status: .loaded, counts: ["critical": 0]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: AlertsUpdate(status: .loading, counts: [:]))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: AlertsUpdate(status: .failed("timeout"), counts: [:]))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyAlertsTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AlertsSectionSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let counts = ["critical": 1]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(AlertsUpdate(status: .loaded, counts: counts, connection: .stale))
        source.push(AlertsUpdate(status: .loaded, counts: counts, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let counts = ["critical": 1]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(AlertsUpdate(status: .loaded, counts: counts, connection: .stale))
        source.push(AlertsUpdate(status: .loaded, counts: counts, connection: .live))
        source.push(AlertsUpdate(status: .loaded, counts: counts, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedCountsWithoutRefresh() {
        let counts = ["warning": 5]
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(AlertsUpdate(status: .loaded, counts: counts, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.data.count, 1)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: AlertsUpdate(status: .failed("x"), counts: [:]))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class AlertsAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private let data = AlertsProjection.data(from: ["critical": 3, "warning": 4, "info": 1])

    func testSectionSummaryIncludesTotalAndCounts() {
        let summary = AlertsAccessibility.sectionSummary(data: data, localize: echo)
        XCTAssertTrue(summary.contains("Alerts: 8"))
        XCTAssertTrue(summary.contains("3 Critical"))
        XCTAssertTrue(summary.contains("4 Warning"))
        XCTAssertTrue(summary.contains("1 Info"))
    }

    func testSectionSummaryEmptyUsesFriendlyMessage() {
        let summary = AlertsAccessibility.sectionSummary(data: [], localize: echo)
        XCTAssertTrue(summary.contains("Alerts"))
        XCTAssertTrue(summary.contains("everything looks great"))
    }

    func testRowLabel() throws {
        let critical = try XCTUnwrap(data.first { $0.kind == .critical })
        XCTAssertEqual(AlertsAccessibility.rowLabel(critical, localize: echo), "Critical: 3")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyAlertsTelemetry: AlertsSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
