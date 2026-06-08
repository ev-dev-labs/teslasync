//
//  AutopilotSection.Tests.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  Unit coverage for the AutopilotSection surface:
//    • Adapter (cached → projection) — `AutopilotProjector` value parity with the web source's pipeline
//      (convertSpeedFromSI for mph + km/h, fmtNumber 0 dp grouping/rounding, the `parseFollowDistance`
//      enum-suffix peeler, the `'—'` em-dash fallbacks, the no-unit Follow Distance tile, the `hasAny`
//      content-vs-empty switch).
//    • State holder — `AutopilotSectionModel` phase resolution, the P1/S11 `view.opened` telemetry,
//      refresh + stale auto-refresh wiring, offline-keeps-content.
//    • Accessibility — the section VoiceOver summary (with data + empty).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model
//  is driven by `InMemoryAutopilotSectionSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum AutopilotFixture {
    /// All three values present, mph display: 27.3 m/s ≈ 61 mph, 29.06 m/s ≈ 65 mph, 7-bar follow gap.
    static let full = AutopilotInput(
        speedMetersPerSecond: 27.3,
        cruiseSetMetersPerSecond: 29.06,
        followDistanceRaw: "FollowDistance7"
    )

    static let mph = AutopilotUnitPrefs(speed: "mph", locale: "en_US")
    static let kmh = AutopilotUnitPrefs(speed: "km/h", locale: "en_US")

    static func project(_ input: AutopilotInput?, _ prefs: AutopilotUnitPrefs = mph) -> AutopilotProjection {
        AutopilotProjector.project(input: input, prefs: prefs, copy: .fallback)
    }

    static func stat(_ projection: AutopilotProjection, _ kind: AutopilotStatKind) -> AutopilotStat {
        projection.stats.first { $0.kind == kind }!
    }
}

// MARK: - Adapter: cached input → projection (port parity with the web source)

@MainActor
final class AutopilotSectionAdapterTests: XCTestCase {
    func testSpeedTilesProjectionMphMatchesWeb() {
        let projection = AutopilotFixture.project(AutopilotFixture.full)
        XCTAssertTrue(projection.hasAny)
        XCTAssertEqual(projection.stats.map(\.kind), [.currentSpeed, .cruiseSetSpeed, .followDistance])

        // Current speed: convertSpeedFromSI(27.3, mph) = 27.3*3600/1609.344 ≈ 61.07 → fmtNumber(_, 0) = "61".
        let current = AutopilotFixture.stat(projection, .currentSpeed)
        XCTAssertEqual(current.value, "61")
        XCTAssertEqual(current.unit, "mph")

        // Cruise set: convertSpeedFromSI(29.06, mph) ≈ 65.01 → "65".
        let cruise = AutopilotFixture.stat(projection, .cruiseSetSpeed)
        XCTAssertEqual(cruise.value, "65")
        XCTAssertEqual(cruise.unit, "mph")

        // Follow distance: "FollowDistance7" peeled to "7", and the web omits the unit caption.
        let follow = AutopilotFixture.stat(projection, .followDistance)
        XCTAssertEqual(follow.value, "7")
        XCTAssertNil(follow.unit)
    }

    func testSpeedConversionKmh() {
        let projection = AutopilotFixture.project(AutopilotFixture.full, AutopilotFixture.kmh)
        // convertSpeedFromSI(27.3, km/h) = 27.3 * 3.6 = 98.28 → "98".
        XCTAssertEqual(AutopilotFixture.stat(projection, .currentSpeed).value, "98")
        XCTAssertEqual(AutopilotFixture.stat(projection, .currentSpeed).unit, "km/h")
    }

    func testPartialInputRendersEmDashForMissingValues() {
        // Only current speed present (18 m/s ≈ 40 mph); the other two render the em-dash sentinel.
        let projection = AutopilotFixture.project(AutopilotInput(speedMetersPerSecond: 18.0))
        XCTAssertTrue(projection.hasAny)
        XCTAssertEqual(AutopilotFixture.stat(projection, .currentSpeed).value, "40")
        XCTAssertEqual(AutopilotFixture.stat(projection, .cruiseSetSpeed).value, "—")
        XCTAssertEqual(AutopilotFixture.stat(projection, .followDistance).value, "—")
    }

    func testFollowDistanceOnlyStillHasAny() {
        // Web `hasAny` is true when only the follow-distance observation exists.
        let projection = AutopilotFixture.project(AutopilotInput(followDistanceRaw: "FollowDistance3"))
        XCTAssertTrue(projection.hasAny)
        XCTAssertEqual(AutopilotFixture.stat(projection, .followDistance).value, "3")
        XCTAssertEqual(AutopilotFixture.stat(projection, .currentSpeed).value, "—")
    }

    func testParseFollowDistancePortedFromWeb() {
        // The web `/(\d+)\s*$/` peeler: trailing digits win, otherwise the raw string is kept.
        XCTAssertEqual(AutopilotFollowDistance.parse("FollowDistance7"), "7")
        XCTAssertEqual(AutopilotFollowDistance.parse("FollowDistance10"), "10")
        XCTAssertEqual(AutopilotFollowDistance.parse("Level 2"), "2")
        XCTAssertEqual(AutopilotFollowDistance.parse("12.5"), "5")
        XCTAssertEqual(AutopilotFollowDistance.parse("7 "), "7")
        // No trailing digit → the raw enum string is preserved (web `m ? m[1] : raw`).
        XCTAssertEqual(AutopilotFollowDistance.parse("FollowDistance"), "FollowDistance")
        XCTAssertEqual(AutopilotFollowDistance.parse("auto"), "auto")
        // Only `nil` input yields `nil` (drives the web `followDistance != null` gate).
        XCTAssertNil(AutopilotFollowDistance.parse(nil))
    }

    func testNumericFollowDistanceFallback() {
        // The web stringifies a numeric `CruiseFollowDistance` fallback; a bare number peels to itself.
        let projection = AutopilotFixture.project(AutopilotInput(followDistanceRaw: "5"))
        XCTAssertEqual(AutopilotFixture.stat(projection, .followDistance).value, "5")
    }

    func testNonFiniteSpeedCollapsesToZero() {
        // Web `safeNumber`: a non-finite SI value formats as "0", not "nan".
        let projection = AutopilotFixture.project(AutopilotInput(speedMetersPerSecond: .nan))
        XCTAssertEqual(AutopilotFixture.stat(projection, .currentSpeed).value, "0")
        XCTAssertEqual(AutopilotUnitMath.safe(.infinity), 0)
        XCTAssertEqual(AutopilotUnitMath.fmtNumber(.nan, decimals: 0), "0")
    }

    func testFmtNumberGroupingAndRounding() {
        // Locale-aware grouping + half-away-from-zero rounding (web `toLocaleString`).
        XCTAssertEqual(AutopilotUnitMath.fmtNumber(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(AutopilotUnitMath.fmtNumber(60.5, decimals: 0), "61")
        XCTAssertEqual(AutopilotUnitMath.fmtNumber(60.4, decimals: 0), "60")
    }

    func testSpeedConversionConstantsMatchWeb() {
        // 1 mile = 1609.344 m exactly; km/h is the ×3.6 path. Spot-check both converters.
        XCTAssertEqual(AutopilotUnitMath.speedFromSI(1, "mph"), 3600 / 1609.344, accuracy: 0.000001)
        XCTAssertEqual(AutopilotUnitMath.speedFromSI(10, "km/h"), 36, accuracy: 0.000001)
    }

    func testAllNilFieldsIsEmpty() {
        // A resolved payload whose three fields are all absent is the web empty case (`hasAny == false`).
        let projection = AutopilotFixture.project(AutopilotInput())
        XCTAssertFalse(projection.hasAny)
        XCTAssertEqual(projection.stats.count, 3)
        XCTAssertTrue(projection.stats.allSatisfy { $0.value == "—" })
    }

    func testNilInputYieldsEmptyProjection() {
        let projection = AutopilotFixture.project(nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertTrue(projection.stats.isEmpty)
        XCTAssertFalse(projection.hasAny)
    }

    func testCopyInjectionLocalizes() {
        let copy = AutopilotCopy(
            currentSpeedLabel: "Velocidad actual",
            cruiseSetSpeedLabel: "Velocidad de crucero",
            followDistanceLabel: "Distancia de seguimiento",
            emDash: "—"
        )
        let projection = AutopilotProjector.project(
            input: AutopilotFixture.full,
            prefs: AutopilotFixture.mph,
            copy: copy
        )
        XCTAssertEqual(AutopilotFixture.stat(projection, .currentSpeed).label, "Velocidad actual")
        XCTAssertEqual(AutopilotFixture.stat(projection, .followDistance).label, "Distancia de seguimiento")
    }
}

// MARK: - State holder: phase resolution

@MainActor
final class AutopilotSectionPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        // Web parent precedence: loading and error short-circuit BEFORE the content/empty body.
        XCTAssertEqual(AutopilotProjector.resolvePhase(.loading, hasAny: false), .loading)
        XCTAssertEqual(AutopilotProjector.resolvePhase(.loading, hasAny: true), .loading)
        XCTAssertEqual(AutopilotProjector.resolvePhase(.failed("x"), hasAny: false), .error("x"))
        XCTAssertEqual(AutopilotProjector.resolvePhase(.failed("x"), hasAny: true), .error("x"))
        XCTAssertEqual(AutopilotProjector.resolvePhase(.loaded, hasAny: false), .empty)
        XCTAssertEqual(AutopilotProjector.resolvePhase(.loaded, hasAny: true), .content)
    }
}

// MARK: - State holder: model wiring + telemetry

@MainActor
final class AutopilotSectionModelTests: XCTestCase {
    private func makeModel(
        _ update: AutopilotSectionUpdate,
        telemetry: AutopilotSectionTelemetry = OSLogAutopilotSectionTelemetry()
    ) -> (AutopilotSectionModel, InMemoryAutopilotSectionSource) {
        let source = InMemoryAutopilotSectionSource(initial: update)
        let model = AutopilotSectionModel(source: source, telemetry: telemetry, copy: .fallback)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(AutopilotSectionUpdate(status: .loading, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(
            AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, unitPrefs: AutopilotFixture.mph)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.stats.count, 3)
        XCTAssertTrue(model.projection.hasAny)
        XCTAssertEqual(AutopilotFixture.stat(model.projection, .currentSpeed).value, "61")
    }

    func testLoadedWithNilInputShowsEmpty() {
        let (model, _) = makeModel(AutopilotSectionUpdate(status: .loaded, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection, .empty)
    }

    func testLoadedWithAllNilFieldsShowsEmpty() {
        let (model, _) = makeModel(AutopilotSectionUpdate(status: .loaded, input: AutopilotInput()))
        model.start()
        // Web: all three values null → EmptyState, even though a payload resolved.
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasAny)
    }

    func testFailedShowsErrorEvenWithCachedData() {
        let (model, _) = makeModel(
            AutopilotSectionUpdate(status: .failed("boom"), input: AutopilotFixture.full)
        )
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyAutopilotSectionTelemetry()
        let (model, source) = makeModel(AutopilotSectionUpdate(status: .loading, input: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AutopilotSection.surfaceSlug])
        XCTAssertEqual(spy.surfaces, ["AutopilotSection"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(AutopilotSectionUpdate(status: .loaded, input: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let (model, source) = makeModel(
            AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, unitPrefs: AutopilotFixture.mph)
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0) // live → no refresh

        source.push(AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1) // stale → one auto-refresh

        source.push(AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1) // still stale → no repeat

        source.push(AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, connection: .live))
        source.push(AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2) // re-armed after going live → refresh again
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, source) = makeModel(
            AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, unitPrefs: AutopilotFixture.mph)
        )
        model.start()
        source.push(AutopilotSectionUpdate(status: .loaded, input: AutopilotFixture.full, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(AutopilotSectionUpdate(status: .loading, input: nil))
        model.start()
        source.push(
            AutopilotSectionUpdate(
                status: .loaded,
                input: AutopilotFixture.full,
                unitPrefs: AutopilotFixture.mph,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.stats.count, 3)
    }
}

// MARK: - Accessibility summary

@MainActor
final class AutopilotSectionAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    func testSectionSummaryWithData() {
        let projection = AutopilotFixture.project(AutopilotFixture.full)
        let summary = AutopilotSectionAccessibility.sectionSummary(for: projection, localize: fallback)
        XCTAssertTrue(summary.hasPrefix("Autopilot & Cruise"))
        XCTAssertTrue(summary.contains("Current Speed, 61 mph"))
        XCTAssertTrue(summary.contains("Cruise Set Speed, 65 mph"))
        XCTAssertTrue(summary.contains("Follow Distance, 7"))
    }

    func testSectionSummaryEmpty() {
        let projection = AutopilotFixture.project(nil)
        let summary = AutopilotSectionAccessibility.sectionSummary(for: projection, localize: fallback)
        XCTAssertTrue(summary.hasPrefix("Autopilot & Cruise"))
        XCTAssertTrue(summary.contains("No cruise / autopilot telemetry received yet"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAutopilotSectionTelemetry: AutopilotSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
