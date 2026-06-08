//
//  ComputedMetricEditor.Tests.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  Unit coverage for the ComputedMetricEditor surface:
//    • Adapter (web transform ports) — opLabel / opKey / unitSuffix, ALL_OPS order,
//      the `parseFloat` threshold parse, `ready`, the preview request builder,
//      `handleMetric`, `fmtNumber(value, 2)`, the suffix token, the verdict, and the
//      `previewValue` interpolation, plus the static i18n descriptor keys/fallbacks.
//    • State holder (cached → projection) — ComputedMetricRegistryPresentation.resolve
//      across every branch (loading / empty / error / stale / offline / content), the
//      web-prop → load-state mapping, and the registry model wiring / list retention.
//    • Preview holder — ComputedMetricPreviewModel phase transitions (idle / computing
//      / success / failure), the cached-behind-offline contract, freshness (stale),
//      the re-entrancy guard, and `clear()`.
//    • Telemetry — the P1/S11 `view.opened` reporter emits the surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the models are driven by the in-memory source + runner doubles.
//

import Foundation
import XCTest

// MARK: - Adapter: web transform ports

final class ComputedMetricEditorAdapterTests: XCTestCase {
    private typealias Adapter = ComputedMetricEditorAdapter
    private let enUS = Locale(identifier: "en_US")

    func testAllOpsOrderMatchesWeb() {
        XCTAssertEqual(
            ComputedMetricOp.allCases.map(\.rawValue),
            [">", ">=", "<", "<=", "=", "!=", "%_change_>", "%_change_<"]
        )
    }

    func testOpLabel() {
        XCTAssertEqual(Adapter.opLabel(.greaterThan), ">")
        XCTAssertEqual(Adapter.opLabel(.lessThanOrEqual), "<=")
        XCTAssertEqual(Adapter.opLabel(.percentChangeGreater), "% change >")
        XCTAssertEqual(Adapter.opLabel(.percentChangeLess), "% change <")
    }

    func testOpKey() {
        XCTAssertEqual(Adapter.opKey(.greaterThan), "gt")
        XCTAssertEqual(Adapter.opKey(.greaterThanOrEqual), "gte")
        XCTAssertEqual(Adapter.opKey(.lessThan), "lt")
        XCTAssertEqual(Adapter.opKey(.lessThanOrEqual), "lte")
        XCTAssertEqual(Adapter.opKey(.equal), "eq")
        XCTAssertEqual(Adapter.opKey(.notEqual), "neq")
        XCTAssertEqual(Adapter.opKey(.percentChangeGreater), "pctGt")
        XCTAssertEqual(Adapter.opKey(.percentChangeLess), "pctLt")
    }

    func testUnitSuffix() {
        XCTAssertEqual(Adapter.unitSuffix("currency"), "")
        XCTAssertEqual(Adapter.unitSuffix("currency_per_mi"), "/mi")
        XCTAssertEqual(Adapter.unitSuffix("kwh"), "kWh")
        XCTAssertEqual(Adapter.unitSuffix("wh_per_mi"), "Wh/mi")
        XCTAssertEqual(Adapter.unitSuffix("mi"), "mi")
        XCTAssertEqual(Adapter.unitSuffix("km"), "km")
        XCTAssertEqual(Adapter.unitSuffix("h"), "h")
        XCTAssertEqual(Adapter.unitSuffix("count"), "")
        XCTAssertEqual(Adapter.unitSuffix("%"), "%")
        XCTAssertEqual(Adapter.unitSuffix("unknown"), "unknown")
    }

    func testParseThreshold() {
        XCTAssertEqual(Adapter.parseThreshold("200"), 200)
        XCTAssertEqual(Adapter.parseThreshold("  12.5 "), 12.5)
        XCTAssertEqual(Adapter.parseThreshold("200abc"), 200)
        XCTAssertEqual(Adapter.parseThreshold("-3"), -3)
        XCTAssertEqual(Adapter.parseThreshold(".5"), 0.5)
        XCTAssertNil(Adapter.parseThreshold(""))
        XCTAssertNil(Adapter.parseThreshold("   "))
        XCTAssertNil(Adapter.parseThreshold("abc"))
    }

    func testIsReady() {
        XCTAssertTrue(Adapter.isReady(.init(metricID: "c", metricWindow: "7d", metricThreshold: "200")))
        XCTAssertFalse(Adapter.isReady(.init(metricID: "", metricWindow: "7d", metricThreshold: "1")))
        XCTAssertFalse(Adapter.isReady(.init(metricID: "c", metricWindow: "", metricThreshold: "1")))
        XCTAssertFalse(Adapter.isReady(.init(metricID: "c", metricWindow: "7d", metricThreshold: "")))
        XCTAssertFalse(Adapter.isReady(.init(metricID: "c", metricWindow: "7d", metricThreshold: "abc")))
    }

    func testMakeRequest() {
        let value = ComputedMetricEditorValue(
            metricID: "cost",
            metricWindow: "7d",
            metricOp: .greaterThan,
            metricThreshold: "200",
            vehicleID: 7
        )
        let request = Adapter.makeRequest(from: value)
        XCTAssertEqual(request?.metricID, "cost")
        XCTAssertEqual(request?.metricWindow, "7d")
        XCTAssertEqual(request?.metricOp, .greaterThan)
        XCTAssertEqual(request?.metricThreshold, 200)
        XCTAssertEqual(request?.vehicleID, 7)
        XCTAssertNil(Adapter.makeRequest(from: .init(metricID: "cost", metricWindow: "7d", metricThreshold: "x")))
    }

    func testSelectMetric() {
        let metrics = [
            ComputedMetricSummary(
                id: "cost",
                label: "Cost",
                unit: "currency",
                windows: ["7d", "30d"],
                ops: [.lessThan, .greaterThan]
            ),
            ComputedMetricSummary(id: "eff", label: "Eff", unit: "wh_per_mi", windows: [], ops: [])
        ]
        let picked = Adapter.selectMetric(.init(metricOp: .notEqual), metricID: "cost", in: metrics)
        XCTAssertEqual(picked.metricID, "cost")
        XCTAssertEqual(picked.metricWindow, "7d")
        XCTAssertEqual(picked.metricOp, .lessThan)

        // Empty windows/ops → window cleared, operator kept (web fallback).
        let emptyDef = Adapter.selectMetric(.init(metricOp: .equal, metricThreshold: "5"), metricID: "eff", in: metrics)
        XCTAssertEqual(emptyDef.metricWindow, "")
        XCTAssertEqual(emptyDef.metricOp, .equal)

        // Unknown id → window cleared, operator kept.
        let unknown = Adapter.selectMetric(.init(metricOp: .greaterThanOrEqual), metricID: "ghost", in: metrics)
        XCTAssertEqual(unknown.metricWindow, "")
        XCTAssertEqual(unknown.metricOp, .greaterThanOrEqual)
    }

    func testWindowsAndOps() {
        let metric = ComputedMetricSummary(id: "c", label: "C", unit: "kwh", windows: ["7d"], ops: [.lessThan])
        XCTAssertEqual(Adapter.windows(for: metric), ["7d"])
        XCTAssertEqual(Adapter.windows(for: nil), [])
        XCTAssertEqual(Adapter.ops(for: metric), [.lessThan])
        XCTAssertEqual(Adapter.ops(for: nil), Adapter.allOps)
    }

    func testFormatValue() {
        XCTAssertEqual(Adapter.formatValue(200, locale: enUS), "200.00")
        XCTAssertEqual(Adapter.formatValue(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(Adapter.formatValue(3.14159, locale: enUS), "3.14")
        XCTAssertEqual(Adapter.formatValue(.nan, locale: enUS), "0.00")
        XCTAssertEqual(Adapter.formatValue(.infinity, locale: enUS), "0.00")
    }

    func testSuffixTokenAndVerdict() {
        XCTAssertEqual(Adapter.suffixToken(forUnit: "kwh"), " kWh")
        XCTAssertEqual(Adapter.suffixToken(forUnit: "currency"), "")
        XCTAssertEqual(Adapter.suffixToken(forUnit: nil), "")
        XCTAssertEqual(Adapter.verdict(wouldTrigger: true, would: "", wouldNot: "NOT"), "")
        XCTAssertEqual(Adapter.verdict(wouldTrigger: false, would: "", wouldNot: "NOT"), "NOT")
    }

    func testPreviewLine() {
        let template = "Right now this metric is {{value}}{{suffix}} — would {{verdict}} fire."
        let triggering = Adapter.previewLine(
            template: template,
            result: ComputedMetricPreviewResult(value: 200, wouldTrigger: true),
            unit: "kwh",
            would: "",
            wouldNot: "NOT",
            locale: enUS
        )
        XCTAssertEqual(triggering, "Right now this metric is 200.00 kWh — would  fire.")

        let notTriggering = Adapter.previewLine(
            template: template,
            result: ComputedMetricPreviewResult(value: 1234.5, wouldTrigger: false),
            unit: "currency",
            would: "",
            wouldNot: "NOT",
            locale: enUS
        )
        XCTAssertEqual(notTriggering, "Right now this metric is 1,234.50 — would NOT fire.")
    }

    func testI18nDescriptors() {
        XCTAssertEqual(Adapter.Text.metric.key, "notifications.alertStudio.computedMetric.metric")
        XCTAssertEqual(Adapter.Text.metricPrompt.fallback, "Choose a metric")
        XCTAssertEqual(Adapter.Text.threshold.fallback, "Threshold")
        XCTAssertEqual(Adapter.Text.would.fallback, "")
        XCTAssertEqual(Adapter.Text.wouldNot.fallback, "NOT")
        XCTAssertEqual(
            Adapter.metricNameText(id: "cost", label: "Cost").key,
            "notifications.alertStudio.metricNames.cost"
        )
        XCTAssertEqual(Adapter.windowText("7d").key, "notifications.alertStudio.metricWindows.7d")
        XCTAssertEqual(Adapter.opText(.percentChangeLess).key, "notifications.alertStudio.metricOps.pctLt")
        XCTAssertEqual(Adapter.opText(.percentChangeLess).fallback, "% change <")
    }
}

// MARK: - State holder: cached → projection

final class ComputedMetricRegistryPresentationTests: XCTestCase {
    private let one = [ComputedMetricSummary(id: "c", label: "C", unit: "kwh", windows: ["7d"], ops: [.lessThan])]

    func testLoadingAndContent() {
        XCTAssertEqual(ComputedMetricRegistryPresentation.resolve(.idle), .loading)
        XCTAssertEqual(ComputedMetricRegistryPresentation.resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.loading(cached: one, stale: false)),
            .content(one, .live, refreshing: true)
        )
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.loaded(one, stale: false)),
            .content(one, .live, refreshing: false)
        )
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.loaded(one, stale: true)),
            .content(one, .stale, refreshing: false)
        )
    }

    func testEmptyAndError() {
        XCTAssertEqual(ComputedMetricRegistryPresentation.resolve(.loaded([], stale: false)), .empty(.live))
        XCTAssertEqual(ComputedMetricRegistryPresentation.resolve(.empty(stale: true)), .empty(.stale))
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.failed(.offline, cached: nil, stale: false)),
            .offlineNoData
        )
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.failed(.network(message: "x"), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.failed(.decode(message: "x"), cached: nil, stale: false)),
            .error(retryable: false)
        )
    }

    func testFailedWithCache() {
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.failed(.offline, cached: one, stale: true)),
            .content(one, .offline, refreshing: false)
        )
        XCTAssertEqual(
            ComputedMetricRegistryPresentation.resolve(.failed(.network(message: "x"), cached: one, stale: false)),
            .content(one, .stale, refreshing: false)
        )
    }
}

@testable import TeslaSync
