//
//  BatteryPill.Tests.swift
//  TeslaSync — P4 feature view · 0073 · BatteryPill (Apple)
//
//  Unit coverage for the BatteryPill surface. BatteryPill is a pure presentational
//  chip (the web source fetches nothing), so the meaningful, host-free surface
//  area is:
//    • the `STATUS_COLORS` threshold ladder (incl. the boundary + NaN/negative
//      `else` branch) and its token mapping,
//    • the `fmtInt` / `safeNumber` value formatting (grouping, rounding, the
//      non-finite ⇒ `0` guard),
//    • the meter-fill clamp (web `min(level, 100)` with negatives clamped to 0),
//    • the VoiceOver descriptor policy,
//    • the `view.opened` telemetry slug.
//  These mirror the three branches the web component carries. No rendering / no
//  KMP runtime required.
//
//  The whole file is gated on `canImport(XCTest)`: the feature-views group is a
//  member of the app targets as well as the test bundle, and the app targets do
//  not link XCTest. The guard means this file compiles to nothing there (so it
//  never breaks the app build) while still compiling and running in the XCTest
//  bundle.
//

#if canImport(XCTest)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor final class BatteryPillTests: XCTestCase {
        private let enUS = Locale(identifier: "en_US")

        // MARK: - Tint ladder (web `level >= 60 ? good : level >= 30 ? warning : critical`)

        func testTintGoodAtAndAboveSixty() {
            XCTAssertEqual(BatteryPillTint(level: 100), .good)
            XCTAssertEqual(BatteryPillTint(level: 60), .good) // boundary is inclusive (web `>=`)
            XCTAssertEqual(BatteryPillTint(level: 60.0001), .good)
        }

        func testTintWarningInThirtyToSixty() {
            XCTAssertEqual(BatteryPillTint(level: 59.9), .warning)
            XCTAssertEqual(BatteryPillTint(level: 45), .warning)
            XCTAssertEqual(BatteryPillTint(level: 30), .warning) // boundary is inclusive (web `>=`)
        }

        func testTintCriticalBelowThirty() {
            XCTAssertEqual(BatteryPillTint(level: 29.9), .critical)
            XCTAssertEqual(BatteryPillTint(level: 0), .critical)
        }

        func testTintCriticalForNegativeAndNonFinite() {
            // Parity with JS: `NaN >= n` and `-x >= n` are false, so both fall to `else`.
            XCTAssertEqual(BatteryPillTint(level: -10), .critical)
            XCTAssertEqual(BatteryPillTint(level: .nan), .critical)
            XCTAssertEqual(BatteryPillTint(level: -.infinity), .critical)
        }

        func testTintCoversExactlyThreeTiers() {
            XCTAssertEqual(BatteryPillTint.allCases.map(\.rawValue), ["good", "warning", "critical"])
        }

        func testTintThresholdsMatchWeb() {
            XCTAssertEqual(BatteryPillTint.goodThreshold, 60, accuracy: 0.0001)
            XCTAssertEqual(BatteryPillTint.warningThreshold, 30, accuracy: 0.0001)
        }

        func testTintColorsMapToStatusTokens() {
            XCTAssertEqual(BatteryPillTint.good.color, Color.TS.statusSuccess)
            XCTAssertEqual(BatteryPillTint.warning.color, Color.TS.statusWarning)
            XCTAssertEqual(BatteryPillTint.critical.color, Color.TS.statusDanger)
        }

        func testTintAccessibilityDescriptorsAreDistinctKeys() {
            XCTAssertEqual(BatteryPillTint.good.accessibilityStatusKey, LocalizedStringKey("battery.pill.status.good"))
            XCTAssertEqual(
                BatteryPillTint.warning.accessibilityStatusKey,
                LocalizedStringKey("battery.pill.status.warning")
            )
            XCTAssertEqual(
                BatteryPillTint.critical.accessibilityStatusKey,
                LocalizedStringKey("battery.pill.status.critical")
            )
        }

        // MARK: - Number formatting (web `fmtInt` / `safeNumber`)

        func testFmtIntGroupsAndRounds() {
            XCTAssertEqual(BatteryPillNumber.fmtInt(12345.6, locale: enUS), "12,346")
            XCTAssertEqual(BatteryPillNumber.fmtInt(72, locale: enUS), "72")
            XCTAssertEqual(BatteryPillNumber.fmtInt(45.4, locale: enUS), "45")
            XCTAssertEqual(BatteryPillNumber.fmtInt(89.5, locale: enUS), "90") // positive tie rounds up
        }

        func testFmtIntCoercesNonFiniteToZero() {
            XCTAssertEqual(BatteryPillNumber.fmtInt(.nan, locale: enUS), "0")
            XCTAssertEqual(BatteryPillNumber.fmtInt(.infinity, locale: enUS), "0")
            XCTAssertEqual(BatteryPillNumber.fmtInt(-.infinity, locale: enUS), "0")
        }

        // MARK: - Presentation projection

        func testFillFractionClampsToUnitInterval() {
            XCTAssertEqual(BatteryPillPresentation(level: 50).fillFraction, 0.5, accuracy: 0.0001)
            XCTAssertEqual(BatteryPillPresentation(level: 0).fillFraction, 0, accuracy: 0.0001)
            XCTAssertEqual(BatteryPillPresentation(level: 100).fillFraction, 1, accuracy: 0.0001)
            XCTAssertEqual(BatteryPillPresentation(level: 120).fillFraction, 1, accuracy: 0.0001) // web min(level, 100)
            XCTAssertEqual(BatteryPillPresentation(level: -25).fillFraction, 0, accuracy: 0.0001) // CSS clamps neg to 0
            XCTAssertEqual(BatteryPillPresentation(level: .nan).fillFraction, 0, accuracy: 0.0001)
        }

        func testDisplayLevelCoercesNonFiniteToZero() {
            XCTAssertEqual(BatteryPillPresentation(level: 72).displayLevel, 72, accuracy: 0.0001)
            XCTAssertEqual(BatteryPillPresentation(level: .nan).displayLevel, 0, accuracy: 0.0001)
        }

        func testPercentTextMatchesFmtInt() {
            XCTAssertEqual(BatteryPillPresentation(level: 82).percentText(locale: enUS), "82")
            XCTAssertEqual(BatteryPillPresentation(level: 1234.6).percentText(locale: enUS), "1,235")
            XCTAssertEqual(BatteryPillPresentation(level: .nan).percentText(locale: enUS), "0")
        }

        func testPresentationResolvesTint() {
            XCTAssertEqual(BatteryPillPresentation(level: 82).tint, .good)
            XCTAssertEqual(BatteryPillPresentation(level: 45).tint, .warning)
            XCTAssertEqual(BatteryPillPresentation(level: 5).tint, .critical)
        }

        func testPresentationIsValueEquatable() {
            XCTAssertEqual(BatteryPillPresentation(level: 50), BatteryPillPresentation(level: 50))
            XCTAssertNotEqual(BatteryPillPresentation(level: 50), BatteryPillPresentation(level: 70))
        }

        func testPresentationIconAndSlugAreStable() {
            let presentation = BatteryPillPresentation(level: 50)
            XCTAssertEqual(presentation.iconSystemName, "battery.100")
            XCTAssertEqual(presentation.surfaceSlug, "BatteryPill")
        }

        // MARK: - Telemetry (P1/S11 `view.opened`)

        func testSurfaceSlugIsStable() {
            XCTAssertEqual(BatteryPillSurface.slug, "BatteryPill")
        }

        func testReportOpenEmitsViewOpenedWithSlug() {
            let sink = BufferedBatteryPillTelemetry()
            BatteryPillSurface.reportOpen(to: sink)
            XCTAssertEqual(sink.opened, ["BatteryPill"])
        }
    }

    // MARK: - Test doubles

    /// A thread-safe buffered diagnostics sink for asserting the `view.opened` slug.
    private final class BufferedBatteryPillTelemetry: BatteryPillTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var buffer: [String] = []

        var opened: [String] {
            lock.lock()
            defer { lock.unlock() }
            return buffer
        }

        func viewOpened(surface: String) {
            lock.lock()
            defer { lock.unlock() }
            buffer.append(surface)
        }
    }
#endif
