//
//  ElevationProfile.Tests.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  Unit coverage for the ElevationProfile surface logic:
//    • Number format — the native parity of the web `fmt` / `fmtNumber` (grouped, fixed fraction
//      digits, locale-aware) + the `safeNumber` non-finite → 0 guard.
//    • Logic — the `elevGain` reducer, the non-finite sanitiser, the controlled-cursor resolution (web
//      `data[currentIndex]`), the click → sample-index mapping (web `onClickIndex(data[idx].index)`),
//      the axis-label thinning, the padded Y-domain, and the a11y summary.
//    • Projection — every render branch: chart (populated → along-the-route aria + elevGain subtitle),
//      empty (no samples → no-data aria), and the P4 loading / error / stale / offline chrome.
//    • Accessibility — the plotted profile carries a non-empty VoiceOver summary + subtitle label.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The adapter +
//  telemetry + model contract is asserted in `…AdapterTests.swift`; per-branch view rendering is
//  covered by the #Preview blocks.
//

import XCTest
@testable import TeslaSync

// MARK: - Number format (web fmt / fmtNumber)

final class ElevationProfileFormatTests: XCTestCase {
    private let locale = ElevationProfileTestData.locale

    func testIntegerNoFractionDigits() {
        XCTAssertEqual(ElevationProfileFormat.number(35, places: 0, locale: locale), "35")
        XCTAssertEqual(ElevationProfileFormat.number(5, places: 0, locale: locale), "5")
    }

    func testFixedFractionDigits() {
        XCTAssertEqual(ElevationProfileFormat.number(1234.5, places: 1, locale: locale), "1,234.5")
        XCTAssertEqual(ElevationProfileFormat.number(4, places: 2, locale: locale), "4.00")
    }

    func testGroupingSeparator() {
        XCTAssertEqual(ElevationProfileFormat.number(1000, places: 0, locale: locale), "1,000")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(ElevationProfileFormat.safe(.nan), 0)
        XCTAssertEqual(ElevationProfileFormat.safe(.infinity), 0)
        XCTAssertEqual(ElevationProfileFormat.number(.nan, places: 1, locale: locale), "0.0")
        XCTAssertEqual(ElevationProfileFormat.number(-.infinity, places: 0, locale: locale), "0")
    }
}

// MARK: - Logic (elevGain, cursor, selection, axis thinning, domain, a11y)

final class ElevationProfileLogicTests: XCTestCase {
    func testGainLossSumsConsecutiveDiffs() {
        // diffs: +10, -5, +25 → gain 35, loss 5 (web elevGain reducer)
        let result = ElevationProfileLogic.gainLoss(ElevationProfileTestData.samples([100, 110, 105, 130]))
        XCTAssertEqual(result.gain, 35)
        XCTAssertEqual(result.loss, 5)
    }

    func testGainLossRoundsTotals() {
        let result = ElevationProfileLogic.gainLoss(ElevationProfileTestData.samples([0, 10.4, 10.4, 0.6]))
        // up 10.4 then -9.8 → gain round(10.4)=10, loss round(9.8)=10
        XCTAssertEqual(result.gain, 10)
        XCTAssertEqual(result.loss, 10)
    }

    func testGainLossZeroForFewerThanTwoSamples() {
        XCTAssertEqual(ElevationProfileLogic.gainLoss([]), .zero)
        XCTAssertEqual(ElevationProfileLogic.gainLoss(ElevationProfileTestData.samples([42])), .zero)
    }

    func testGainLossSkipsNonFiniteDiffs() {
        let result = ElevationProfileLogic.gainLoss(ElevationProfileTestData.samples([100, .infinity, 120]))
        XCTAssertEqual(result, .zero)
    }

    func testSanitizedDropsNonFinite() {
        let samples = [
            ElevationProfileSample(index: 0, distance: 0, elevation: 100),
            ElevationProfileSample(index: 1, distance: .nan, elevation: 110),
            ElevationProfileSample(index: 2, distance: 5, elevation: .infinity),
            ElevationProfileSample(index: 3, distance: 10, elevation: 130)
        ]
        XCTAssertEqual(ElevationProfileLogic.sanitized(samples).map(\.index), [0, 3])
    }

    func testCursorArrayPositionGuardsRange() {
        XCTAssertEqual(ElevationProfileLogic.cursorArrayPosition(count: 4, currentIndex: 2), 2)
        XCTAssertNil(ElevationProfileLogic.cursorArrayPosition(count: 4, currentIndex: -1))
        XCTAssertNil(ElevationProfileLogic.cursorArrayPosition(count: 4, currentIndex: 4))
        XCTAssertNil(ElevationProfileLogic.cursorArrayPosition(count: 4, currentIndex: nil))
    }

    func testCursorDistanceUsesArrayPosition() {
        let samples = ElevationProfileTestData.samples([100, 110, 120], distanceStep: 5)
        XCTAssertEqual(ElevationProfileLogic.cursorDistance(samples, currentIndex: 1), 5)
        XCTAssertNil(ElevationProfileLogic.cursorDistance(samples, currentIndex: 9))
    }

    func testNearestArrayPosition() {
        let samples = ElevationProfileTestData.samples([100, 110, 120], distanceStep: 5) // distances 0,5,10
        XCTAssertEqual(ElevationProfileLogic.nearestArrayPosition(samples, toDistance: 6), 1)
        XCTAssertEqual(ElevationProfileLogic.nearestArrayPosition(samples, toDistance: -3), 0)
        XCTAssertEqual(ElevationProfileLogic.nearestArrayPosition(samples, toDistance: 100), 2)
        XCTAssertNil(ElevationProfileLogic.nearestArrayPosition([], toDistance: 0))
    }

    func testSampleIndexMapsArrayPositionToIndexField() {
        // index fields (10,20,30) deliberately differ from array positions (0,1,2): the web emits
        // `data[idx].index`, not the array position.
        let samples = [
            ElevationProfileSample(index: 10, distance: 0, elevation: 100),
            ElevationProfileSample(index: 20, distance: 5, elevation: 110),
            ElevationProfileSample(index: 30, distance: 10, elevation: 120)
        ]
        XCTAssertEqual(ElevationProfileLogic.sampleIndex(samples, atArrayPosition: 1), 20)
        XCTAssertNil(ElevationProfileLogic.sampleIndex(samples, atArrayPosition: 5))
        XCTAssertNil(ElevationProfileLogic.sampleIndex(samples, atArrayPosition: -1))
    }

    func testAxisDistanceValuesReturnsAllWhenFew() {
        let samples = ElevationProfileTestData.samples([1, 2, 3, 4])
        XCTAssertEqual(ElevationProfileLogic.axisDistanceValues(samples, maxLabels: 6).count, 4)
    }

    func testAxisDistanceValuesThinsAndKeepsEndpoints() {
        let elevations = (0 ..< 30).map { Double($0) }
        let samples = ElevationProfileTestData.samples(elevations, distanceStep: 2) // distances 0,2,...,58
        let values = ElevationProfileLogic.axisDistanceValues(samples, maxLabels: 6)
        XCTAssertLessThanOrEqual(values.count, 6)
        XCTAssertEqual(values.first, 0)
        XCTAssertEqual(values.last, 58)
    }

    func testElevationDomainPadsRange() {
        let domain = ElevationProfileLogic.elevationDomain(ElevationProfileTestData.samples([100, 200]))
        XCTAssertEqual(domain.lowerBound, 90)
        XCTAssertEqual(domain.upperBound, 210)
    }

    func testElevationDomainHandlesFlatAndEmpty() {
        let flat = ElevationProfileLogic.elevationDomain(ElevationProfileTestData.samples([150, 150]))
        XCTAssertEqual(flat.lowerBound, 149)
        XCTAssertEqual(flat.upperBound, 151)
        XCTAssertEqual(ElevationProfileLogic.elevationDomain([]), 0 ... 1)
    }

    func testAccessibilitySummaryIsNonEmptyAndDescriptive() {
        let samples = ElevationProfileTestData.samples([100, 110, 105, 130])
        let summary = ElevationProfileLogic.accessibilitySummary(
            samples,
            gainLoss: ElevationProfileLogic.gainLoss(samples),
            distanceUnit: "km",
            locale: ElevationProfileTestData.locale,
            strings: ElevationProfileTestData.identity
        )
        XCTAssertFalse(summary.isEmpty)
        XCTAssertTrue(summary.contains("ascent"))
        XCTAssertTrue(summary.contains("descent"))
        XCTAssertTrue(summary.contains("km"))
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class ElevationProfileProjectionTests: XCTestCase {
    private func resolve(
        _ availability: ElevationProfileInput.Availability,
        connection: ElevationProfileConnection = .live,
        currentIndex: Int? = nil,
        distanceUnit: String = ElevationProfileLayout.defaultDistanceUnit,
        height: Double = ElevationProfileLayout.defaultHeight
    ) -> ElevationProfileResolved {
        ElevationProfileProjection.resolve(
            ElevationProfileInput(availability: availability, connection: connection, currentIndex: currentIndex),
            height: height,
            distanceUnit: distanceUnit,
            locale: ElevationProfileTestData.locale,
            strings: ElevationProfileTestData.identity
        )
    }

    func testChartBranchPlotsPopulatedProfile() {
        let resolved = resolve(.resolved(ElevationProfileTestData.samples([100, 110, 105, 130])))
        XCTAssertEqual(resolved.title, "Elevation Profile")
        XCTAssertEqual(
            resolved.accessibilityLabel,
            "Elevation profile chart along the route, with total gain and loss in meters"
        )
        guard case let .chart(plotted) = resolved.body else {
            return XCTFail("expected a chart body")
        }
        XCTAssertEqual(plotted.samples.count, 4)
        XCTAssertEqual(plotted.gainLoss.gain, 35)
        XCTAssertEqual(plotted.gainLoss.loss, 5)
        XCTAssertEqual(plotted.distanceUnit, "km")
        XCTAssertEqual(plotted.seriesLabel, "Elevation")
    }

    func testChartBranchBuildsElevGainSubtitle() {
        let resolved = resolve(.resolved(ElevationProfileTestData.samples([100, 110, 105, 130])))
        XCTAssertEqual(resolved.subtitle, "↑ 35 m  ↓ 5 m")
        XCTAssertNotNil(resolved.subtitleAccessibilityLabel)
        XCTAssertTrue(resolved.subtitleAccessibilityLabel?.contains("ascent") ?? false)
    }

    func testChartBranchResolvesControlledCursor() {
        let samples = ElevationProfileTestData.samples([100, 110, 120, 130], distanceStep: 5)
        let resolved = resolve(.resolved(samples), currentIndex: 2)
        guard case let .chart(plotted) = resolved.body else {
            return XCTFail("expected a chart body")
        }
        XCTAssertEqual(plotted.cursorDistance, 10) // samples[2].distance
    }

    func testEmptyBranchWhenNoSamples() {
        let resolved = resolve(.resolved([]))
        guard case let .empty(message) = resolved.body else {
            return XCTFail("expected an empty body")
        }
        XCTAssertEqual(message, "No elevation data available")
        XCTAssertEqual(resolved.accessibilityLabel, "Elevation profile chart — no data available yet")
        XCTAssertNil(resolved.subtitle)
    }

    func testEmptyBranchWhenAllSamplesNonFinite() {
        let corrupt = [
            ElevationProfileSample(index: 0, distance: .nan, elevation: 100),
            ElevationProfileSample(index: 1, distance: 5, elevation: .nan)
        ]
        guard case .empty = resolve(.resolved(corrupt)).body else {
            return XCTFail("a fully-corrupt series sanitises to empty")
        }
    }

    func testLoadingBranch() {
        let resolved = resolve(.loading)
        XCTAssertEqual(resolved.body, .loading)
        XCTAssertNil(resolved.subtitle)
        XCTAssertNil(resolved.freshness)
        XCTAssertEqual(resolved.accessibilityLabel, "Elevation Profile")
    }

    func testErrorBranchCarriesRetryable() {
        let resolved = resolve(.failed(retryable: true))
        guard case let .error(message, retryable) = resolved.body else {
            return XCTFail("expected an error body")
        }
        XCTAssertEqual(message, "Couldn't load the elevation profile.")
        XCTAssertTrue(retryable)
        XCTAssertNil(resolved.subtitle)
    }

    func testStaleConnectionShowsStaleChip() {
        let resolved = resolve(.resolved(ElevationProfileTestData.data), connection: .stale)
        XCTAssertEqual(resolved.freshness?.label, "Stale")
        XCTAssertEqual(resolved.freshness?.isOffline, false)
    }

    func testOfflineConnectionShowsOfflineChip() {
        let resolved = resolve(.resolved(ElevationProfileTestData.data), connection: .offline)
        XCTAssertEqual(resolved.freshness?.label, "Offline")
        XCTAssertEqual(resolved.freshness?.isOffline, true)
    }

    func testDistanceUnitThreadsThrough() {
        let resolved = resolve(.resolved(ElevationProfileTestData.data), distanceUnit: "mi")
        XCTAssertEqual(resolved.plotted?.distanceUnit, "mi")
    }

    func testHeightThreadsThrough() {
        XCTAssertEqual(resolve(.loading, height: 320).height, 320)
    }
}

// MARK: - Accessibility (spoken labels)

final class ElevationProfileAccessibilityTests: XCTestCase {
    private func chart() -> ElevationProfileResolved {
        ElevationProfileProjection.resolve(
            ElevationProfileInput(
                availability: .resolved(ElevationProfileTestData.samples([100, 120, 110, 140])),
                connection: .live,
                currentIndex: 1
            ),
            locale: ElevationProfileTestData.locale,
            strings: ElevationProfileTestData.identity
        )
    }

    func testPlottedProfileCarriesNonEmptyVoiceOverSummary() {
        XCTAssertFalse(chart().plotted?.accessibilitySummary.isEmpty ?? true)
    }

    func testSubtitleCarriesNonEmptyAccessibilityLabel() {
        XCTAssertFalse(chart().subtitleAccessibilityLabel?.isEmpty ?? true)
    }

    func testTooltipFormattingPaths() {
        guard let plotted = chart().plotted, let sample = plotted.samples.first else {
            return XCTFail("expected a plotted profile")
        }
        XCTAssertTrue(plotted.distanceLabel(for: sample, locale: ElevationProfileTestData.locale).contains("km"))
        XCTAssertTrue(plotted.elevationValue(for: sample, locale: ElevationProfileTestData.locale).contains("m"))
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

final class ElevationProfileStringsTests: XCTestCase {
    func testFacadeTableNameIsStable() {
        XCTAssertEqual(ElevationProfileStrings.table, "ElevationProfile")
    }

    func testKeysResolveToEnglishFallbacks() {
        XCTAssertEqual(
            ElevationProfileStrings.string("replay.elevation.noData", "No elevation data available"),
            "No elevation data available"
        )
        XCTAssertEqual(
            ElevationProfileStrings.string("replay.elevation.error.retry", "Retry"),
            "Retry"
        )
        XCTAssertEqual(
            ElevationProfileStrings.string("replay.elevation.title", "Elevation Profile"),
            "Elevation Profile"
        )
    }
}

// MARK: - Shared test data

/// Sample series + helpers shared by the surface tests. The identity resolver maps every key to its
/// English fallback so the projection is asserted against the web English strings; the fixed `en_US`
/// locale makes the number formatting deterministic.
enum ElevationProfileTestData {
    static let identity: ElevationProfileResolve = { _, fallback in fallback }
    static let locale = Locale(identifier: "en_US")

    static func samples(
        _ elevations: [Double] = [100, 110, 105, 130],
        startIndex: Int = 0,
        distanceStep: Double = 5
    ) -> [ElevationProfileSample] {
        elevations.enumerated().map { offset, elevation in
            ElevationProfileSample(
                index: startIndex + offset,
                distance: Double(offset) * distanceStep,
                elevation: elevation
            )
        }
    }

    static var data: [ElevationProfileSample] {
        samples()
    }
}
