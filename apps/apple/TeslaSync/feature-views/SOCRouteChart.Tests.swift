//
//  SOCRouteChart.Tests.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  Pure-core unit coverage for the SOCRouteChart surface:
//    • Adapter (`SOCRouteChartProjection`) — point→sample rounding + indexing, the
//      `chartData.length === 0` content/empty threshold, phase resolution, the
//      charge-stop reference-line walk (the verbatim web `stopDistances` port:
//      tolerance, cumulative advance, ordinal numbering, skips), the distance
//      domain, the start / arrival / min / max SOC summaries, and the nearest-sample
//      tooltip lookup.
//    • Formatting (`SOCRouteChartFormat`) — locale-aware percent + distance strings.
//    • Accessibility — the chart summary + per-stop VoiceOver value content.
//
//  The state-holder (`SOCRouteChartModel`) coverage lives in
//  `SOCRouteChart.ModelTests.swift`. These run in the TeslaSync(/-macOS) XCTest
//  targets; they have no network and no bundle (the adapter is pure).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: projection (web SOCRouteChart body parity)

@MainActor
final class SOCRouteChartProjectionTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    /// A two-leg planned route: deplete to 22%, charge, deplete to 18%, charge.
    private let socCurve: [SOCRoutePoint] = [
        SOCRoutePoint(distanceM: 0, soc: 90),
        SOCRoutePoint(distanceM: 40, soc: 74),
        SOCRoutePoint(distanceM: 80, soc: 58),
        SOCRoutePoint(distanceM: 120, soc: 22),
        SOCRoutePoint(distanceM: 120, soc: 80),
        SOCRoutePoint(distanceM: 170, soc: 60),
        SOCRoutePoint(distanceM: 220, soc: 38),
        SOCRoutePoint(distanceM: 250, soc: 18),
        SOCRoutePoint(distanceM: 250, soc: 75),
        SOCRoutePoint(distanceM: 300, soc: 52),
        SOCRoutePoint(distanceM: 340, soc: 33)
    ]

    private let chargeStops: [SOCRouteChargeStop] = [
        SOCRouteChargeStop(chargeFromSoc: 22, name: "Harris Ranch"),
        SOCRouteChargeStop(chargeFromSoc: 18, name: "Kettleman City")
    ]

    func testSamplesAssignSequentialIndices() {
        let samples = SOCRouteChartProjection.samples(from: socCurve)
        XCTAssertEqual(samples.map(\.index), Array(0 ..< socCurve.count))
        XCTAssertEqual(samples.first?.distance, 0)
        XCTAssertEqual(samples.first?.soc, 90)
        XCTAssertEqual(samples.last?.distance, 340)
        XCTAssertEqual(samples.last?.soc, 33)
        XCTAssertEqual(samples.map(\.id), samples.map(\.index))
    }

    func testSamplesRoundToOneDecimal() {
        // Web `chartData`: Math.round(value * 10) / 10.
        let samples = SOCRouteChartProjection.samples(from: [
            SOCRoutePoint(distanceM: 12.34, soc: 56.78),
            SOCRoutePoint(distanceM: 99.96, soc: 0.04)
        ])
        XCTAssertEqual(samples[0].distance, 12.3)
        XCTAssertEqual(samples[0].soc, 56.8)
        XCTAssertEqual(samples[1].distance, 100.0)
        XCTAssertEqual(samples[1].soc, 0.0)
    }

    func testHasTraceMirrorsLengthGreaterThanZero() {
        // Web empty branch is `chartData.length === 0`: 0 = empty; 1+ = content.
        XCTAssertFalse(SOCRouteChartProjection.hasTrace([]))
        XCTAssertTrue(SOCRouteChartProjection.hasTrace(SOCRouteChartProjection.samples(from: [socCurve[0]])))
        XCTAssertTrue(SOCRouteChartProjection.hasTrace(SOCRouteChartProjection.samples(from: socCurve)))
    }

    func testResolvePhase() {
        XCTAssertEqual(SOCRouteChartProjection.resolvePhase(.loading, hasTrace: false), .loading)
        XCTAssertEqual(SOCRouteChartProjection.resolvePhase(.loaded, hasTrace: true), .content)
        XCTAssertEqual(SOCRouteChartProjection.resolvePhase(.loaded, hasTrace: false), .empty)
        XCTAssertEqual(SOCRouteChartProjection.resolvePhase(.failed("boom"), hasTrace: true), .error("boom"))
    }

    func testChargeMarkersPortsStopDistancesWalk() {
        let markers = SOCRouteChartProjection.chargeMarkers(socCurve: socCurve, chargeStops: chargeStops)
        XCTAssertEqual(markers.count, 2)
        XCTAssertEqual(markers[0].ordinal, 1)
        XCTAssertEqual(markers[0].distance, 120)
        XCTAssertEqual(markers[0].name, "Harris Ranch")
        XCTAssertEqual(markers[1].ordinal, 2)
        XCTAssertEqual(markers[1].distance, 250)
        XCTAssertEqual(markers[1].name, "Kettleman City")
    }

    func testChargeMarkersRespectCumulativeAdvance() {
        // The second stop must match a point strictly past the first match's distance,
        // so the post-charge SOC spike at the same distance is never re-used.
        let curve = [
            SOCRoutePoint(distanceM: 100, soc: 20),
            SOCRoutePoint(distanceM: 100, soc: 85),
            SOCRoutePoint(distanceM: 200, soc: 21)
        ]
        let stops = [
            SOCRouteChargeStop(chargeFromSoc: 20, name: "A"),
            SOCRouteChargeStop(chargeFromSoc: 21, name: "B")
        ]
        let markers = SOCRouteChartProjection.chargeMarkers(socCurve: curve, chargeStops: stops)
        XCTAssertEqual(markers.map(\.distance), [100, 200])
        XCTAssertEqual(markers.map(\.ordinal), [1, 2])
    }

    func testChargeMarkersSkipUnmatchedStopsWithoutConsumingOrdinal() {
        // A stop whose entry SOC is never within 5% of any forward point is skipped,
        // and the surviving stop keeps ordinal 1 (web maps over the matched list).
        let curve = [
            SOCRoutePoint(distanceM: 50, soc: 60),
            SOCRoutePoint(distanceM: 100, soc: 30)
        ]
        let stops = [
            SOCRouteChargeStop(chargeFromSoc: 5, name: "NoMatch"),
            SOCRouteChargeStop(chargeFromSoc: 30, name: "Match")
        ]
        let markers = SOCRouteChartProjection.chargeMarkers(socCurve: curve, chargeStops: stops)
        XCTAssertEqual(markers.count, 1)
        XCTAssertEqual(markers[0].ordinal, 1)
        XCTAssertEqual(markers[0].distance, 100)
        XCTAssertEqual(markers[0].name, "Match")
    }

    func testChargeMarkersToleranceIsExclusiveFive() {
        // Web `Math.abs(pt.soc - charge_from_soc) < 5` — exactly 5 does not match.
        let curve = [SOCRoutePoint(distanceM: 10, soc: 25)]
        XCTAssertFalse(
            SOCRouteChartProjection.chargeMarkers(
                socCurve: curve,
                chargeStops: [SOCRouteChargeStop(chargeFromSoc: 29, name: "x")]
            ).isEmpty
        )
        XCTAssertTrue(
            SOCRouteChartProjection.chargeMarkers(
                socCurve: curve,
                chargeStops: [SOCRouteChargeStop(chargeFromSoc: 30, name: "x")]
            ).isEmpty
        )
    }

    func testChargeMarkersEmptyInputs() {
        XCTAssertTrue(SOCRouteChartProjection.chargeMarkers(socCurve: [], chargeStops: chargeStops).isEmpty)
        XCTAssertTrue(SOCRouteChartProjection.chargeMarkers(socCurve: socCurve, chargeStops: []).isEmpty)
    }

    func testDistanceDomainSpansTrace() {
        let samples = SOCRouteChartProjection.samples(from: socCurve)
        XCTAssertEqual(SOCRouteChartProjection.distanceDomain(samples), 0 ... 340)
    }

    func testDistanceDomainPadsSinglePointAndEmpty() {
        let single = SOCRouteChartProjection.samples(from: [SOCRoutePoint(distanceM: 0, soc: 50)])
        XCTAssertEqual(SOCRouteChartProjection.distanceDomain(single), 0 ... 1)
        XCTAssertEqual(SOCRouteChartProjection.distanceDomain([]), 0 ... 1)
    }

    func testStartArrivalMinMaxSoc() {
        let samples = SOCRouteChartProjection.samples(from: socCurve)
        XCTAssertEqual(SOCRouteChartProjection.startSoc(samples), 90)
        XCTAssertEqual(SOCRouteChartProjection.endSoc(samples), 33)
        XCTAssertEqual(SOCRouteChartProjection.minSoc(samples), 18)
        XCTAssertEqual(SOCRouteChartProjection.maxSoc(samples), 90)
    }

    func testSummaryHelpersAreNilWhenEmpty() {
        XCTAssertNil(SOCRouteChartProjection.startSoc([]))
        XCTAssertNil(SOCRouteChartProjection.endSoc([]))
        XCTAssertNil(SOCRouteChartProjection.minSoc([]))
        XCTAssertNil(SOCRouteChartProjection.maxSoc([]))
    }

    func testNearestSampleResolvesTooltipDatum() {
        let samples = SOCRouteChartProjection.samples(from: socCurve)
        XCTAssertEqual(SOCRouteChartProjection.sample(nearestDistance: 41, in: samples)?.distance, 40)
        XCTAssertEqual(SOCRouteChartProjection.sample(nearestDistance: 0, in: samples)?.distance, 0)
        XCTAssertNil(SOCRouteChartProjection.sample(nearestDistance: nil, in: samples))
        XCTAssertNil(SOCRouteChartProjection.sample(nearestDistance: 10, in: []))
    }

    func testSocDomainAndToleranceConstants() {
        XCTAssertEqual(SOCRouteChartProjection.socDomain, 0 ... 100)
        XCTAssertEqual(SOCRouteChartProjection.socMatchTolerance, 5)
        XCTAssertEqual(SOCRouteChartProjection.minimumTraceSamples, 1)
    }

    @MainActor
    func testSurfaceSlug() {
        XCTAssertEqual(SOCRouteChartSurface.slug, "SOCRouteChart")
        XCTAssertEqual(SOCRouteChart.surfaceSlug, "SOCRouteChart")
    }
}

// MARK: - Formatting

@MainActor
final class SOCRouteChartFormatTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    func testPercentRendersWholeNumber() {
        XCTAssertEqual(SOCRouteChartFormat.percent(82, locale: posix), "82%")
        XCTAssertEqual(SOCRouteChartFormat.percent(0, locale: posix), "0%")
        XCTAssertEqual(SOCRouteChartFormat.percent(100, locale: posix), "100%")
    }

    func testPercentRoundsToNearest() {
        XCTAssertEqual(SOCRouteChartFormat.percent(73.4, locale: posix), "73%")
        XCTAssertEqual(SOCRouteChartFormat.percent(73.6, locale: posix), "74%")
    }

    func testPercentNonFiniteIsEmDash() {
        XCTAssertEqual(SOCRouteChartFormat.percent(.nan, locale: posix), "—")
        XCTAssertEqual(SOCRouteChartFormat.percent(.infinity, locale: posix), "—")
    }

    func testDistanceRendersUpToOneFraction() {
        XCTAssertEqual(SOCRouteChartFormat.distance(120, locale: posix), "120")
        XCTAssertEqual(SOCRouteChartFormat.distance(12.3, locale: posix), "12.3")
        XCTAssertEqual(SOCRouteChartFormat.distance(12.34, locale: posix), "12.3")
    }

    func testDistanceNonFiniteIsEmDash() {
        XCTAssertEqual(SOCRouteChartFormat.distance(.nan, locale: posix), "—")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor
final class SOCRouteChartAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = Locale(identifier: "en_US_POSIX")

    private var samples: [SOCRouteSample] {
        SOCRouteChartProjection.samples(from: [
            SOCRoutePoint(distanceM: 0, soc: 90),
            SOCRoutePoint(distanceM: 120, soc: 22),
            SOCRoutePoint(distanceM: 250, soc: 33)
        ])
    }

    private var markers: [SOCRouteChargeMarker] {
        [SOCRouteChargeMarker(ordinal: 1, distance: 120, name: "Harris Ranch")]
    }

    func testChartSummaryIncludesStartArrivalMinAndStops() {
        let summary = SOCRouteChartAccessibility.chartSummary(
            samples: samples,
            markers: markers,
            minArrivalSoc: 20,
            localize: echo,
            locale: posix
        )
        XCTAssertTrue(summary.contains("Battery Along Route"))
        XCTAssertTrue(summary.contains("3 points"))
        XCTAssertTrue(summary.contains("start 90%"))
        XCTAssertTrue(summary.contains("arrival 33%"))
        XCTAssertTrue(summary.contains("minimum arrival 20%"))
        XCTAssertTrue(summary.contains("1 charge stops"))
    }

    func testChartSummaryEmptyUsesPlanTripFallback() {
        let summary = SOCRouteChartAccessibility.chartSummary(
            samples: [],
            markers: [],
            minArrivalSoc: 20,
            localize: echo,
            locale: posix
        )
        XCTAssertTrue(summary.contains("Battery Along Route"))
        XCTAssertTrue(summary.contains("Plan a trip to see the SOC curve"))
    }

    func testStopValueIncludesOrdinalNameAndDistance() {
        let value = SOCRouteChartAccessibility.stopValue(markers[0], localize: echo, locale: posix)
        XCTAssertEqual(value, "Stop 1, Harris Ranch at 120 km")
    }

    func testStopValueOmitsNameWhenEmpty() {
        let marker = SOCRouteChargeMarker(ordinal: 2, distance: 250, name: "")
        let value = SOCRouteChartAccessibility.stopValue(marker, localize: echo, locale: posix)
        XCTAssertEqual(value, "Stop 2 at 250 km")
    }
}
