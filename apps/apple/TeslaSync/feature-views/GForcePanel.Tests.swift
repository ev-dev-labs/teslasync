//
//  GForcePanel.Tests.swift
//  TeslaSync — P4 feature view · 0169 · GForcePanel (Apple)
//
//  Unit + UI coverage for the GForcePanel surface: the adapter projection (web-parity formatting,
//  the combined-magnitude math, the `'—'` sentinel vs `g` unit, the VoiceOver phrase), the `hasAny`
//  gate, the state-holder phase/refresh/telemetry seam, the VoiceOver summary, and a per-state view
//  render smoke. Pure-logic tests use `InMemoryGForceSource`; the view tests render via
//  `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: number formatting (web parity)

@MainActor final class GForceFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(GForceFormat.number(1234.0, decimals: 1), "1,234.0")
        XCTAssertEqual(GForceFormat.number(1234.567, decimals: 2), "1,234.57")
        XCTAssertEqual(GForceFormat.number(0.3, decimals: 2), "0.30")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(GForceFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(GForceFormat.number(2.5, decimals: 0), "3")
    }

    func testNegativeValuesKeepSign() {
        XCTAssertEqual(GForceFormat.number(-0.15, decimals: 2), "-0.15")
    }

    func testDefaultDecimalsIsTwo() {
        // The web source pins every g value at two decimals (`fmtNumber(value, 2)`).
        XCTAssertEqual(GForceFormat.decimals, 2)
        XCTAssertEqual(GForceFormat.number(0.4), "0.40")
    }

    func testLocaleAffectsSeparators() {
        XCTAssertEqual(GForceFormat.number(0.5, localeIdentifier: "de_DE"), "0,50")
        XCTAssertEqual(GForceFormat.number(1234.5, decimals: 1, localeIdentifier: "de_DE"), "1.234,5")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(GForceFormat.safeNumber(.nan), 0)
        XCTAssertEqual(GForceFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(GForceFormat.safeNumber(0.32), 0.32)
    }
}

// MARK: - Adapter: snapshot `hasAny` gate (web parity)

@MainActor final class GForceSnapshotInputTests: XCTestCase {
    func testHasAnyMatchesWebGate() {
        XCTAssertFalse(GForceSnapshotInput().hasAny)
        XCTAssertTrue(GForceSnapshotInput(lateralAcceleration: 0).hasAny)
        XCTAssertTrue(GForceSnapshotInput(longitudinalAcceleration: 0).hasAny)
        XCTAssertTrue(GForceSnapshotInput(lateralAcceleration: -0.1).hasAny)
        XCTAssertTrue(GForceSnapshotInput(lateralAcceleration: 0.2, longitudinalAcceleration: 0.3).hasAny)
    }
}

// MARK: - Adapter: projector math (web parity)

@MainActor final class GForceProjectorTests: XCTestCase {
    private func tile(_ id: String, in projection: GForceProjection) -> GForceStatTile? {
        projection.tiles.first { $0.id == id }
    }

    func testTileOrderAndUnitsAreG() {
        let reading = GForceSnapshotInput(lateralAcceleration: 0.32, longitudinalAcceleration: -0.15)
        let projection = GForceProjector.project(reading: reading, units: GForceUnitPrefs())
        XCTAssertEqual(projection.tiles.map(\.id), ["lateral", "longitudinal", "combined"])
        XCTAssertEqual(projection.tiles.map(\.unit), ["g", "g", "g"])
    }

    func testLateralAndLongitudinalFormatAndLabels() {
        let reading = GForceSnapshotInput(lateralAcceleration: 0.32, longitudinalAcceleration: -0.15)
        let projection = GForceProjector.project(reading: reading, units: GForceUnitPrefs())
        let lateral = tile("lateral", in: projection)
        let longitudinal = tile("longitudinal", in: projection)
        XCTAssertEqual(lateral?.value, "0.32")
        XCTAssertEqual(lateral?.label, "Lateral")
        XCTAssertTrue(lateral?.hasReading ?? false)
        XCTAssertEqual(longitudinal?.value, "-0.15")
        XCTAssertEqual(longitudinal?.label, "Longitudinal")
    }

    func testCombinedIsMagnitudeOfBothAxes() {
        // sqrt(0.3² + 0.4²) = sqrt(0.25) = 0.5
        let reading = GForceSnapshotInput(lateralAcceleration: 0.3, longitudinalAcceleration: 0.4)
        let projection = GForceProjector.project(reading: reading, units: GForceUnitPrefs())
        let combined = tile("combined", in: projection)
        XCTAssertEqual(combined?.value, "0.50")
        XCTAssertEqual(combined?.label, "Combined")
        XCTAssertTrue(combined?.hasReading ?? false)
    }

    func testCombinedRequiresBothAxes() {
        // Only lateral present → combined has no reading (web `lateral != null && longitudinal != null`).
        let reading = GForceSnapshotInput(lateralAcceleration: 0.3, longitudinalAcceleration: nil)
        let projection = GForceProjector.project(reading: reading, units: GForceUnitPrefs())
        XCTAssertEqual(tile("lateral", in: projection)?.value, "0.30")
        let longitudinal = tile("longitudinal", in: projection)
        XCTAssertEqual(longitudinal?.value, "—")
        XCTAssertEqual(longitudinal?.unit, "g")
        XCTAssertFalse(longitudinal?.hasReading ?? true)
        let combined = tile("combined", in: projection)
        XCTAssertEqual(combined?.value, "—")
        XCTAssertEqual(combined?.unit, "g")
        XCTAssertFalse(combined?.hasReading ?? true)
    }

    func testMissingReadingUsesEmDashValueWithGUnit() {
        let projection = GForceProjector.project(reading: GForceSnapshotInput(), units: GForceUnitPrefs())
        for id in ["lateral", "longitudinal", "combined"] {
            XCTAssertEqual(tile(id, in: projection)?.value, "—")
            XCTAssertEqual(tile(id, in: projection)?.unit, "g")
            XCTAssertFalse(tile(id, in: projection)?.hasReading ?? true)
            // VoiceOver speaks the localized phrase rather than the visual em-dash sentinel.
            XCTAssertEqual(tile(id, in: projection)?.spokenValue, "No reading")
        }
    }

    func testNonFiniteReadingCollapsesToZeroButCountsAsReading() {
        let reading = GForceSnapshotInput(lateralAcceleration: .nan, longitudinalAcceleration: .infinity)
        let projection = GForceProjector.project(reading: reading, units: GForceUnitPrefs())
        let lateral = tile("lateral", in: projection)
        // safeNumber collapses non-finite to 0, but the field was present → 'g' unit, full reading.
        XCTAssertEqual(lateral?.value, "0.00")
        XCTAssertEqual(lateral?.unit, "g")
        XCTAssertTrue(lateral?.hasReading ?? false)
        XCTAssertEqual(lateral?.spokenValue, "0.00 g")
        // Both axes present → combined is a reading even though the magnitude collapses to 0.
        XCTAssertTrue(tile("combined", in: projection)?.hasReading ?? false)
        XCTAssertEqual(tile("combined", in: projection)?.value, "0.00")
    }

    func testLocalePrefFlowsIntoValue() {
        let units = GForceUnitPrefs(localeIdentifier: "de_DE")
        let reading = GForceSnapshotInput(lateralAcceleration: 0.5, longitudinalAcceleration: 0.5)
        let projection = GForceProjector.project(reading: reading, units: units)
        XCTAssertEqual(tile("lateral", in: projection)?.value, "0,50")
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class GForcePanelModelTests: XCTestCase {
    private func makeModel(
        _ update: GForceUpdate,
        telemetry: GForceTelemetry = OSLogGForceTelemetry()
    ) -> (GForcePanelModel, InMemoryGForceSource) {
        let source = InMemoryGForceSource(initial: update)
        let model = GForcePanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> GForceSnapshotInput {
        GForceSnapshotInput(lateralAcceleration: 0.32, longitudinalAcceleration: -0.15)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(GForcePanelModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsTiles() {
        let (model, _) = makeModel(GForceUpdate(status: .loaded, reading: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.tiles.count, 3)
        XCTAssertEqual(model.projection?.tiles.first?.id, "lateral")
    }

    func testLoadedButBothNilIsEmpty() {
        // Web `hasAny` false → empty even though the snapshot object exists.
        let (model, _) = makeModel(GForceUpdate(status: .loaded, reading: GForceSnapshotInput()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(GForceUpdate(status: .empty, reading: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)
        let (loading, _) = makeModel(GForceUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)
        let (failed, _) = makeModel(GForceUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedReadingsStayContentWhileFailing() {
        let (model, source) = makeModel(GForceUpdate(status: .loaded, reading: sample()))
        model.start()
        source.push(GForceUpdate(status: .failed("net"), connection: .offline, reading: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testUnitsAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(GForceUpdate(status: .loading))
        model.start()
        source.push(
            GForceUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                reading: sample(),
                units: GForceUnitPrefs(localeIdentifier: "de_DE"),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.localeIdentifier, "de_DE")
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(GForceUpdate(status: .loaded, reading: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(GForceUpdate(status: .loaded, reading: sample()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(GForceUpdate(status: .loaded, connection: .stale, reading: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        // still stale → guarded, no repeat
        source.push(GForceUpdate(status: .loaded, connection: .stale, reading: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        // back to live resets the guard, next stale fires once more
        source.push(GForceUpdate(status: .loaded, connection: .live, reading: sample()))
        source.push(GForceUpdate(status: .loaded, connection: .stale, reading: sample()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshIfStaleGuardsFetching() {
        let (model, source) = makeModel(GForceUpdate(status: .loaded, reading: sample()))
        model.start()
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(GForceUpdate(status: .loaded, connection: .stale, isFetching: true, reading: sample()))
        let countAfterStaleFetching = source.refreshCount
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, countAfterStaleFetching)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyGForceTelemetry()
        let (model, source) = makeModel(GForceUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [GForcePanelSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor final class GForceAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryTile() {
        let reading = GForceSnapshotInput(lateralAcceleration: 0.32, longitudinalAcceleration: -0.15)
        let projection = GForceProjector.project(reading: reading, units: GForceUnitPrefs())
        let summary = GForceAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Lateral 0.32 g"))
        XCTAssertTrue(summary.contains("Longitudinal -0.15 g"))
        // sqrt(0.32² + 0.15²) ≈ 0.353 → "0.35"
        XCTAssertTrue(summary.contains("Combined 0.35 g"))
    }

    func testSummarySpeaksNoReadingForMissingValues() {
        let reading = GForceSnapshotInput(lateralAcceleration: 0.2, longitudinalAcceleration: nil)
        let projection = GForceProjector.project(reading: reading, units: GForceUnitPrefs())
        let summary = GForceAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Lateral 0.20 g"))
        XCTAssertTrue(summary.contains("Longitudinal No reading"))
        XCTAssertTrue(summary.contains("Combined No reading"))
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class GForcePanelViewStateTests: XCTestCase {
        private func renders(_ update: GForceUpdate) -> Bool {
            let source = InMemoryGForceSource(initial: update)
            let model = GForcePanelModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: GForcePanel(model: model).frame(width: 390, height: 280))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sample() -> GForceSnapshotInput {
            GForceSnapshotInput(lateralAcceleration: 0.32, longitudinalAcceleration: -0.15)
        }

        func testContentRenders() {
            XCTAssertTrue(renders(GForceUpdate(status: .loaded, reading: sample())))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(GForceUpdate(status: .empty, reading: nil)))
        }

        func testEmptyFromBothNilRenders() {
            XCTAssertTrue(renders(GForceUpdate(status: .loaded, reading: GForceSnapshotInput())))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(GForceUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(GForceUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(GForceUpdate(status: .loaded, connection: .stale, reading: sample())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(GForceUpdate(status: .loaded, connection: .offline, reading: sample())))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyGForceTelemetry: GForceTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
