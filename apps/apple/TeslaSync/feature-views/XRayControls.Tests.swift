//
//  XRayControls.Tests.swift
//  TeslaSync — P4 feature view · 0033 · XRayControls (Apple)
//
//  Unit coverage for the XRayControls surface:
//    • Adapter (cached vehicles + selected window → option projections) —
//      `XRayControlsProjection` vehicle/window/bucket options, the vehicle
//      display-label fallback chain (web `display_name || vin || Vehicle ${id}`),
//      the `WINDOW_SECS`/`BUCKET_SECS` widths, and the `tooBig` disable guard.
//    • Bucket enum — wire round-trip + the unrecognized-token default + widths.
//    • State holder — `XRayControlsModel` phase resolution across loading /
//      loaded / empty / error, the cached-stays-visible rule, the operator
//      selection forwarding (web `onVehicleChange`/`onWindowChange`/
//      `onBucketChange`), plus the P1/S11 `view.opened` telemetry + start/stop/
//      refresh source wiring.
//    • Accessibility — the VoiceOver selection-summary builder.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryXRayControlsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Bucket enum (web `IngestXRayBucket` + `BUCKET_SECS`)

@MainActor final class XRayControlsBucketTests: XCTestCase {
    func testWireRoundTripForEveryCase() {
        for bucket in IngestXRayBucket.allCases {
            XCTAssertEqual(IngestXRayBucket.from(wire: bucket.wire), bucket)
        }
    }

    func testWireTokensMatchTheWebUnion() {
        XCTAssertEqual(IngestXRayBucket.allCases.map(\.wire), ["30s", "1m", "5m", "15m", "1h"])
    }

    func testUnrecognizedTokenDefaultsToOneMinute() {
        XCTAssertEqual(IngestXRayBucket.from(wire: "90s"), .m1)
        XCTAssertEqual(IngestXRayBucket.from(wire: ""), .m1)
    }

    func testSecondsMatchTheWebBucketSecsMap() {
        XCTAssertEqual(IngestXRayBucket.s30.seconds, 30)
        XCTAssertEqual(IngestXRayBucket.m1.seconds, 60)
        XCTAssertEqual(IngestXRayBucket.m5.seconds, 300)
        XCTAssertEqual(IngestXRayBucket.m15.seconds, 900)
        XCTAssertEqual(IngestXRayBucket.h1.seconds, 3600)
    }

    func testLabelFallbackIsTheRawToken() {
        for bucket in IngestXRayBucket.allCases {
            XCTAssertEqual(bucket.labelFallback, bucket.wire)
        }
    }

    func testLabelKeyNamespacesByWireToken() {
        XCTAssertEqual(IngestXRayBucket.s30.labelKey, "admin.xray.bucketOption.30s")
        XCTAssertEqual(IngestXRayBucket.h1.labelKey, "admin.xray.bucketOption.1h")
    }
}

// MARK: - Adapter: option projections (parity with the web controls)

@MainActor final class XRayControlsAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so a test can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    // -- Vehicle options (web `vehicleOptions`) --

    func testVehicleOptionsLeadWithTheEmptySentinel() {
        let options = XRayControlsProjection.vehicleOptions([], localize: echo)
        XCTAssertEqual(options.count, 1)
        XCTAssertEqual(options[0].id, "")
        XCTAssertNil(options[0].value)
        XCTAssertEqual(options[0].title, "Select vehicle…")
    }

    func testVehicleOptionsSentinelResolvesThroughTheSelectVehicleKey() {
        let options = XRayControlsProjection.vehicleOptions([], localize: keyTap)
        XCTAssertEqual(options[0].title, "L:admin.xray.controls.selectVehicle")
    }

    func testVehicleOptionsAppendOnePerVehicleInOrder() {
        let vehicles = [
            XRayVehicleRef(id: 7, displayName: "Lightning"),
            XRayVehicleRef(id: 9, displayName: "Roadrunner")
        ]
        let options = XRayControlsProjection.vehicleOptions(vehicles, localize: echo)
        XCTAssertEqual(options.map(\.id), ["", "7", "9"])
        XCTAssertEqual(options.map(\.value), [nil, 7, 9])
        XCTAssertEqual(options[1].title, "Lightning")
        XCTAssertEqual(options[2].title, "Roadrunner")
    }

    func testVehicleLabelPrefersDisplayNameThenVinThenNumberedFallback() {
        let named = XRayVehicleRef(id: 1, displayName: "Lightning", vin: "VIN1")
        let vinOnly = XRayVehicleRef(id: 2, displayName: "", vin: "VIN2")
        let idOnly = XRayVehicleRef(id: 3, displayName: nil, vin: nil)
        XCTAssertEqual(named.displayLabel(localize: echo), "Lightning")
        XCTAssertEqual(vinOnly.displayLabel(localize: echo), "VIN2")
        XCTAssertEqual(idOnly.displayLabel(localize: echo), "Vehicle 3")
    }

    func testVehicleNumberedFallbackResolvesThroughTheFallbackKey() {
        let idOnly = XRayVehicleRef(id: 42, displayName: nil, vin: nil)
        XCTAssertEqual(idOnly.displayLabel(localize: keyTap), "L:admin.xray.controls.vehicleFallback")
    }

    // -- Window options (web `windowOptions`) --

    func testWindowOptionsCoverEveryWindowWithRawTokenFallback() {
        let options = XRayControlsProjection.windowOptions(localize: echo)
        XCTAssertEqual(options.map(\.id), ["5m", "15m", "1h", "6h", "24h"])
        XCTAssertEqual(options.map(\.title), ["5m", "15m", "1h", "6h", "24h"])
        XCTAssertFalse(options.contains { $0.isDisabled })
    }

    func testWindowOptionsResolveThroughTheWindowOptionKey() {
        let options = XRayControlsProjection.windowOptions(localize: keyTap)
        XCTAssertEqual(options[0].title, "L:admin.xray.windowOption.5m")
        XCTAssertEqual(options[4].title, "L:admin.xray.windowOption.24h")
    }

    // -- Bucket options (web `bucketOptions` + `tooBig`) --

    func testBucketOptionsCoverEveryBucketWithRawTokenFallback() {
        let options = XRayControlsProjection.bucketOptions(window: .h24, localize: echo)
        XCTAssertEqual(options.map(\.id), ["30s", "1m", "5m", "15m", "1h"])
        XCTAssertEqual(options.map(\.title), ["30s", "1m", "5m", "15m", "1h"])
    }

    func testBucketOptionsResolveThroughTheBucketOptionKey() {
        let options = XRayControlsProjection.bucketOptions(window: .h24, localize: keyTap)
        XCTAssertEqual(options[0].title, "L:admin.xray.bucketOption.30s")
        XCTAssertEqual(options[4].title, "L:admin.xray.bucketOption.1h")
    }

    func testWideWindowDisablesNoBuckets() {
        let options = XRayControlsProjection.bucketOptions(window: .h24, localize: echo)
        XCTAssertEqual(options.filter(\.isDisabled).map(\.id), [])
    }

    func testFiveMinuteWindowDisablesBucketsAtOrAboveFiveMinutes() {
        let options = XRayControlsProjection.bucketOptions(window: .m5, localize: echo)
        XCTAssertEqual(options.filter(\.isDisabled).map(\.id), ["5m", "15m", "1h"])
        XCTAssertEqual(options.filter { !$0.isDisabled }.map(\.id), ["30s", "1m"])
    }

    func testFifteenMinuteWindowDisablesBucketsAtOrAboveFifteenMinutes() {
        let options = XRayControlsProjection.bucketOptions(window: .m15, localize: echo)
        XCTAssertEqual(options.filter(\.isDisabled).map(\.id), ["15m", "1h"])
    }

    // -- Width maps + the `>=` guard --

    func testWindowSecondsMatchTheWebWindowSecsMap() {
        XCTAssertEqual(XRayControlsProjection.windowSeconds(.m5), 300)
        XCTAssertEqual(XRayControlsProjection.windowSeconds(.m15), 900)
        XCTAssertEqual(XRayControlsProjection.windowSeconds(.h1), 3600)
        XCTAssertEqual(XRayControlsProjection.windowSeconds(.h6), 21600)
        XCTAssertEqual(XRayControlsProjection.windowSeconds(.h24), 86400)
    }

    func testBucketEqualToWindowIsDisabledByTheGreaterOrEqualGuard() {
        // Boundary: a 1h bucket in a 1h window must disable (web `>=`).
        XCTAssertTrue(XRayControlsProjection.isBucketDisabled(.h1, window: .h1))
        // A 15m bucket in a 1h window stays enabled (strictly finer).
        XCTAssertFalse(XRayControlsProjection.isBucketDisabled(.m15, window: .h1))
    }

    // -- Accessibility --

    func testSelectionSummaryReadsLabelThenSelectedTitle() {
        XCTAssertEqual(
            XRayControlsAccessibility.selectionSummary(label: "Window", selectedTitle: "1h"),
            "Window, 1h"
        )
    }
}

// MARK: - State holder: phase resolution + telemetry + selection forwarding

@MainActor final class XRayControlsModelTests: XCTestCase {
    /// Telemetry spy capturing each `view.opened` surface slug.
    private final class SpyTelemetry: XRayControlsTelemetry, @unchecked Sendable {
        private(set) var surfaces: [String] = []
        func viewOpened(surface: String) {
            surfaces.append(surface)
        }
    }

    private func vehicle(_ id: Int) -> XRayVehicleRef {
        XRayVehicleRef(id: id, displayName: "Vehicle \(id)")
    }

    func testInitialFetchWithNoCacheIsLoading() {
        let phase = XRayControlsModel.resolvePhase(XRayControlsUpdate(status: .loading, vehicles: []))
        XCTAssertEqual(phase, .loading)
    }

    func testLoadingWithCachedVehiclesKeepsContentVisible() {
        let phase = XRayControlsModel.resolvePhase(
            XRayControlsUpdate(status: .loading, vehicles: [vehicle(1)])
        )
        XCTAssertEqual(phase, .content)
    }

    func testLoadedWithVehiclesIsContent() {
        let phase = XRayControlsModel.resolvePhase(
            XRayControlsUpdate(status: .loaded, vehicles: [vehicle(1), vehicle(2)])
        )
        XCTAssertEqual(phase, .content)
    }

    func testLoadedWithNoVehiclesIsEmpty() {
        let phase = XRayControlsModel.resolvePhase(XRayControlsUpdate(status: .loaded, vehicles: []))
        XCTAssertEqual(phase, .empty)
    }

    func testExplicitEmptyStatusIsEmpty() {
        let phase = XRayControlsModel.resolvePhase(XRayControlsUpdate(status: .empty, vehicles: []))
        XCTAssertEqual(phase, .empty)
    }

    func testFailureAlwaysResolvesToErrorEvenWithCachedVehicles() {
        let phase = XRayControlsModel.resolvePhase(
            XRayControlsUpdate(status: .failed("boom"), vehicles: [vehicle(1)])
        )
        XCTAssertEqual(phase, .error("boom"))
    }

    func testStartEmitsViewOpenedOnceWithTheSurfaceSlug() {
        let spy = SpyTelemetry()
        let model = XRayControlsModel(source: InMemoryXRayControlsSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [XRayControls.surfaceSlug])
    }

    func testStartReplaysTheInitialSnapshotIntoTheModel() {
        let source = InMemoryXRayControlsSource(
            initial: XRayControlsUpdate(
                status: .loaded,
                connection: .stale,
                vehicles: [vehicle(7)],
                vehicleID: 7,
                window: .h6,
                bucket: .m5,
                updatedAt: Date(timeIntervalSince1970: 1)
            )
        )
        let model = XRayControlsModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.vehicles.map(\.id), [7])
        XCTAssertEqual(model.vehicleID, 7)
        XCTAssertEqual(model.window, .h6)
        XCTAssertEqual(model.bucket, .m5)
    }

    func testRefreshDelegatesToTheSource() {
        let source = InMemoryXRayControlsSource()
        let model = XRayControlsModel(source: source)
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesToTheSourceAndAllowsTelemetryAgain() {
        let spy = SpyTelemetry()
        let source = InMemoryXRayControlsSource()
        let model = XRayControlsModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testSelectVehicleForwardsToSourceAndUpdatesSelection() {
        let source = InMemoryXRayControlsSource(
            initial: XRayControlsUpdate(status: .loaded, vehicles: [vehicle(1), vehicle(2)])
        )
        let model = XRayControlsModel(source: source)
        model.start()
        model.selectVehicle(2)
        XCTAssertEqual(source.selectedVehicleCalls, [2])
        XCTAssertEqual(model.vehicleID, 2)
    }

    func testSelectWindowForwardsToSourceAndUpdatesSelection() {
        let source = InMemoryXRayControlsSource()
        let model = XRayControlsModel(source: source)
        model.start()
        model.selectWindow(.m5)
        XCTAssertEqual(source.selectedWindowCalls, [.m5])
        XCTAssertEqual(model.window, .m5)
    }

    func testSelectBucketForwardsToSourceAndUpdatesSelection() {
        let source = InMemoryXRayControlsSource()
        let model = XRayControlsModel(source: source)
        model.start()
        model.selectBucket(.s30)
        XCTAssertEqual(source.selectedBucketCalls, [.s30])
        XCTAssertEqual(model.bucket, .s30)
    }

    func testPushedSnapshotUpdatesPhaseFreshnessAndSelection() {
        let source = InMemoryXRayControlsSource()
        let model = XRayControlsModel(source: source)
        model.start()
        source.push(
            XRayControlsUpdate(
                status: .loaded,
                connection: .offline,
                vehicles: [vehicle(3)],
                vehicleID: 3,
                window: .h24,
                bucket: .h1
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.vehicleID, 3)
        XCTAssertEqual(model.window, .h24)
        XCTAssertEqual(model.bucket, .h1)
    }
}
