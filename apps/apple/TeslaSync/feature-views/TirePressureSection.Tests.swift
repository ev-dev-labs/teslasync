//
//  TirePressureSection.Tests.swift
//  TeslaSync — P4 feature view · 0299 · TirePressureSection (Apple)
//
//  Unit coverage for the TirePressureSection surface:
//    • Conversion (`convertTirePressureFromSI`) — SI(Pa)→kPa/psi/bar parity with
//      lib/unitConversion.ts.
//    • Classification (`tirePressureVariant` + `TPSectionStatus.classify`) — the
//      helpers.ts band ports, plus a parity check that the badge text status and the
//      `tirePressureVariant` tone agree on every band boundary.
//    • Formatting (`TPSectionFormat.pressure`) — the `formatPressure(paToKpa(value))`
//      port (precision 1, unit suffix, `—` empty display).
//    • Projector (`TPSectionProjector`) — nil → empty gate, present snapshot → four
//      ordered tiles, and phase resolution.
//    • State holder (`TirePressureSectionModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping the cached grid.
//    • Accessibility — the summary content (corners + statuses) and the empty sentence.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Conversion

final class TPSectionConversionTests: XCTestCase {
    func testKilopascalsDivideByThousand() {
        XCTAssertEqual(convertTirePressureFromSI(0, to: .kpa), 0, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(290_000, to: .kpa), 290, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(101_325, to: .kpa), 101.325, accuracy: 0.0001)
    }

    func testPsiMatchesFormula() {
        // 6894.757 Pa = 6.894757 kPa = exactly 1 psi.
        XCTAssertEqual(convertTirePressureFromSI(6894.757, to: .psi), 1, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(6_894_757, to: .psi), 1000, accuracy: 0.0001)
    }

    func testBarMatchesFormula() {
        // 100000 Pa = 100 kPa = exactly 1 bar.
        XCTAssertEqual(convertTirePressureFromSI(100_000, to: .bar), 1, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(290_000, to: .bar), 2.9, accuracy: 0.0001)
    }

    func testUnitFromSymbol() {
        XCTAssertEqual(TPSectionUnit.from(symbol: "kPa"), .kpa)
        XCTAssertEqual(TPSectionUnit.from(symbol: "psi"), .psi)
        XCTAssertEqual(TPSectionUnit.from(symbol: "bar"), .bar)
        XCTAssertEqual(TPSectionUnit.from(symbol: "garbage"), .kpa)
        XCTAssertEqual(TPSectionUnit.kpa.symbol, "kPa")
    }
}

// MARK: - Classification (helpers.ts parity)

final class TPSectionClassificationTests: XCTestCase {
    func testVariantBands() {
        XCTAssertEqual(tirePressureVariant(nil), .neutral)
        XCTAssertEqual(tirePressureVariant(Double.nan), .neutral)
        XCTAssertEqual(tirePressureVariant(206_799), .danger)
        XCTAssertEqual(tirePressureVariant(206_800), .warning)
        XCTAssertEqual(tirePressureVariant(241_299), .warning)
        XCTAssertEqual(tirePressureVariant(241_300), .success)
        XCTAssertEqual(tirePressureVariant(310_300), .success)
        XCTAssertEqual(tirePressureVariant(310_301), .warning)
        XCTAssertEqual(tirePressureVariant(344_700), .warning)
        XCTAssertEqual(tirePressureVariant(344_701), .danger)
    }

    func testStatusBands() {
        XCTAssertEqual(TPSectionStatus.classify(nil), .noData)
        XCTAssertEqual(TPSectionStatus.classify(Double.infinity), .noData)
        XCTAssertEqual(TPSectionStatus.classify(206_799), .critical)
        XCTAssertEqual(TPSectionStatus.classify(206_800), .low)
        XCTAssertEqual(TPSectionStatus.classify(241_299), .low)
        XCTAssertEqual(TPSectionStatus.classify(241_300), .normal)
        XCTAssertEqual(TPSectionStatus.classify(310_300), .normal)
        XCTAssertEqual(TPSectionStatus.classify(310_301), .low)
        XCTAssertEqual(TPSectionStatus.classify(344_700), .low)
        XCTAssertEqual(TPSectionStatus.classify(344_701), .critical)
    }

    /// The badge text status and the `tirePressureVariant` tone must agree on every
    /// band — proves the single classifier reproduces both web functions.
    func testStatusToneAgreesWithVariant() {
        let samples: [Double?] = [
            nil, 0, 206_799, 206_800, 241_299, 241_300,
            275_000, 310_300, 310_301, 344_700, 344_701, 400_000
        ]
        for sample in samples {
            XCTAssertEqual(
                TPSectionStatus.classify(sample).variant,
                tirePressureVariant(sample),
                "status/variant disagree at \(String(describing: sample))"
            )
        }
    }

    func testStatusLabels() {
        XCTAssertEqual(TPSectionStatus.normal.labelFallback, "Normal")
        XCTAssertEqual(TPSectionStatus.low.labelFallback, "Low")
        XCTAssertEqual(TPSectionStatus.critical.labelFallback, "Critical")
        XCTAssertEqual(TPSectionStatus.noData.labelFallback, "No Data")
        XCTAssertEqual(TPSectionStatus.noData.labelKey, "common.noData")
    }
}

// MARK: - Formatting (formatPressure parity)

final class TPSectionFormatTests: XCTestCase {
    func testEmptyDisplayForNullOrNonFinite() {
        XCTAssertEqual(TPSectionFormat.pressure(pascals: nil, unit: .kpa), "—")
        XCTAssertEqual(TPSectionFormat.pressure(pascals: Double.nan, unit: .kpa), "—")
        XCTAssertEqual(TPSectionFormat.pressure(pascals: nil, unit: .kpa, emptyDisplay: "n/a"), "n/a")
    }

    func testKilopascalOneFractionDigit() {
        XCTAssertEqual(
            TPSectionFormat.pressure(pascals: 289_500, unit: .kpa, localeIdentifier: "en_US"),
            "289.5 kPa"
        )
        XCTAssertEqual(
            TPSectionFormat.pressure(pascals: 206_800, unit: .kpa, localeIdentifier: "en_US"),
            "206.8 kPa"
        )
    }

    func testPsiAndBarSuffixes() {
        // 289.5 kPa / 6.894757 = 41.99 → 42.0 psi at one fraction digit.
        XCTAssertEqual(
            TPSectionFormat.pressure(pascals: 289_500, unit: .psi, localeIdentifier: "en_US"),
            "42.0 psi"
        )
        // 289.5 kPa / 100 = 2.895 → 2.9 bar.
        XCTAssertEqual(
            TPSectionFormat.pressure(pascals: 289_500, unit: .bar, localeIdentifier: "en_US"),
            "2.9 bar"
        )
    }

    func testGroupingSeparatorForLargeValue() {
        // 1,289.5 kPa keeps the locale grouping separator.
        XCTAssertEqual(
            TPSectionFormat.pressure(pascals: 1_289_500, unit: .kpa, localeIdentifier: "en_US"),
            "1,289.5 kPa"
        )
    }
}

// MARK: - Projector

final class TPSectionProjectorTests: XCTestCase {
    func testNilSnapshotIsEmptyGate() {
        let projection = TPSectionProjector.project(snapshot: nil, unit: .kpa)
        XCTAssertTrue(projection.readings.isEmpty)
        XCTAssertFalse(projection.hasSnapshot)
        XCTAssertFalse(projection.hasContent)
        XCTAssertEqual(projection.unitSymbol, "kPa")
    }

    func testPresentSnapshotProducesFourOrderedTiles() {
        let snapshot = TPSectionSnapshot(
            frontLeftPa: 288_000,
            frontRightPa: 290_000,
            rearLeftPa: 296_000,
            rearRightPa: 294_000
        )
        let projection = TPSectionProjector.project(snapshot: snapshot, unit: .kpa, localeIdentifier: "en_US")
        XCTAssertTrue(projection.hasContent)
        XCTAssertEqual(projection.readings.map(\.corner), TPSectionCorner.ordered)
        XCTAssertEqual(projection.readings.map(\.status), [.normal, .normal, .normal, .normal])
        XCTAssertEqual(projection.readings.first?.valueText, "288.0 kPa")
    }

    func testMixedStatusesAndEmptyCorner() {
        let snapshot = TPSectionSnapshot(
            frontLeftPa: 275_000,
            frontRightPa: 220_000,
            rearLeftPa: 190_000,
            rearRightPa: nil
        )
        let projection = TPSectionProjector.project(snapshot: snapshot, unit: .kpa)
        XCTAssertEqual(projection.readings.map(\.status), [.normal, .low, .critical, .noData])
        XCTAssertEqual(projection.readings.last?.valueText, "—")
    }

    func testResolvePhase() {
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loading, hasContent: true), .content)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loaded, hasContent: false), .empty)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loaded, hasContent: true), .content)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.failed("x"), hasContent: false), .error("x"))
        XCTAssertEqual(TPSectionProjector.resolvePhase(.failed("x"), hasContent: true), .content)
    }
}

// MARK: - State holder

/// Counts `view.opened` emissions for the telemetry-once assertion.
private final class SpyTPSectionTelemetry: TPSectionTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []
    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

@MainActor
final class TPSectionModelTests: XCTestCase {
    private func makeModel(
        _ update: TPSectionUpdate,
        telemetry: SpyTPSectionTelemetry = SpyTPSectionTelemetry()
    ) -> (TirePressureSectionModel, InMemoryTPSectionSource) {
        let source = InMemoryTPSectionSource(initial: update)
        let model = TirePressureSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartEmitsTelemetryOnceAndProjectsContent() {
        let snapshot = TPSectionSnapshot(frontLeftPa: 290_000)
        let telemetry = SpyTPSectionTelemetry()
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot), telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(telemetry.openedSurfaces, ["TirePressureSection"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(TirePressureSection.surfaceSlug, "TirePressureSection")
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
        let snapshot = TPSectionSnapshot(frontLeftPa: 290_000)
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
        let snapshot = TPSectionSnapshot(frontLeftPa: 290_000)
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot, connection: .live))
        model.start()

        source.push(.init(status: .failed("net"), snapshot: snapshot, connection: .offline))
        XCTAssertEqual(model.phase, .content, "cached grid stays visible while offline")
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testStopResetsStartedGuard() {
        let telemetry = SpyTPSectionTelemetry()
        let (model, source) = makeModel(.init(status: .loaded, snapshot: nil), telemetry: telemetry)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(telemetry.openedSurfaces.count, 2)
    }
}

// MARK: - Accessibility

final class TPSectionAccessibilityTests: XCTestCase {
    private func localize(_: String, _ fallback: String) -> String {
        fallback
    }

    func testSummaryListsCornersAndStatuses() {
        let snapshot = TPSectionSnapshot(
            frontLeftPa: 290_000,
            frontRightPa: 220_000,
            rearLeftPa: 190_000,
            rearRightPa: nil
        )
        let projection = TPSectionProjector.project(snapshot: snapshot, unit: .kpa, localeIdentifier: "en_US")
        let summary = TPSectionAccessibility.summary(projection: projection, localize: localize)
        XCTAssertTrue(summary.hasPrefix("Tire Pressure:"))
        XCTAssertTrue(summary.contains("Front Left 290.0 kPa, Normal"))
        XCTAssertTrue(summary.contains("Front Right 220.0 kPa, Low"))
        XCTAssertTrue(summary.contains("Rear Left 190.0 kPa, Critical"))
        XCTAssertTrue(summary.contains("Rear Right —, No Data"))
    }

    func testSummaryEmptySentence() {
        let projection = TPSectionProjector.project(snapshot: nil, unit: .kpa)
        let summary = TPSectionAccessibility.summary(projection: projection, localize: localize)
        XCTAssertEqual(summary, "Tire Pressure: No tire pressure data available")
    }
}
