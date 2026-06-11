//
//  TirePressurePanel.Tests.swift
//  TeslaSync — P4 feature view · 0286 · TirePressurePanel (Apple)
//
//  Unit coverage for the TirePressurePanel surface:
//    • Conversion (`TPPanelUnit.convert(fromSI:)`) — SI(Pa)→kPa/psi/bar parity with
//      lib/unitConversion.ts.
//    • Band classification (`TPPanelVariant.classify`) — the helpers.ts `getColor`/
//      `getBorder` band ports across every boundary.
//    • Overall status (`TPPanelOverallStatus.classify`) — the web `allGood`/`anyBad`
//      summary, its precedence, and null handling.
//    • Formatting (`TPPanelFormat.pressure`) — the `formatPressure(paToKpa(value))` port
//      (precision 1, unit suffix, `—` empty display, locale grouping).
//    • Projector (`TPPanelProjector`) — nil → empty gate, present snapshot → four ordered
//      tiles + overall status, and phase resolution.
//    • State holder (`TirePressurePanelModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh (exactly
//      once per episode), and offline keeping the cached grid.
//    • Accessibility — the summary content (overall + corners) and the empty sentence.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no bundle:
//  the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Conversion

final class TPPanelConversionTests: XCTestCase {
    func testKilopascalsDivideByThousand() {
        XCTAssertEqual(TPPanelUnit.kpa.convert(fromSI: 0), 0, accuracy: 0.0001)
        XCTAssertEqual(TPPanelUnit.kpa.convert(fromSI: 290_000), 290, accuracy: 0.0001)
        XCTAssertEqual(TPPanelUnit.kpa.convert(fromSI: 101_325), 101.325, accuracy: 0.0001)
    }

    func testPsiMatchesFormula() {
        // 6894.757 Pa = 6.894757 kPa = exactly 1 psi.
        XCTAssertEqual(TPPanelUnit.psi.convert(fromSI: 6894.757), 1, accuracy: 0.0001)
        XCTAssertEqual(TPPanelUnit.psi.convert(fromSI: 6_894_757), 1000, accuracy: 0.0001)
    }

    func testBarMatchesFormula() {
        // 100000 Pa = 100 kPa = exactly 1 bar.
        XCTAssertEqual(TPPanelUnit.bar.convert(fromSI: 100_000), 1, accuracy: 0.0001)
        XCTAssertEqual(TPPanelUnit.bar.convert(fromSI: 290_000), 2.9, accuracy: 0.0001)
    }

    func testUnitFromSymbol() {
        XCTAssertEqual(TPPanelUnit.from(symbol: "kPa"), .kpa)
        XCTAssertEqual(TPPanelUnit.from(symbol: "psi"), .psi)
        XCTAssertEqual(TPPanelUnit.from(symbol: "bar"), .bar)
        XCTAssertEqual(TPPanelUnit.from(symbol: "garbage"), .kpa)
        XCTAssertEqual(TPPanelUnit.kpa.symbol, "kPa")
    }
}

// MARK: - Band classification (helpers.ts getColor/getBorder parity)

final class TPPanelClassificationTests: XCTestCase {
    func testVariantBands() {
        XCTAssertEqual(TPPanelVariant.classify(nil), .neutral)
        XCTAssertEqual(TPPanelVariant.classify(Double.nan), .neutral)
        XCTAssertEqual(TPPanelVariant.classify(206_799), .danger)
        XCTAssertEqual(TPPanelVariant.classify(206_800), .warning)
        XCTAssertEqual(TPPanelVariant.classify(241_299), .warning)
        XCTAssertEqual(TPPanelVariant.classify(241_300), .success)
        XCTAssertEqual(TPPanelVariant.classify(310_300), .success)
        XCTAssertEqual(TPPanelVariant.classify(310_301), .warning)
        XCTAssertEqual(TPPanelVariant.classify(344_700), .warning)
        XCTAssertEqual(TPPanelVariant.classify(344_701), .danger)
    }
}

// MARK: - Overall status (web allGood/anyBad parity)

final class TPPanelOverallStatusTests: XCTestCase {
    func testAllNormalWhenEveryCornerInSafeBand() {
        let status = TPPanelOverallStatus.classify([290_000, 288_000, 296_000, 294_000])
        XCTAssertEqual(status, .allNormal)
        XCTAssertEqual(status.variant, .success)
        XCTAssertEqual(status.labelFallback, "All Normal")
    }

    func testAttentionWhenAnyCornerCritical() {
        // 190000 < lowCritical → bad; not all good → attention (red).
        let low = TPPanelOverallStatus.classify([290_000, 290_000, 290_000, 190_000])
        XCTAssertEqual(low, .attention)
        // 350000 > highCritical → bad.
        let high = TPPanelOverallStatus.classify([350_000, 290_000, 290_000, 290_000])
        XCTAssertEqual(high, .attention)
        XCTAssertEqual(low.variant, .danger)
    }

    func testCheckWhenSoftOrMissingButNoneCritical() {
        // 220000 is in the soft band (warning) — not bad, not all good → check (amber).
        let soft = TPPanelOverallStatus.classify([290_000, 290_000, 290_000, 220_000])
        XCTAssertEqual(soft, .check)
        // A missing corner fails all-good and is never bad → check.
        let missing = TPPanelOverallStatus.classify([290_000, 290_000, 290_000, nil])
        XCTAssertEqual(missing, .check)
        XCTAssertEqual(soft.variant, .warning)
        XCTAssertEqual(soft.labelFallback, "Check Pressure")
    }

    func testAllMissingIsCheckNotAttention() {
        XCTAssertEqual(TPPanelOverallStatus.classify([nil, nil, nil, nil]), .check)
    }

    func testCriticalPrecedesSoftWhenBothPresent() {
        // One soft + one critical → attention wins (critical present, not all good).
        XCTAssertEqual(TPPanelOverallStatus.classify([290_000, 220_000, 190_000, 290_000]), .attention)
    }
}

// MARK: - Formatting (formatPressure parity)

final class TPPanelFormatTests: XCTestCase {
    func testEmptyDisplayForNullOrNonFinite() {
        XCTAssertEqual(TPPanelFormat.pressure(pascals: nil, unit: .kpa), "—")
        XCTAssertEqual(TPPanelFormat.pressure(pascals: Double.nan, unit: .kpa), "—")
        XCTAssertEqual(TPPanelFormat.pressure(pascals: nil, unit: .kpa, emptyDisplay: "n/a"), "n/a")
    }

    func testKilopascalOneFractionDigit() {
        XCTAssertEqual(
            TPPanelFormat.pressure(pascals: 289_500, unit: .kpa, localeIdentifier: "en_US"),
            "289.5 kPa"
        )
        XCTAssertEqual(
            TPPanelFormat.pressure(pascals: 206_800, unit: .kpa, localeIdentifier: "en_US"),
            "206.8 kPa"
        )
    }

    func testPsiAndBarSuffixes() {
        // 289.5 kPa / 6.894757 = 41.99 → 42.0 psi at one fraction digit.
        XCTAssertEqual(
            TPPanelFormat.pressure(pascals: 289_500, unit: .psi, localeIdentifier: "en_US"),
            "42.0 psi"
        )
        // 289.5 kPa / 100 = 2.895 → 2.9 bar.
        XCTAssertEqual(
            TPPanelFormat.pressure(pascals: 289_500, unit: .bar, localeIdentifier: "en_US"),
            "2.9 bar"
        )
    }

    func testGroupingSeparatorForLargeValue() {
        // 1,289.5 kPa keeps the locale grouping separator.
        XCTAssertEqual(
            TPPanelFormat.pressure(pascals: 1_289_500, unit: .kpa, localeIdentifier: "en_US"),
            "1,289.5 kPa"
        )
    }
}

// MARK: - Projector

final class TPPanelProjectorTests: XCTestCase {
    func testNilSnapshotIsEmptyGate() {
        let projection = TPPanelProjector.project(snapshot: nil, unit: .kpa)
        XCTAssertTrue(projection.readings.isEmpty)
        XCTAssertFalse(projection.hasSnapshot)
        XCTAssertFalse(projection.hasContent)
        XCTAssertEqual(projection.unitSymbol, "kPa")
    }

    func testPresentSnapshotProducesFourOrderedTilesAndOverall() {
        let snapshot = TPPanelSnapshot(
            frontLeftPa: 288_000,
            frontRightPa: 290_000,
            rearLeftPa: 296_000,
            rearRightPa: 294_000
        )
        let projection = TPPanelProjector.project(snapshot: snapshot, unit: .kpa, localeIdentifier: "en_US")
        XCTAssertTrue(projection.hasContent)
        XCTAssertEqual(projection.readings.map(\.corner), TPPanelCorner.ordered)
        XCTAssertEqual(projection.readings.map(\.variant), [.success, .success, .success, .success])
        XCTAssertEqual(projection.overall, .allNormal)
        XCTAssertEqual(projection.readings.first?.valueText, "288.0 kPa")
    }

    func testMixedBandsAndEmptyCorner() {
        let snapshot = TPPanelSnapshot(
            frontLeftPa: 275_000,
            frontRightPa: 220_000,
            rearLeftPa: 190_000,
            rearRightPa: nil
        )
        let projection = TPPanelProjector.project(snapshot: snapshot, unit: .kpa)
        XCTAssertEqual(projection.readings.map(\.variant), [.success, .warning, .danger, .neutral])
        XCTAssertEqual(projection.overall, .attention)
        XCTAssertEqual(projection.readings.last?.valueText, "—")
    }

    func testResolvePhase() {
        XCTAssertEqual(TPPanelProjector.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(TPPanelProjector.resolvePhase(.loading, hasContent: true), .content)
        XCTAssertEqual(TPPanelProjector.resolvePhase(.loaded, hasContent: false), .empty)
        XCTAssertEqual(TPPanelProjector.resolvePhase(.loaded, hasContent: true), .content)
        XCTAssertEqual(TPPanelProjector.resolvePhase(.failed("x"), hasContent: false), .error("x"))
        XCTAssertEqual(TPPanelProjector.resolvePhase(.failed("x"), hasContent: true), .content)
    }
}

// MARK: - State holder

/// Counts `view.opened` emissions for the telemetry-once assertion.
private final class SpyTPPanelTelemetry: TPPanelTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []
    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

@MainActor
final class TPPanelModelTests: XCTestCase {
    private func makeModel(
        _ update: TPPanelUpdate,
        telemetry: SpyTPPanelTelemetry = SpyTPPanelTelemetry()
    ) -> (TirePressurePanelModel, InMemoryTPPanelSource) {
        let source = InMemoryTPPanelSource(initial: update)
        let model = TirePressurePanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartEmitsTelemetryOnceAndProjectsContent() {
        let snapshot = TPPanelSnapshot(frontLeftPa: 290_000)
        let telemetry = SpyTPPanelTelemetry()
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot), telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(telemetry.openedSurfaces, ["TirePressurePanel"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(TirePressurePanel.surfaceSlug, "TirePressurePanel")
    }

    func testLoadingAndEmptyAndErrorPhases() {
        let (loading, _) = makeModel(.init(status: .loading, snapshot: nil))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (empty, _) = makeModel(.init(status: .loaded, snapshot: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (failed, _) = makeModel(.init(status: .failed("boom"), snapshot: nil))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testStaleAutoRefreshFiresExactlyOncePerEpisode() {
        let snapshot = TPPanelSnapshot(frontLeftPa: 290_000)
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot, connection: .live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(.init(status: .loaded, snapshot: snapshot, connection: .stale))
        source.push(.init(status: .loaded, snapshot: snapshot, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale must auto-refresh once per episode")

        source.push(.init(status: .loaded, snapshot: snapshot, connection: .live))
        source.push(.init(status: .loaded, snapshot: snapshot, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a new stale episode re-triggers once")
    }

    func testOfflineKeepsCachedGridWithoutRefresh() {
        let snapshot = TPPanelSnapshot(frontLeftPa: 290_000)
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot, connection: .live))
        model.start()

        source.push(.init(status: .failed("net"), snapshot: snapshot, connection: .offline))
        XCTAssertEqual(model.phase, .content, "cached grid stays visible while offline")
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testStopResetsStartedGuard() {
        let telemetry = SpyTPPanelTelemetry()
        let (model, source) = makeModel(.init(status: .loaded, snapshot: nil), telemetry: telemetry)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(telemetry.openedSurfaces.count, 2)
    }
}

// MARK: - Accessibility

final class TPPanelAccessibilityTests: XCTestCase {
    private func localize(_: String, _ fallback: String) -> String {
        fallback
    }

    func testSummaryListsOverallAndCorners() {
        let snapshot = TPPanelSnapshot(
            frontLeftPa: 290_000,
            frontRightPa: 220_000,
            rearLeftPa: 190_000,
            rearRightPa: nil
        )
        let projection = TPPanelProjector.project(snapshot: snapshot, unit: .kpa, localeIdentifier: "en_US")
        let summary = TPPanelAccessibility.summary(projection: projection, localize: localize)
        XCTAssertTrue(summary.hasPrefix("Tire Pressure:"))
        XCTAssertTrue(summary.contains("Attention Needed"))
        XCTAssertTrue(summary.contains("Front Left 290.0 kPa"))
        XCTAssertTrue(summary.contains("Front Right 220.0 kPa"))
        XCTAssertTrue(summary.contains("Rear Left 190.0 kPa"))
        XCTAssertTrue(summary.contains("Rear Right —"))
    }

    func testSummaryEmptySentence() {
        let projection = TPPanelProjector.project(snapshot: nil, unit: .kpa)
        let summary = TPPanelAccessibility.summary(projection: projection, localize: localize)
        XCTAssertEqual(summary, "Tire Pressure: No tire pressure data available")
    }
}
