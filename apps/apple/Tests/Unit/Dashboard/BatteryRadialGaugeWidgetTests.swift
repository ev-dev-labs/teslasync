import XCTest
@testable import TeslaSync

// Unit tests for the native `BatteryRadialGaugeWidget` surface (P4/0015).
//
// The widget's logic lives in pure, KMP-free value types, so these tests run
// without the live shared-core graph (the same strategy as `LoadableStateTests`):
// they cover the color-band thresholds, the display projection + stat list, the
// render-state derivation for every visual branch, the registry size constraints,
// the `view.opened` telemetry emission, and the i18n keys each state resolves.

// MARK: - Color band thresholds (web getBatteryColor)

final class BatteryGaugeBandTests: XCTestCase {
    func testThresholdsMatchWebGetBatteryColor() {
        XCTAssertEqual(BatteryGaugeBand.forLevel(100, hasState: true), .high)
        XCTAssertEqual(BatteryGaugeBand.forLevel(51, hasState: true), .high)
        XCTAssertEqual(BatteryGaugeBand.forLevel(50, hasState: true), .medium)
        XCTAssertEqual(BatteryGaugeBand.forLevel(21, hasState: true), .medium)
        XCTAssertEqual(BatteryGaugeBand.forLevel(20, hasState: true), .low)
        XCTAssertEqual(BatteryGaugeBand.forLevel(0, hasState: true), .low)
    }

    func testNoStateIsUnknownRegardlessOfLevel() {
        XCTAssertEqual(BatteryGaugeBand.forLevel(80, hasState: false), .unknown)
        XCTAssertEqual(BatteryGaugeBand.forLevel(0, hasState: false), .unknown)
    }
}

// MARK: - Display projection + stats

final class BatteryGaugeProjectionTests: XCTestCase {
    func testLevelIsClampedToGaugeDomain() {
        XCTAssertEqual(
            BatteryGaugeProjection(batteryLevel: 140, chargeLimitSoc: nil, isCharging: false).clampedLevel,
            100
        )
        XCTAssertEqual(
            BatteryGaugeProjection(batteryLevel: -10, chargeLimitSoc: nil, isCharging: false).clampedLevel,
            0
        )
    }

    func testLevelPercentRounds() {
        XCTAssertEqual(
            BatteryGaugeProjection(batteryLevel: 82.4, chargeLimitSoc: nil, isCharging: false).levelPercent,
            82
        )
        XCTAssertEqual(
            BatteryGaugeProjection(batteryLevel: 82.6, chargeLimitSoc: nil, isCharging: false).levelPercent,
            83
        )
    }

    func testBandReflectsLevel() {
        XCTAssertEqual(BatteryGaugeProjection(batteryLevel: 70, chargeLimitSoc: nil, isCharging: false).band, .high)
        XCTAssertEqual(BatteryGaugeProjection(batteryLevel: 30, chargeLimitSoc: nil, isCharging: false).band, .medium)
        XCTAssertEqual(BatteryGaugeProjection(batteryLevel: 10, chargeLimitSoc: nil, isCharging: false).band, .low)
    }

    func testChargeLimitOverlayPresence() {
        let withLimit = BatteryGaugeProjection(batteryLevel: 50, chargeLimitSoc: 90, isCharging: false)
        XCTAssertTrue(withLimit.showsChargeLimit)
        XCTAssertEqual(withLimit.chargeLimitFraction, 0.9, accuracy: 0.0001)

        let noLimit = BatteryGaugeProjection(batteryLevel: 50, chargeLimitSoc: nil, isCharging: false)
        XCTAssertFalse(noLimit.showsChargeLimit)
        XCTAssertEqual(noLimit.chargeLimitFraction, 0)
    }

    func testStatsContainLevelOnlyWithoutChargeLimit() {
        let stats = BatteryGaugeProjection(batteryLevel: 64, chargeLimitSoc: nil, isCharging: false).stats
        XCTAssertEqual(stats.map(\.id), ["level"])
        XCTAssertEqual(stats.map(\.labelKey), ["translation.widget.level"])
        XCTAssertEqual(stats.first?.value, "64")
        XCTAssertEqual(stats.first?.unit, "%")
    }

    func testStatsAddLimitWhenChargeLimitPresent() {
        let stats = BatteryGaugeProjection(batteryLevel: 64, chargeLimitSoc: 80, isCharging: false).stats
        XCTAssertEqual(stats.map(\.id), ["level", "limit"])
        XCTAssertEqual(stats.map(\.labelKey), ["translation.widget.level", "translation.widget.chargeLimit"])
        XCTAssertEqual(stats.last?.value, "80")
    }
}

// MARK: - Load error classification

final class BatteryGaugeLoadErrorTests: XCTestCase {
    func testRetryability() {
        XCTAssertTrue(BatteryGaugeLoadError.offline.isRetryable)
        XCTAssertTrue(BatteryGaugeLoadError.retryable.isRetryable)
        XCTAssertFalse(BatteryGaugeLoadError.fatal.isRetryable)
    }
}

// MARK: - Render-state derivation (every visual branch)

final class BatteryRadialGaugeRenderStateTests: XCTestCase {
    private let projection = BatteryGaugeProjection(batteryLevel: 55, chargeLimitSoc: nil, isCharging: false)

    func testFirstLoadWithNothingCachedIsLoading() {
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: nil, isLoading: true, error: nil, isStale: false, isFetching: false
        )
        XCTAssertEqual(state.phase, .loading)
    }

    func testFailureWithNoValueIsRetryableError() {
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: nil, isLoading: false, error: .retryable, isStale: false, isFetching: false
        )
        XCTAssertEqual(state.phase, .failure(retryable: true))
        XCTAssertFalse(state.isOffline)
    }

    func testFatalFailureIsNotRetryable() {
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: nil, isLoading: false, error: .fatal, isStale: false, isFetching: false
        )
        XCTAssertEqual(state.phase, .failure(retryable: false))
    }

    func testOfflineWithNoValueFlagsOffline() {
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: nil, isLoading: false, error: .offline, isStale: true, isFetching: false
        )
        XCTAssertEqual(state.phase, .failure(retryable: true))
        XCTAssertTrue(state.isOffline)
    }

    func testValuePresentIsContentEvenWhileLoading() {
        // A background refetch with a cached value keeps the gauge on screen.
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: projection, isLoading: true, error: nil, isStale: false, isFetching: true
        )
        XCTAssertEqual(state.phase, .content)
        XCTAssertTrue(state.isFetching)
        XCTAssertEqual(state.projection, projection)
    }

    func testStaleContentIsRetained() {
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: projection, isLoading: false, error: nil, isStale: true, isFetching: false
        )
        XCTAssertEqual(state.phase, .content)
        XCTAssertTrue(state.isStale)
    }

    func testOfflineWithCachedValueShowsContentAndOfflineChip() {
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: projection, isLoading: false, error: .offline, isStale: true, isFetching: false
        )
        XCTAssertEqual(state.phase, .content)
        XCTAssertTrue(state.isOffline)
        XCTAssertEqual(state.projection, projection)
    }

    func testResolvedWithNoStateIsEmptyContent() {
        let state = BatteryRadialGaugeRenderState.resolve(
            projection: nil, isLoading: false, error: nil, isStale: false, isFetching: false
        )
        XCTAssertEqual(state.phase, .content)
        XCTAssertNil(state.projection)
    }
}

// MARK: - Size + registry metadata

final class TSDashboardWidgetSizeTests: XCTestCase {
    func testCompactAndExpandedClassification() {
        XCTAssertTrue(TSDashboardWidgetSize(cols: 1, rows: 1).isCompact)
        XCTAssertFalse(TSDashboardWidgetSize(cols: 1, rows: 2).isCompact)
        XCTAssertTrue(TSDashboardWidgetSize(cols: 2, rows: 2).isExpanded)
        XCTAssertTrue(TSDashboardWidgetSize(cols: 3, rows: 40).isExpanded)
        XCTAssertFalse(TSDashboardWidgetSize(cols: 1, rows: 2).isExpanded)
    }
}

final class BatteryRadialGaugeMetadataTests: XCTestCase {
    func testMetadataMatchesRegistry() {
        let meta = BatteryRadialGaugeWidget.metadata
        XCTAssertEqual(meta.id, "battery-radial-gauge")
        XCTAssertEqual(meta.category, "battery")
        XCTAssertEqual(meta.defaultSize, TSDashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(meta.minSize, TSDashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(meta.maxSize, TSDashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampRespectsMinAndMax() {
        let meta = BatteryRadialGaugeWidget.metadata
        XCTAssertEqual(
            meta.clamp(TSDashboardWidgetSize(cols: 0, rows: 1)),
            TSDashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            meta.clamp(TSDashboardWidgetSize(cols: 9, rows: 99)),
            TSDashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            meta.clamp(TSDashboardWidgetSize(cols: 2, rows: 5)),
            TSDashboardWidgetSize(cols: 2, rows: 5)
        )
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor
private final class SpyDashboardTelemetry: DashboardWidgetTelemetry {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@MainActor
final class BatteryRadialGaugeTelemetryTests: XCTestCase {
    func testReportOpenEmitsViewOpenedWithSurfaceSlug() {
        let spy = SpyDashboardTelemetry()
        BatteryRadialGaugeWidget.reportOpen(to: spy)
        XCTAssertEqual(spy.surfaces, ["BatteryRadialGaugeWidget"])
        XCTAssertEqual(BatteryRadialGaugeWidget.surfaceSlug, "BatteryRadialGaugeWidget")
    }
}

// MARK: - Projection from envelope + content construction (a11y/state coverage)

@MainActor
final class BatteryRadialGaugeContentTests: XCTestCase {
    func testProjectNilEnvelopeReturnsNil() {
        XCTAssertNil(BatteryRadialGaugeModel.project(nil))
    }

    func testAccessibilityValueComposition() {
        let projection = BatteryGaugeProjection(batteryLevel: 82.4, chargeLimitSoc: nil, isCharging: false)
        XCTAssertEqual("\(projection.levelPercent)%", "82%")
    }

    func testContentViewBuildsForEveryRenderBranch() {
        let charged = BatteryGaugeProjection(batteryLevel: 80, chargeLimitSoc: 90, isCharging: true)
        let phases: [BatteryRadialGaugeRenderState] = [
            BatteryRadialGaugeRenderState(
                phase: .loading, projection: nil, isStale: false, isOffline: false, isFetching: false
            ),
            BatteryRadialGaugeRenderState(
                phase: .content, projection: charged, isStale: true, isOffline: false, isFetching: true
            ),
            BatteryRadialGaugeRenderState(
                phase: .content, projection: nil, isStale: false, isOffline: true, isFetching: false
            ),
            BatteryRadialGaugeRenderState(
                phase: .failure(retryable: true), projection: nil, isStale: false, isOffline: false, isFetching: false
            )
        ]
        for state in phases {
            let view = BatteryRadialGaugeContent(
                renderState: state,
                size: TSDashboardWidgetSize(cols: 2, rows: 2),
                onRefresh: {}
            )
            XCTAssertEqual(view.renderState.phase, state.phase)
        }
    }
}
