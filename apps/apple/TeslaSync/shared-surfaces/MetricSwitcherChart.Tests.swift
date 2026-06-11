//
//  MetricSwitcherChart.Tests.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  Unit coverage for the MetricSwitcherChart surface logic:
//    • Value format — the native parity of the web `formatValue` / `formatTick` closures (plain /
//      integer / decimal / suffixed, plus the non-finite em-dash guard).
//    • Logic — the active-metric resolution (web `find ?? metrics[0]`), the non-finite sanitiser, the
//      axis-label thinning (the Swift Charts adaptation of `preserveStartEnd`), and the a11y summary.
//    • Projection — every render branch: chart (bar / area / line), empty (active series empty), the
//      non-matching-key fallback, and the P4 loading / error / stale / offline chrome.
//    • Accessibility — every pill resolves a non-empty spoken label; the plotted metric carries a
//      non-empty VoiceOver summary.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The adapter +
//  telemetry + model contract is asserted in `…ModelTests.swift`; per-branch view rendering is covered
//  by the #Preview blocks.
//

import XCTest
@testable import TeslaSync

// MARK: - Value format (web formatValue / formatTick)

final class MetricSwitcherValueFormatTests: XCTestCase {
    func testPlainTrimsIntegerValuedNumbers() {
        XCTAssertEqual(MetricSwitcherValueFormat.plain.format(5), "5")
        XCTAssertEqual(MetricSwitcherValueFormat.plain.format(10), "10")
    }

    func testPlainKeepsFractionalNumbers() {
        XCTAssertEqual(MetricSwitcherValueFormat.plain.format(4.3), "4.3")
    }

    func testIntegerRounds() {
        XCTAssertEqual(MetricSwitcherValueFormat.integer.format(4.6), "5")
        XCTAssertEqual(MetricSwitcherValueFormat.integer.format(4.4), "4")
    }

    func testDecimalPlaces() {
        XCTAssertEqual(MetricSwitcherValueFormat.decimal(places: 1).format(4.2), "4.2")
        XCTAssertEqual(MetricSwitcherValueFormat.decimal(places: 2).format(4), "4.00")
    }

    func testSuffixedAppendsUnit() {
        XCTAssertEqual(MetricSwitcherValueFormat.suffixed(unit: "mi", places: 0).format(5), "5 mi")
        XCTAssertEqual(MetricSwitcherValueFormat.suffixed(unit: "mi", places: 0).format(10), "10 mi")
        XCTAssertEqual(MetricSwitcherValueFormat.suffixed(unit: "kWh", places: 1).format(12.34), "12.3 kWh")
    }

    func testNonFiniteRendersEmDash() {
        XCTAssertEqual(MetricSwitcherValueFormat.plain.format(.nan), "—")
        XCTAssertEqual(MetricSwitcherValueFormat.integer.format(.infinity), "—")
        XCTAssertEqual(MetricSwitcherValueFormat.suffixed(unit: "mi", places: 0).format(-.infinity), "—")
    }
}

// MARK: - Logic (active resolution, sanitising, axis thinning, a11y summary)

final class MetricSwitcherChartLogicTests: XCTestCase {
    func testActiveMetricMatchesByKey() {
        let metrics = MetricSwitcherChartTestData.metrics
        XCTAssertEqual(MetricSwitcherChartLogic.activeMetric(in: metrics, activeID: "distance")?.id, "distance")
    }

    func testActiveMetricFallsBackToFirstWhenUnknown() {
        let metrics = MetricSwitcherChartTestData.metrics
        XCTAssertEqual(MetricSwitcherChartLogic.activeMetric(in: metrics, activeID: "nope")?.id, "drives")
    }

    func testActiveMetricNilWhenEmpty() {
        XCTAssertNil(MetricSwitcherChartLogic.activeMetric(in: [], activeID: "x"))
    }

    func testSanitizedDropsNonFinite() {
        let points = [
            MetricSwitcherPoint(dateLabel: "a", value: 1),
            MetricSwitcherPoint(dateLabel: "b", value: .nan),
            MetricSwitcherPoint(dateLabel: "c", value: 3)
        ]
        XCTAssertEqual(MetricSwitcherChartLogic.sanitized(points).map(\.dateLabel), ["a", "c"])
    }

    func testAxisDateLabelsReturnsAllWhenFew() {
        let points = (0 ..< 4).map { MetricSwitcherPoint(dateLabel: "d\($0)", value: Double($0)) }
        XCTAssertEqual(MetricSwitcherChartLogic.axisDateLabels(points, maxLabels: 6).count, 4)
    }

    func testAxisDateLabelsThinsAndKeepsEndpoints() {
        let points = (0 ..< 30).map { MetricSwitcherPoint(dateLabel: "d\($0)", value: Double($0)) }
        let labels = MetricSwitcherChartLogic.axisDateLabels(points, maxLabels: 6)
        XCTAssertLessThanOrEqual(labels.count, 6)
        XCTAssertEqual(labels.first, "d0")
        XCTAssertEqual(labels.last, "d29")
    }

    func testAccessibilitySummaryReportsMinMaxLatest() {
        let points = [
            MetricSwitcherPoint(dateLabel: "a", value: 1),
            MetricSwitcherPoint(dateLabel: "b", value: 5),
            MetricSwitcherPoint(dateLabel: "c", value: 3)
        ]
        let summary = MetricSwitcherChartLogic.accessibilitySummary(
            label: "Drives",
            points: points,
            format: .integer,
            strings: MetricSwitcherChartTestData.identity
        )
        XCTAssertEqual(summary, "Drives: minimum 1, maximum 5, latest 3")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class MetricSwitcherProjectionTests: XCTestCase {
    private func resolve(
        _ availability: MetricSwitcherInput.Availability,
        connection: MetricSwitcherConnection = .live,
        activeID: String = "drives",
        emptyMessage: MetricSwitcherText? = nil
    ) -> MetricSwitcherResolved {
        MetricSwitcherProjection.resolve(
            MetricSwitcherInput(availability: availability, connection: connection, activeID: activeID),
            title: .verbatim("Activity over time"),
            emptyMessage: emptyMessage,
            strings: MetricSwitcherChartTestData.identity
        )
    }

    func testResolvedChartBranchPlotsActiveMetric() {
        let resolved = resolve(.resolved(MetricSwitcherChartTestData.dataset))
        XCTAssertEqual(resolved.title, "Activity over time")
        XCTAssertEqual(resolved.pills.map(\.id), ["drives", "distance"])
        XCTAssertEqual(resolved.pills.map(\.label), ["Drives", "Distance"])
        XCTAssertNil(resolved.freshness)
        guard case let .chart(metric) = resolved.body else {
            return XCTFail("expected a chart body")
        }
        XCTAssertEqual(metric.id, "drives")
        XCTAssertEqual(metric.kind, .bar)
        XCTAssertEqual(metric.points.count, 2)
    }

    func testActiveMetricSelectsAreaKindAndFormatter() {
        let resolved = resolve(.resolved(MetricSwitcherChartTestData.dataset), activeID: "distance")
        guard case let .chart(metric) = resolved.body else {
            return XCTFail("expected a chart body")
        }
        XCTAssertEqual(metric.kind, .area)
        XCTAssertEqual(metric.tooltipValue(MetricSwitcherPoint(dateLabel: "x", value: 10)), "10 mi")
    }

    func testEmptyBranchWhenActiveSeriesEmptyStillShowsPills() {
        let dataset = MetricSwitcherDataset(
            metrics: MetricSwitcherChartTestData.metrics,
            series: ["drives": [], "distance": []]
        )
        let resolved = resolve(.resolved(dataset), emptyMessage: .verbatim("Nothing here"))
        guard case let .empty(message) = resolved.body else {
            return XCTFail("expected an empty body")
        }
        XCTAssertEqual(message, "Nothing here")
        XCTAssertEqual(resolved.pills.count, 2, "the pill row stays visible so the viewer can switch metrics")
    }

    func testEmptyBranchUsesDefaultMessageWhenNoneSupplied() {
        let dataset = MetricSwitcherDataset(metrics: MetricSwitcherChartTestData.metrics, series: [:])
        let resolved = resolve(.resolved(dataset))
        guard case let .empty(message) = resolved.body else {
            return XCTFail("expected an empty body")
        }
        XCTAssertEqual(message, "No data available for this metric yet.")
    }

    func testUnknownActiveKeyFallsBackToFirstMetricButKeepsRawActiveID() {
        let resolved = resolve(.resolved(MetricSwitcherChartTestData.dataset), activeID: "nope")
        guard case let .chart(metric) = resolved.body else {
            return XCTFail("expected a chart body")
        }
        XCTAssertEqual(metric.id, "drives", "the chart uses metrics[0] (web find ?? metrics[0])")
        XCTAssertEqual(resolved.activeID, "nope", "the pill row reflects the raw, non-matching key")
    }

    func testLoadingBranch() {
        let resolved = resolve(.loading)
        XCTAssertEqual(resolved.body, .loading)
        XCTAssertTrue(resolved.pills.isEmpty)
        XCTAssertNil(resolved.freshness)
    }

    func testErrorBranchCarriesRetryable() {
        let resolved = resolve(.failed(retryable: true))
        guard case let .error(message, retryable) = resolved.body else {
            return XCTFail("expected an error body")
        }
        XCTAssertEqual(message, "Couldn't load chart data.")
        XCTAssertTrue(retryable)
        XCTAssertTrue(resolved.pills.isEmpty)
    }

    func testStaleConnectionShowsStaleChip() {
        let resolved = resolve(.resolved(MetricSwitcherChartTestData.dataset), connection: .stale)
        XCTAssertEqual(resolved.freshness?.label, "Stale")
        XCTAssertEqual(resolved.freshness?.isOffline, false)
    }

    func testOfflineConnectionShowsOfflineChip() {
        let resolved = resolve(.resolved(MetricSwitcherChartTestData.dataset), connection: .offline)
        XCTAssertEqual(resolved.freshness?.label, "Offline")
        XCTAssertEqual(resolved.freshness?.isOffline, true)
    }

    func testHeightThreadsThrough() {
        let resolved = MetricSwitcherProjection.resolve(
            MetricSwitcherInput(availability: .loading, connection: .live, activeID: "drives"),
            title: .verbatim("x"),
            height: 320,
            strings: MetricSwitcherChartTestData.identity
        )
        XCTAssertEqual(resolved.height, 320)
    }
}

// MARK: - Accessibility (spoken labels)

final class MetricSwitcherChartAccessibilityTests: XCTestCase {
    func testEveryPillResolvesNonEmptyLabel() {
        let resolved = MetricSwitcherProjection.resolve(
            MetricSwitcherInput(
                availability: .resolved(MetricSwitcherChartTestData.dataset),
                connection: .live,
                activeID: "drives"
            ),
            title: .verbatim("Activity"),
            strings: MetricSwitcherChartTestData.identity
        )
        for pill in resolved.pills {
            XCTAssertFalse(pill.label.isEmpty, "\(pill.id) must resolve a non-empty spoken label")
        }
    }

    func testPlottedMetricCarriesNonEmptyVoiceOverSummary() {
        let resolved = MetricSwitcherProjection.resolve(
            MetricSwitcherInput(
                availability: .resolved(MetricSwitcherChartTestData.dataset),
                connection: .live,
                activeID: "drives"
            ),
            title: .verbatim("Activity"),
            strings: MetricSwitcherChartTestData.identity
        )
        XCTAssertFalse(resolved.plottedMetric?.accessibilitySummary.isEmpty ?? true)
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

final class MetricSwitcherChartStringsTests: XCTestCase {
    func testFacadeTableNameIsStable() {
        XCTAssertEqual(MetricSwitcherChartStrings.table, "MetricSwitcherChart")
    }

    func testKeysResolveToEnglishFallbacks() {
        XCTAssertEqual(
            MetricSwitcherChartStrings.string("metricSwitcher.empty.message", "No data available for this metric yet."),
            "No data available for this metric yet."
        )
        XCTAssertEqual(
            MetricSwitcherChartStrings.string("metricSwitcher.error.retry", "Retry"),
            "Retry"
        )
    }

    func testResolveLocalizedUsesFacade() {
        let resolved = MetricSwitcherChartStrings.resolve(
            .localized(key: "k.any", fallback: "Drives"),
            MetricSwitcherChartTestData.identity
        )
        XCTAssertEqual(resolved, "Drives")
    }

    func testResolveVerbatimPassesThrough() {
        XCTAssertEqual(
            MetricSwitcherChartStrings.resolve(.verbatim("Custom"), MetricSwitcherChartTestData.identity),
            "Custom"
        )
    }
}

// MARK: - Shared test data

/// Sample metrics + series shared by the surface tests. The identity resolver maps every key to its
/// English fallback so the projection is asserted against the web English strings.
enum MetricSwitcherChartTestData {
    static let identity: MetricSwitcherResolve = { _, fallback in fallback }

    static let metrics: [MetricSwitcherMetricSpec] = [
        MetricSwitcherMetricSpec(
            id: "drives",
            label: .localized(key: "k.drives", fallback: "Drives"),
            kind: .bar,
            colorIndex: 0,
            valueFormat: .integer
        ),
        MetricSwitcherMetricSpec(
            id: "distance",
            label: .verbatim("Distance"),
            kind: .area,
            colorIndex: 2,
            valueFormat: .suffixed(unit: "mi", places: 0)
        )
    ]

    static var dataset: MetricSwitcherDataset {
        MetricSwitcherDataset(
            metrics: metrics,
            series: [
                "drives": [
                    MetricSwitcherPoint(dateLabel: "Apr 13", value: 1),
                    MetricSwitcherPoint(dateLabel: "Apr 20", value: 2)
                ],
                "distance": [
                    MetricSwitcherPoint(dateLabel: "Apr 13", value: 5),
                    MetricSwitcherPoint(dateLabel: "Apr 20", value: 10)
                ]
            ]
        )
    }
}
