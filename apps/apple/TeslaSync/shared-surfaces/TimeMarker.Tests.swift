//
//  TimeMarker.Tests.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  The projection + state-holder + view-composition half of the coverage (the pure reducer + value
//  types live in TimeMarker.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • Projection — the `x == null` collapse (web `TimeMarker` `return null` vs `<ReferenceLine>`)
//      and the severity / label / stroke defaults, from both an explicit value and a cached context.
//    • AlertContextModel — the once-only `view.opened`, the params update, the derived context, and
//      the resolved marker (web `useAlertContext` + the page feeding `<TimeMarker>`).
//    • Views — the rule builder, the callout, the modifier spelling, and the sample all compose; the
//      sample's accessibility + axis labels and the marker copy resolve through the P1/S10 facade.
//    • Tokens — the severity → color / symbol / name projection is distinct + resolvable.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import Charts
import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projection (web `TimeMarker` render output)

final class TimeMarkerProjectionTests: XCTestCase {
    func testNilValueIsHidden() {
        let resolved = TimeMarkerProjection.resolve(value: nil, label: "Alert")
        XCTAssertFalse(resolved.isVisible)
        XCTAssertNil(resolved.value)
    }

    func testValueDefaultsToWarnSolidWidthTwo() {
        let resolved = TimeMarkerProjection.resolve(value: .number(5), label: "Alert")
        XCTAssertTrue(resolved.isVisible)
        XCTAssertEqual(resolved.severity, .warn, "web severity ?? 'warn'")
        XCTAssertEqual(resolved.label, "Alert")
        XCTAssertEqual(resolved.strokeWidth, 2)
        XCTAssertNil(resolved.dashPattern)
    }

    func testValueCarriesOverrides() {
        let resolved = TimeMarkerProjection.resolve(
            value: .number(5),
            severity: .critical,
            label: "Battery alert",
            strokeWidth: 3,
            dashPattern: [4, 3]
        )
        XCTAssertEqual(resolved.severity, .critical)
        XCTAssertEqual(resolved.label, "Battery alert")
        XCTAssertEqual(resolved.strokeWidth, 3)
        XCTAssertEqual(resolved.dashPattern, [4, 3])
    }

    func testContextWithoutTimestampIsHidden() {
        let resolved = TimeMarkerProjection.resolve(context: .empty, label: "Alert")
        XCTAssertFalse(resolved.isVisible)
    }

    func testContextWithTimestampIsVisibleAtMarkerValue() {
        let context = AlertContextReducer.resolve(TimeMarkerParams(timestamp: "2026-04-30T13:00:00Z"))
        let resolved = TimeMarkerProjection.resolve(context: context, severity: .info, label: "Alert")
        XCTAssertTrue(resolved.isVisible)
        XCTAssertEqual(resolved.value, context.markerValue)
        XCTAssertEqual(resolved.severity, .info)
    }

    func testHiddenConstant() {
        XCTAssertFalse(TimeMarkerResolved.hidden.isVisible)
    }
}

// MARK: - AlertContextModel (web useAlertContext + page feeding <TimeMarker>)

@MainActor
final class AlertContextModelTests: XCTestCase {
    private func makeModel(
        params: TimeMarkerParams = .none,
        spy: SpyTimeMarkerTelemetry
    ) -> AlertContextModel {
        AlertContextModel(params: params, telemetry: spy)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTimeMarkerTelemetry()
        let model = makeModel(spy: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TimeMarkerSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTimeMarkerTelemetry()
        let model = makeModel(spy: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [TimeMarkerSurface.slug], "view.opened fires once per instance")
    }

    func testContextReflectsParams() {
        let model = makeModel(
            params: TimeMarkerParams(vehicleID: "7", timestamp: "2026-04-30T13:00:00Z", signal: "X"),
            spy: SpyTimeMarkerTelemetry()
        )
        XCTAssertEqual(model.context.vehicleID, 7)
        XCTAssertEqual(model.context.signal, "X")
        XCTAssertTrue(model.hasContext)
        XCTAssertNotNil(model.context.timeWindow)
    }

    func testUpdateParamsChangesContext() {
        let model = makeModel(spy: SpyTimeMarkerTelemetry())
        XCTAssertFalse(model.hasContext)
        model.update(params: TimeMarkerParams(vehicleID: "9"))
        XCTAssertEqual(model.context.vehicleID, 9)
        XCTAssertTrue(model.hasContext)
    }

    func testUpdateWithIdenticalParamsKeepsContext() {
        let params = TimeMarkerParams(vehicleID: "9")
        let model = makeModel(params: params, spy: SpyTimeMarkerTelemetry())
        model.update(params: params)
        XCTAssertEqual(model.context.vehicleID, 9)
    }

    func testResolvedMarkerHiddenWhenEmpty() {
        let model = makeModel(spy: SpyTimeMarkerTelemetry())
        XCTAssertFalse(model.resolvedMarker().isVisible)
    }

    func testResolvedMarkerVisibleWithTimestampAndDefaults() {
        let model = makeModel(
            params: TimeMarkerParams(timestamp: "2026-04-30T13:00:00Z"),
            spy: SpyTimeMarkerTelemetry()
        )
        let marker = model.resolvedMarker()
        XCTAssertTrue(marker.isVisible)
        XCTAssertEqual(marker.severity, .warn, "default severity is warn")
        XCTAssertEqual(marker.label, "Alert", "default label resolves to the catalog fallback")
    }

    func testResolvedMarkerAppliesSeverityAndLabel() {
        let model = makeModel(
            params: TimeMarkerParams(timestamp: "2026-04-30T13:00:00Z"),
            spy: SpyTimeMarkerTelemetry()
        )
        let marker = model.resolvedMarker(severity: .critical, label: "Low battery")
        XCTAssertEqual(marker.severity, .critical)
        XCTAssertEqual(marker.label, "Low battery")
    }

    func testDefaultLabelResolvesFromCatalog() {
        let model = makeModel(spy: SpyTimeMarkerTelemetry())
        XCTAssertEqual(model.defaultLabel, "Alert")
    }
}

// MARK: - Views (every branch composes + label presence)

@MainActor
final class TimeMarkerViewTests: XCTestCase {
    func testRuleBuilderBuildsEveryValueKind() {
        _ = tsTimeMarkerRule(at: .date(Date(timeIntervalSince1970: 1_777_000_000)), label: "Alert")
        _ = tsTimeMarkerRule(at: .number(5), severity: .critical, label: "Alert")
        _ = tsTimeMarkerRule(at: .text("12:30"), severity: .info, label: "Alert")
        _ = tsTimeMarkerRule(at: nil, label: "Alert")
    }

    func testRuleBuilderFromResolved() {
        _ = tsTimeMarkerRule(TimeMarkerProjection.resolve(value: .number(3), label: "Alert"))
        _ = tsTimeMarkerRule(TimeMarkerResolved.hidden)
    }

    func testCalloutComposesForEverySeverity() {
        for severity in MarkerSeverity.allCases {
            _ = TimeMarkerCallout(severity: severity, label: "Alert")
        }
    }

    func testModifierSpellingComposes() {
        _ = EmptyView().alertContext(AlertContextModel(params: .none))
        _ = EmptyView().alertContext(AlertContextModel(params: TimeMarkerSampleData.params))
    }

    func testSampleComposes() {
        _ = TimeMarkerSurfaceSample()
        _ = TimeMarkerSurfaceSample(severity: .warn)
        _ = TimeMarkerSampleChart(
            titleKey: "timeMarker.sample.series.withContext",
            titleFallback: "Battery (alert context)",
            severity: .info
        )
        XCTAssertFalse(TimeMarkerSampleData.series.isEmpty)
        XCTAssertFalse(TimeMarkerSampleData.alertISO.isEmpty)
    }

    func testAccessibilityAndAxisLabelsResolveFromCatalog() {
        XCTAssertEqual(
            TimeMarkerStrings.string("timeMarker.sample.chart.aria", "Battery level over time with alert marker"),
            "Battery level over time with alert marker"
        )
        XCTAssertEqual(TimeMarkerStrings.string("timeMarker.sample.axis.x", "Time"), "Time")
        XCTAssertEqual(TimeMarkerStrings.string("timeMarker.sample.marker.none", "No alert marker"), "No alert marker")
    }
}

// MARK: - Severity → design tokens

@MainActor
final class MarkerSeverityTokenTests: XCTestCase {
    func testStrokeColorsAreDistinct() {
        let strokes = MarkerSeverity.allCases.map(\.stroke)
        XCTAssertEqual(Set(strokes.map { "\($0)" }).count, MarkerSeverity.allCases.count)
    }

    func testSymbolNamesAreNonEmptyAndDistinct() {
        let symbols = MarkerSeverity.allCases.map(\.symbolName)
        XCTAssertTrue(symbols.allSatisfy { !$0.isEmpty })
        XCTAssertEqual(Set(symbols).count, symbols.count)
    }

    func testLocalizedNamesResolve() {
        XCTAssertEqual(MarkerSeverity.info.localizedName, "Info")
        XCTAssertEqual(MarkerSeverity.warn.localizedName, "Warning")
        XCTAssertEqual(MarkerSeverity.critical.localizedName, "Critical")
        XCTAssertEqual(MarkerSeverity.success.localizedName, "Success")
    }

    func testTintAndBorderDeriveFromStroke() {
        XCTAssertEqual(MarkerSeverity.warn.tint, MarkerSeverity.warn.stroke.opacity(0.12))
        XCTAssertEqual(MarkerSeverity.warn.border, MarkerSeverity.warn.stroke.opacity(0.3))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyTimeMarkerTelemetry: TimeMarkerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
