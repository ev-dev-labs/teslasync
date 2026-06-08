//
//  FeatureToggles.Tests.swift
//  TeslaSync — P4 feature view · 0205 · FeatureToggles (Apple)
//
//  Unit coverage for the FeatureToggles surface:
//    • Adapter — the JS-truthiness `Boolean(...)` port, the `JSON.stringify`
//      detail rendering, the per-entry `{ key, enabled, details }` derivation
//      (primitive vs object vs array, missing `enabled`), key ordering, the
//      phase resolver, and the `formatDateTime` parity.
//    • State holder — `FeatureTogglesModel` phase across loading / loaded / empty
//      / failed (cached config kept behind refresh), the P1/S11 `view.opened`
//      telemetry (once), the user refresh + success / error toast, and the stale
//      auto-refresh (once, re-armed on live) with offline keeping cached config.
//    • Accessibility — the container summary + per-row VoiceOver value.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no bundle: the adapter is pure and the model is driven by an in-memory source.
//

import XCTest

// MARK: - Adapter: truthiness (web `Boolean(value)`)

@MainActor final class FeatureConfigTruthinessTests: XCTestCase {
    func testBooleanTruthiness() {
        XCTAssertTrue(FeatureConfigValue.bool(true).isTruthy)
        XCTAssertFalse(FeatureConfigValue.bool(false).isTruthy)
    }

    func testNumberTruthiness() {
        XCTAssertTrue(FeatureConfigValue.number(1).isTruthy)
        XCTAssertTrue(FeatureConfigValue.number(-2).isTruthy)
        XCTAssertFalse(FeatureConfigValue.number(0).isTruthy)
        XCTAssertFalse(FeatureConfigValue.number(.nan).isTruthy)
    }

    func testStringTruthinessMatchesJavaScript() {
        XCTAssertTrue(FeatureConfigValue.string("x").isTruthy)
        // Non-empty strings are truthy in JS — INCLUDING the literal "false".
        XCTAssertTrue(FeatureConfigValue.string("false").isTruthy)
        XCTAssertFalse(FeatureConfigValue.string("").isTruthy)
    }

    func testNullAndContainersTruthiness() {
        XCTAssertFalse(FeatureConfigValue.null.isTruthy)
        XCTAssertTrue(FeatureConfigValue.array([]).isTruthy)
        XCTAssertTrue(FeatureConfigValue.object([:]).isTruthy)
    }

    func testIsObjectLike() {
        XCTAssertTrue(FeatureConfigValue.object(["a": .null]).isObjectLike)
        XCTAssertTrue(FeatureConfigValue.array([.null]).isObjectLike)
        XCTAssertFalse(FeatureConfigValue.null.isObjectLike)
        XCTAssertFalse(FeatureConfigValue.bool(true).isObjectLike)
        XCTAssertFalse(FeatureConfigValue.string("x").isObjectLike)
    }

    func testFromJSONProjectsEveryKind() {
        XCTAssertEqual(FeatureConfigValue.from(json: nil), .null)
        XCTAssertEqual(FeatureConfigValue.from(json: NSNull()), .null)
        XCTAssertEqual(FeatureConfigValue.from(json: true), .bool(true))
        XCTAssertEqual(FeatureConfigValue.from(json: 3), .number(3))
        XCTAssertEqual(FeatureConfigValue.from(json: "x"), .string("x"))
        XCTAssertEqual(FeatureConfigValue.from(json: [1, 2]), .array([.number(1), .number(2)]))
        XCTAssertEqual(FeatureConfigValue.from(json: ["a": true]), .object(["a": .bool(true)]))
    }
}

// MARK: - Adapter: JSON.stringify (detail value rendering)

@MainActor final class FeatureTogglesJSONTests: XCTestCase {
    func testPrimitiveEncoding() {
        XCTAssertEqual(FeatureTogglesJSON.encode(.null), "null")
        XCTAssertEqual(FeatureTogglesJSON.encode(.bool(true)), "true")
        XCTAssertEqual(FeatureTogglesJSON.encode(.bool(false)), "false")
        XCTAssertEqual(FeatureTogglesJSON.encode(.number(25)), "25")
        XCTAssertEqual(FeatureTogglesJSON.encode(.number(2.5)), "2.5")
        XCTAssertEqual(FeatureTogglesJSON.encode(.number(.infinity)), "null")
    }

    func testStringIsQuotedAndEscaped() {
        XCTAssertEqual(FeatureTogglesJSON.encode(.string("hi")), "\"hi\"")
        XCTAssertEqual(FeatureTogglesJSON.encode(.string("a\"b")), "\"a\\\"b\"")
        XCTAssertEqual(FeatureTogglesJSON.encode(.string("a\nb")), "\"a\\nb\"")
    }

    func testContainersAreCompactWithSortedKeys() {
        let object = FeatureConfigValue.object(["percent": .number(25), "cohort": .string("internal")])
        XCTAssertEqual(FeatureTogglesJSON.encode(object), "{\"cohort\":\"internal\",\"percent\":25}")
        let array = FeatureConfigValue.array([.string("us"), .string("eu")])
        XCTAssertEqual(FeatureTogglesJSON.encode(array), "[\"us\",\"eu\"]")
    }
}

// MARK: - Adapter: per-entry derivation (web featureEntries map)

@MainActor final class FeatureTogglesAdapterTests: XCTestCase {
    private func entry(_ key: String, _ value: FeatureConfigValue) -> FeatureToggleEntry {
        FeatureTogglesAdapter.project([key: value]).entries[0]
    }

    func testPrimitiveBoolEnabledNoDetails() {
        let row = entry("flag", .bool(true))
        XCTAssertTrue(row.enabled)
        XCTAssertNil(row.details)
    }

    func testPrimitiveZeroIsDisabled() {
        XCTAssertFalse(entry("flag", .number(0)).enabled)
    }

    func testPrimitiveStringFalseIsEnabled() {
        // Web `Boolean("false")` is true — a non-empty string is truthy.
        XCTAssertTrue(entry("flag", .string("false")).enabled)
    }

    func testNullValueIsDisabledPrimitive() {
        let row = entry("flag", .null)
        XCTAssertFalse(row.enabled)
        XCTAssertNil(row.details, "null is not object-like, so details stays nil")
    }

    func testObjectReadsEnabledMemberAndBuildsDetails() {
        let value = FeatureConfigValue.object(["enabled": .bool(false), "percent": .number(25)])
        let row = entry("ROLLOUT", value)
        XCTAssertFalse(row.enabled)
        XCTAssertEqual(row.details, "percent: 25")
    }

    func testObjectWithoutEnabledMemberIsDisabled() {
        let value = FeatureConfigValue.object(["percent": .number(25)])
        let row = entry("ROLLOUT", value)
        XCTAssertFalse(row.enabled)
        XCTAssertEqual(row.details, "percent: 25")
    }

    func testObjectDetailsSortKeysAndStringifyValues() {
        let value = FeatureConfigValue.object([
            "enabled": .bool(true),
            "cohort": .string("internal"),
            "flag": .bool(false)
        ])
        let row = entry("ENDPOINTS", value)
        XCTAssertTrue(row.enabled)
        XCTAssertEqual(row.details, "cohort: \"internal\", flag: false")
    }

    func testObjectWithOnlyEnabledHasEmptyDetails() {
        let row = entry("SIMPLE", .object(["enabled": .bool(true)]))
        XCTAssertTrue(row.enabled)
        XCTAssertEqual(row.details, "", "web details is '' (non-null) when only `enabled` is present")
    }

    func testArrayIsObjectLikeWithIndexedDetails() {
        let row = entry("REGIONS", .array([.number(10), .number(20)]))
        XCTAssertFalse(row.enabled, "an array has no `enabled` member → falsy")
        XCTAssertEqual(row.details, "0: 10, 1: 20")
    }

    func testEntriesSortByKey() {
        let projection = FeatureTogglesAdapter.project([
            "charlie": .bool(true),
            "alpha": .bool(false),
            "bravo": .number(1)
        ])
        XCTAssertEqual(projection.entries.map(\.key), ["alpha", "bravo", "charlie"])
    }

    func testProjectionHelpers() {
        let projection = FeatureTogglesAdapter.project([
            "on": .bool(true),
            "off": .bool(false)
        ])
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.enabledCount, 1)
        XCTAssertFalse(FeatureTogglesProjection.empty.hasData)
    }
}

// MARK: - Adapter: phase resolver + formatting + slug

@MainActor final class FeatureTogglesPhaseTests: XCTestCase {
    func testResolvePhase() {
        XCTAssertEqual(FeatureTogglesPhaseResolver.phase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(FeatureTogglesPhaseResolver.phase(status: .loading, hasData: true), .content)
        XCTAssertEqual(FeatureTogglesPhaseResolver.phase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(FeatureTogglesPhaseResolver.phase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(FeatureTogglesPhaseResolver.phase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(FeatureTogglesPhaseResolver.phase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(FeatureTogglesPhaseResolver.phase(status: .failed("x"), hasData: true), .content)
    }

    func testSyncedFormatting() {
        XCTAssertNil(FeatureTogglesFormat.synced(at: nil))
        let date = Date(timeIntervalSince1970: 1_733_600_700)
        let formatted = FeatureTogglesFormat.synced(at: date, locale: Locale(identifier: "en_US"))
        XCTAssertNotNil(formatted)
        XCTAssertTrue(formatted?.contains("2024") ?? false)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(FeatureTogglesSurface.slug, "FeatureToggles")
        XCTAssertEqual(FeatureToggles.surfaceSlug, "FeatureToggles")
    }
}

// MARK: - State holder: phases + telemetry + refresh + freshness

@MainActor final class FeatureTogglesModelTests: XCTestCase {
    private let sample: [String: FeatureConfigValue] = ["beta": .bool(true), "max_rows": .number(5000)]

    private func makeModel(
        _ update: FeatureTogglesUpdate?,
        telemetry: FeatureTogglesTelemetry = OSLogFeatureTogglesTelemetry(),
        toast: FeatureTogglesToast = OSLogFeatureTogglesToast()
    ) -> (FeatureTogglesModel, InMemoryFeatureTogglesSource) {
        let source = InMemoryFeatureTogglesSource(initial: update)
        let model = FeatureTogglesModel(source: source, telemetry: telemetry, toast: toast)
        return (model, source)
    }

    func testLoadingWithoutConfigShowsLoading() {
        let (model, _) = makeModel(FeatureTogglesUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedConfigShowsContent() {
        let (model, _) = makeModel(FeatureTogglesUpdate(status: .loading, config: sample))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.entries.count, 2)
    }

    func testEmptyConfigShowsEmpty() {
        let (model, _) = makeModel(FeatureTogglesUpdate(status: .loaded, config: [:]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(FeatureTogglesUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedConfigKeepsContent() {
        let (model, source) = makeModel(FeatureTogglesUpdate(status: .loaded, config: sample))
        model.start()
        source.push(FeatureTogglesUpdate(status: .failed("net")))
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyFeatureTogglesTelemetry()
        let (model, source) = makeModel(FeatureTogglesUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FeatureTogglesSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testUserRefreshSpinsAndIsGuarded() {
        let (model, source) = makeModel(FeatureTogglesUpdate(status: .loaded, config: sample))
        model.start()
        model.refresh()
        XCTAssertTrue(model.refreshing)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1, "a second refresh is ignored while one is in flight")
    }

    func testRefreshSuccessClearsSpinnerAndToasts() {
        let toast = SpyFeatureTogglesToast()
        let (model, source) = makeModel(FeatureTogglesUpdate(status: .loaded, config: sample), toast: toast)
        model.start()
        model.refresh()
        source.push(FeatureTogglesUpdate(status: .loaded, config: sample, refreshOutcome: .succeeded))
        XCTAssertFalse(model.refreshing)
        XCTAssertEqual(toast.successes, ["Feature config refreshed"])
    }

    func testRefreshFailureToastsWithDetail() {
        let toast = SpyFeatureTogglesToast()
        let (model, source) = makeModel(FeatureTogglesUpdate(status: .loaded, config: sample), toast: toast)
        model.start()
        model.refresh()
        source.push(FeatureTogglesUpdate(status: .loaded, config: sample, refreshOutcome: .failed("429")))
        XCTAssertFalse(model.refreshing)
        XCTAssertEqual(toast.failures.count, 1)
        XCTAssertEqual(toast.failures.first?.message, "Failed to refresh feature config")
        XCTAssertEqual(toast.failures.first?.detail, "429")
    }

    func testStaleAutoRefreshesOnceAndReArmsOnLive() {
        let (model, source) = makeModel(nil)
        model.start()
        source.push(FeatureTogglesUpdate(status: .loaded, connection: .stale, config: sample))
        source.push(FeatureTogglesUpdate(status: .loaded, connection: .stale, config: sample))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertFalse(model.refreshing, "the stale auto-refresh is silent (no spinner)")
        source.push(FeatureTogglesUpdate(status: .loaded, connection: .live, config: sample))
        source.push(FeatureTogglesUpdate(status: .loaded, connection: .stale, config: sample))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedConfigWithoutRefresh() {
        let (model, source) = makeModel(nil)
        model.start()
        source.push(FeatureTogglesUpdate(status: .loaded, connection: .offline, config: sample))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testSyncedLabelReflectsFetchedAt() {
        let date = Date(timeIntervalSince1970: 1_733_600_700)
        let (model, _) = makeModel(FeatureTogglesUpdate(status: .loaded, config: sample, fetchedAt: date))
        model.start()
        XCTAssertTrue(model.syncedLabel?.contains("Synced") ?? false)
    }

    func testNoSyncedLabelWithoutFetchedAt() {
        let (model, _) = makeModel(FeatureTogglesUpdate(status: .loaded, config: sample))
        model.start()
        XCTAssertNil(model.syncedLabel)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility content

@MainActor final class FeatureTogglesAccessibilityTests: XCTestCase {
    func testEmptySummaryUsesNoDataMessage() {
        let summary = FeatureTogglesAccessibility.summary(for: .empty)
        XCTAssertTrue(summary.contains("No feature config data"))
    }

    func testSummaryCountsFeaturesAndEnabled() {
        let projection = FeatureTogglesAdapter.project([
            "on": .bool(true),
            "off": .bool(false)
        ])
        let summary = FeatureTogglesAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("2 features"))
        XCTAssertTrue(summary.contains("1 enabled"))
    }

    func testRowLabelIncludesStatusAndDetails() {
        let entry = FeatureToggleEntry(key: "ROLLOUT", enabled: false, details: "percent: 25")
        let label = FeatureTogglesAccessibility.rowLabel(entry)
        XCTAssertTrue(label.contains("ROLLOUT"))
        XCTAssertTrue(label.contains("Disabled"))
        XCTAssertTrue(label.contains("percent: 25"))
    }

    func testRowLabelWithoutDetailsOmitsTrailing() {
        let entry = FeatureToggleEntry(key: "flag", enabled: true, details: nil)
        XCTAssertEqual(FeatureTogglesAccessibility.rowLabel(entry), "flag: Enabled")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFeatureTogglesTelemetry: FeatureTogglesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records toast calls so the refresh `onSuccess` / `onError` parity is asserted.
private final class SpyFeatureTogglesToast: FeatureTogglesToast, @unchecked Sendable {
    private(set) var successes: [String] = []
    private(set) var failures: [(message: String, detail: String?)] = []

    func success(message: String) {
        successes.append(message)
    }

    func error(message: String, detail: String?) {
        failures.append((message, detail))
    }
}

@testable import TeslaSync
