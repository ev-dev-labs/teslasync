//
//  PedalUsage.Tests.swift
//  TeslaSync — P4 feature view · 0173 · PedalUsage (Apple)
//
//  Unit + UI coverage for the PedalUsage surface: the adapter projection (web-parity formatting,
//  gauge clamp/fill/decimals, the `'%'` vs `'—'` unit branch, the brake-active badge tone/text), the
//  `hasAny` gate, the state-holder phase/refresh/telemetry seam, the VoiceOver summary, and a
//  per-state view render smoke. Pure-logic tests use `InMemoryPedalSource`; the view tests render via
//  `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: number formatting (web parity)

@MainActor final class PedalFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(PedalFormat.number(1234.0, decimals: 1), "1,234.0")
        XCTAssertEqual(PedalFormat.number(1234.567, decimals: 2), "1,234.57")
        XCTAssertEqual(PedalFormat.number(73, decimals: 0), "73")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(PedalFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(PedalFormat.number(2.5, decimals: 0), "3")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(PedalFormat.safeNumber(.nan), 0)
        XCTAssertEqual(PedalFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(PedalFormat.safeNumber(42.5), 42.5)
    }
}

// MARK: - Adapter: snapshot `hasAny` gate (web parity)

@MainActor final class PedalSnapshotInputTests: XCTestCase {
    func testHasAnyMatchesWebGate() {
        XCTAssertFalse(PedalSnapshotInput().hasAny)
        XCTAssertTrue(PedalSnapshotInput(throttlePosition: 0).hasAny)
        XCTAssertTrue(PedalSnapshotInput(brakePedalPosition: 0).hasAny)
        // A present-but-false brake flag still counts (web `brakeActive != null`).
        XCTAssertTrue(PedalSnapshotInput(brakePedalActive: false).hasAny)
        XCTAssertTrue(PedalSnapshotInput(brakePedalActive: true).hasAny)
    }
}

// MARK: - Adapter: projector gauge math (web parity)

@MainActor final class PedalProjectorTests: XCTestCase {
    private func gauge(_ id: String, in projection: PedalProjection) -> PedalGaugeTile? {
        projection.gauges.first { $0.id == id }
    }

    func testGaugeOrderAccentsAndUnits() {
        let pedal = PedalSnapshotInput(throttlePosition: 42.5, brakePedalPosition: 0, brakePedalActive: false)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        XCTAssertEqual(projection.gauges.map(\.id), ["throttle", "brake"])
        XCTAssertEqual(projection.gauges.map(\.accent), [.throttleCyan, .brakeRed])
        XCTAssertEqual(gauge("throttle", in: projection)?.unit, "%")
        XCTAssertEqual(gauge("brake", in: projection)?.unit, "%")
    }

    func testThrottleFormatsCenterFillAndCaption() {
        let pedal = PedalSnapshotInput(throttlePosition: 42.5, brakePedalPosition: 0, brakePedalActive: false)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        let throttle = gauge("throttle", in: projection)
        // 42.5 is non-integer → global precision 2
        XCTAssertEqual(throttle?.centerValue, "42.50")
        XCTAssertEqual(throttle?.caption, "Throttle Position")
        XCTAssertEqual(throttle?.label, "Throttle")
        XCTAssertTrue(throttle?.hasReading ?? false)
        XCTAssertEqual(throttle?.fraction ?? -1, 42.5 / 100.0, accuracy: 1e-9)
    }

    func testIntegerReadingHasNoDecimals() {
        let pedal = PedalSnapshotInput(throttlePosition: 42, brakePedalPosition: 100, brakePedalActive: false)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        XCTAssertEqual(gauge("throttle", in: projection)?.centerValue, "42")
        XCTAssertEqual(gauge("brake", in: projection)?.centerValue, "100")
    }

    func testMissingReadingUsesEmDashUnitAndZeroFill() {
        // Only the brake flag is present; both position gauges read as "no reading".
        let pedal = PedalSnapshotInput(throttlePosition: nil, brakePedalPosition: nil, brakePedalActive: true)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        let throttle = gauge("throttle", in: projection)
        XCTAssertEqual(throttle?.centerValue, "0")
        XCTAssertEqual(throttle?.unit, "—")
        XCTAssertFalse(throttle?.hasReading ?? true)
        XCTAssertEqual(throttle?.fraction ?? -1, 0, accuracy: 1e-9)
        // VoiceOver speaks the localized phrase rather than the visual placeholder. // parity:allow ui
        XCTAssertEqual(throttle?.spokenValue, "No reading")
    }

    func testValuesClampToGaugeMax() {
        let pedal = PedalSnapshotInput(throttlePosition: 120, brakePedalPosition: 150, brakePedalActive: true)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        XCTAssertEqual(gauge("throttle", in: projection)?.centerValue, "100")
        XCTAssertEqual(gauge("throttle", in: projection)?.fraction ?? -1, 1, accuracy: 1e-9)
        XCTAssertEqual(gauge("brake", in: projection)?.centerValue, "100")
        XCTAssertEqual(gauge("brake", in: projection)?.fraction ?? -1, 1, accuracy: 1e-9)
    }

    func testNonFiniteReadingCollapsesToZeroButCountsAsReading() {
        let pedal = PedalSnapshotInput(throttlePosition: .nan, brakePedalPosition: .infinity, brakePedalActive: false)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        // safeNumber collapses non-finite to 0, but the field was present → '%' unit, full reading.
        XCTAssertEqual(gauge("throttle", in: projection)?.centerValue, "0")
        XCTAssertEqual(gauge("throttle", in: projection)?.unit, "%")
        XCTAssertTrue(gauge("throttle", in: projection)?.hasReading ?? false)
        XCTAssertEqual(gauge("throttle", in: projection)?.spokenValue, "0%")
    }

    func testPrecisionPreferenceFlowsIntoCenterValue() {
        let units = PedalUnitPrefs(localeIdentifier: "en_US", precision: 3)
        let pedal = PedalSnapshotInput(throttlePosition: 42.5, brakePedalPosition: 0, brakePedalActive: false)
        let projection = PedalProjector.project(pedal: pedal, units: units)
        XCTAssertEqual(gauge("throttle", in: projection)?.centerValue, "42.500")
    }

    func testBrakeStatusToneAndText() {
        let active = PedalProjector.project(
            pedal: PedalSnapshotInput(brakePedalActive: true),
            units: PedalUnitPrefs()
        ).brake
        XCTAssertTrue(active.isActive)
        XCTAssertTrue(active.isDanger)
        XCTAssertEqual(active.displayText, "Brake Active")
        XCTAssertEqual(active.label, "Brake Pedal Status")

        let inactive = PedalBrakeStatus(isActive: false)
        XCTAssertFalse(inactive.isDanger)
        XCTAssertEqual(inactive.displayText, "Brake Inactive")
    }

    func testBrakeFlagNilAndFalseBothReadInactive() {
        let nilFlag = PedalProjector.project(
            pedal: PedalSnapshotInput(throttlePosition: 10, brakePedalActive: nil),
            units: PedalUnitPrefs()
        ).brake
        XCTAssertFalse(nilFlag.isActive)
        XCTAssertEqual(nilFlag.displayText, "Brake Inactive")
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class PedalUsageModelTests: XCTestCase {
    private func makeModel(
        _ update: PedalUpdate,
        telemetry: PedalTelemetry = OSLogPedalTelemetry()
    ) -> (PedalUsageModel, InMemoryPedalSource) {
        let source = InMemoryPedalSource(initial: update)
        let model = PedalUsageModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> PedalSnapshotInput {
        PedalSnapshotInput(throttlePosition: 42.5, brakePedalPosition: 0, brakePedalActive: false)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(PedalUsageModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsGaugesAndBrake() {
        let (model, _) = makeModel(PedalUpdate(status: .loaded, pedal: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauges.count, 2)
        XCTAssertEqual(model.projection?.brake.displayText, "Brake Inactive")
    }

    func testLoadedButAllPedalsNilIsEmpty() {
        // Web `hasAny` false → empty even though the snapshot object exists.
        let (model, _) = makeModel(PedalUpdate(status: .loaded, pedal: PedalSnapshotInput()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(PedalUpdate(status: .empty, pedal: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)
        let (loading, _) = makeModel(PedalUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)
        let (failed, _) = makeModel(PedalUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedReadingsStayContentWhileFailing() {
        let (model, source) = makeModel(PedalUpdate(status: .loaded, pedal: sample()))
        model.start()
        source.push(PedalUpdate(status: .failed("net"), connection: .offline, pedal: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testUnitsAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(PedalUpdate(status: .loading))
        model.start()
        source.push(
            PedalUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                pedal: sample(),
                units: PedalUnitPrefs(localeIdentifier: "de_DE", precision: 1),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.precision, 1)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(PedalUpdate(status: .loaded, pedal: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(PedalUpdate(status: .loaded, pedal: sample()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(PedalUpdate(status: .loaded, connection: .stale, pedal: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        // still stale → guarded, no repeat
        source.push(PedalUpdate(status: .loaded, connection: .stale, pedal: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        // back to live resets the guard, next stale fires once more
        source.push(PedalUpdate(status: .loaded, connection: .live, pedal: sample()))
        source.push(PedalUpdate(status: .loaded, connection: .stale, pedal: sample()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshIfStaleGuardsFetching() {
        let (model, source) = makeModel(PedalUpdate(status: .loaded, pedal: sample()))
        model.start()
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(PedalUpdate(status: .loaded, connection: .stale, isFetching: true, pedal: sample()))
        let countAfterStaleFetching = source.refreshCount
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, countAfterStaleFetching)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyPedalTelemetry()
        let (model, source) = makeModel(PedalUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PedalUsageSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor final class PedalAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryGaugeAndBrake() {
        let pedal = PedalSnapshotInput(throttlePosition: 42.5, brakePedalPosition: 0, brakePedalActive: false)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        let summary = PedalAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Throttle 42.50%"))
        XCTAssertTrue(summary.contains("Brake 0%"))
        XCTAssertTrue(summary.contains("Brake Pedal Status Brake Inactive"))
    }

    func testSummarySpeaksNoReadingForMissingValues() {
        let pedal = PedalSnapshotInput(throttlePosition: nil, brakePedalPosition: nil, brakePedalActive: true)
        let projection = PedalProjector.project(pedal: pedal, units: PedalUnitPrefs())
        let summary = PedalAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Throttle No reading"))
        XCTAssertTrue(summary.contains("Brake Pedal Status Brake Active"))
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class PedalUsageViewStateTests: XCTestCase {
        private func renders(_ update: PedalUpdate) -> Bool {
            let source = InMemoryPedalSource(initial: update)
            let model = PedalUsageModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: PedalUsage(model: model).frame(width: 390, height: 340))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sample() -> PedalSnapshotInput {
            PedalSnapshotInput(throttlePosition: 42.5, brakePedalPosition: 0, brakePedalActive: false)
        }

        func testContentRenders() {
            XCTAssertTrue(renders(PedalUpdate(status: .loaded, pedal: sample())))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(PedalUpdate(status: .empty, pedal: nil)))
        }

        func testEmptyFromAllNilPedalsRenders() {
            XCTAssertTrue(renders(PedalUpdate(status: .loaded, pedal: PedalSnapshotInput())))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(PedalUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(PedalUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(PedalUpdate(status: .loaded, connection: .stale, pedal: sample())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(PedalUpdate(status: .loaded, connection: .offline, pedal: sample())))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPedalTelemetry: PedalTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
