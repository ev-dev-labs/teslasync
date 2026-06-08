//
//  KioskOverlay.Tests.swift
//  TeslaSync — P4 feature view · 0124 · KioskOverlay (Apple)
//
//  Unit coverage for the KioskOverlay surface. KioskOverlay is a pure presentational
//  overlay (the web source fetches nothing), so the meaningful, host-free surface
//  area is the projection ``KioskOverlayPresentation`` plus the value types it uses:
//    • the dim-opacity `1 - dimLevel` clamp (incl. negative / >1 / non-finite),
//    • the cursor-hide / clock / rotation-indicator gates,
//    • the clock-corner → SwiftUI alignment mapping (+ web-string decode),
//    • the locale-aware clock formatters (12h vs 24h, weekday/date),
//    • the 3-second exit auto-hide delay,
//    • the i18n fallback wiring + the `view.opened` telemetry slug.
//  These mirror the branches the web component carries. No rendering host required.
//
//  The whole file is gated on `canImport(XCTest)`: the feature-views group is a
//  member of the app targets as well as the test bundle, and the app targets do not
//  link XCTest. The guard means this file compiles to nothing there (so it never
//  breaks the app build) while still compiling and running in the XCTest bundle.
//

#if canImport(XCTest)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor final class KioskOverlayTests: XCTestCase {
        private let enUS = Locale(identifier: "en_US")
        private let enGB = Locale(identifier: "en_GB")
        private let utc = TimeZone(identifier: "UTC")!

        // MARK: - Dim opacity (web `opacity: 1 - dimLevel`, CSS-clamped)

        func testDimOpacityIsOneMinusLevel() {
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: 0.5), 0.5, accuracy: 0.0001)
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: 0.4), 0.6, accuracy: 0.0001)
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: 0), 1, accuracy: 0.0001)
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: 1), 0, accuracy: 0.0001)
        }

        func testDimOpacityClampsOutOfRange() {
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: 1.5), 0, accuracy: 0.0001)
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: -0.5), 1, accuracy: 0.0001)
        }

        func testDimOpacityNonFiniteResolvesToZero() {
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: .nan), 0, accuracy: 0.0001)
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: .infinity), 0, accuracy: 0.0001)
            XCTAssertEqual(KioskOverlayPresentation.dimOpacity(dimLevel: -.infinity), 0, accuracy: 0.0001)
        }

        // MARK: - Presentation gates

        func testPresentationReflectsFlags() {
            let presentation = makePresentation(isDimmed: true, isCursorHidden: true)
            XCTAssertTrue(presentation.isDimmed)
            XCTAssertTrue(presentation.hidesPointer)
        }

        func testHidesPointerTracksCursorFlag() {
            XCTAssertFalse(makePresentation(isCursorHidden: false).hidesPointer)
            XCTAssertTrue(makePresentation(isCursorHidden: true).hidesPointer)
        }

        func testShowsClockTracksConfig() {
            XCTAssertTrue(makePresentation(showClock: true).showsClock)
            XCTAssertFalse(makePresentation(showClock: false).showsClock)
        }

        // MARK: - Rotation indicator gate (web `count > 1 && rotateInterval > 0`)

        func testRotationIndicatorRequiresMultipleDashboards() {
            XCTAssertFalse(makePresentation(rotateInterval: 30, dashboardCount: 1).showsRotationIndicator)
            XCTAssertTrue(makePresentation(rotateInterval: 30, dashboardCount: 2).showsRotationIndicator)
        }

        func testRotationIndicatorRequiresPositiveInterval() {
            XCTAssertFalse(makePresentation(rotateInterval: 0, dashboardCount: 5).showsRotationIndicator)
            XCTAssertTrue(makePresentation(rotateInterval: 0.5, dashboardCount: 5).showsRotationIndicator)
        }

        func testDotIndicesAndActiveDot() {
            let presentation = makePresentation(rotateInterval: 30, dashboardCount: 5, currentIndex: 2)
            XCTAssertEqual(Array(presentation.dotIndices), [0, 1, 2, 3, 4])
            XCTAssertTrue(presentation.isActiveDot(2))
            XCTAssertFalse(presentation.isActiveDot(0))
        }

        func testDashboardCountFlooredAtZero() {
            XCTAssertEqual(makePresentation(dashboardCount: -3).dashboardCount, 0)
            XCTAssertEqual(Array(makePresentation(dashboardCount: -3).dotIndices), [])
        }

        // MARK: - Clock corner → alignment

        func testClockPositionFrameAlignment() {
            XCTAssertEqual(KioskClockPosition.topLeft.alignment, .topLeading)
            XCTAssertEqual(KioskClockPosition.topRight.alignment, .topTrailing)
            XCTAssertEqual(KioskClockPosition.bottomLeft.alignment, .bottomLeading)
            XCTAssertEqual(KioskClockPosition.bottomRight.alignment, .bottomTrailing)
        }

        func testClockPositionHorizontalAlignment() {
            XCTAssertEqual(KioskClockPosition.topLeft.horizontalAlignment, .leading)
            XCTAssertEqual(KioskClockPosition.bottomLeft.horizontalAlignment, .leading)
            XCTAssertEqual(KioskClockPosition.topRight.horizontalAlignment, .trailing)
            XCTAssertEqual(KioskClockPosition.bottomRight.horizontalAlignment, .trailing)
        }

        func testClockPositionDecodesWebValue() {
            XCTAssertEqual(KioskClockPosition(webValue: "top-left"), .topLeft)
            XCTAssertEqual(KioskClockPosition(webValue: "bottom-right"), .bottomRight)
            XCTAssertEqual(KioskClockPosition(webValue: "garbage"), .bottomRight) // default
            XCTAssertEqual(KioskClockPosition.allCases.count, 4)
        }

        // MARK: - Clock formatters (port of `useDateFormat`)

        func testFormatTimeIsLocaleAware() {
            let date = fixedDate()
            let twelveHour = KioskClock.formatTime(date, locale: enUS, timeZone: utc)
            XCTAssertTrue(twelveHour.contains(":"))
            XCTAssertTrue(twelveHour.contains("30"))
            XCTAssertTrue(twelveHour.uppercased().contains("PM"))

            let twentyFourHour = KioskClock.formatTime(date, locale: enGB, timeZone: utc)
            XCTAssertTrue(twentyFourHour.contains("14"))
            XCTAssertTrue(twentyFourHour.contains("30"))
            XCTAssertFalse(twentyFourHour.uppercased().contains("PM"))
        }

        func testFormatDateWithDayHasWeekdayMonthDay() {
            let date = fixedDate()
            let formatted = KioskClock.formatDateWithDay(date, locale: enUS, timeZone: utc)
            XCTAssertTrue(formatted.contains("Apr"))
            XCTAssertTrue(formatted.contains("4"))
            XCTAssertTrue(formatted.contains(expectedShortWeekday(for: date)))
        }

        // MARK: - Exit auto-hide timing (web `setTimeout(…, 3000)`)

        func testExitAutoHideDelayIsThreeSeconds() {
            XCTAssertEqual(KioskOverlayExit.autoHideDelay, .seconds(3))
        }

        // MARK: - Config defaults (web `DEFAULT_KIOSK_CONFIG`)

        func testConfigDefaultsMatchWeb() {
            let config = KioskOverlayConfig()
            XCTAssertEqual(config.dimLevel, 0.5, accuracy: 0.0001)
            XCTAssertTrue(config.showClock)
            XCTAssertEqual(config.clockPosition, .bottomRight)
            XCTAssertEqual(config.rotateInterval, 30, accuracy: 0.0001)
        }

        // MARK: - Equatable

        func testPresentationIsValueEquatable() {
            XCTAssertEqual(makePresentation(isDimmed: true), makePresentation(isDimmed: true))
            XCTAssertNotEqual(makePresentation(isDimmed: true), makePresentation(isDimmed: false))
        }

        // MARK: - i18n facade (P1/S10) — fallback wiring

        func testStringsFacadeReturnsFallbackWhenKeyMissing() {
            XCTAssertEqual(KioskOverlayStrings.table, "KioskOverlay")
            XCTAssertEqual(KioskOverlayStrings.string("kiosk.exit", "Exit kiosk mode"), "Exit kiosk mode")
            XCTAssertEqual(KioskOverlayStrings.string("kiosk.exitLabel", "Exit Kiosk"), "Exit Kiosk")
        }

        // MARK: - Telemetry (P1/S11 `view.opened`)

        func testSurfaceSlugIsStable() {
            XCTAssertEqual(KioskOverlaySurface.slug, "KioskOverlay")
            XCTAssertEqual(makePresentation().surfaceSlug, "KioskOverlay")
        }

        func testReportOpenEmitsViewOpenedWithSlug() {
            let sink = BufferedKioskOverlayTelemetry()
            KioskOverlaySurface.reportOpen(to: sink)
            XCTAssertEqual(sink.opened, ["KioskOverlay"])
        }

        // MARK: - Helpers

        private func makePresentation(
            dimLevel: Double = 0.5,
            showClock: Bool = true,
            clockPosition: KioskClockPosition = .bottomRight,
            rotateInterval: Double = 30,
            isDimmed: Bool = false,
            isCursorHidden: Bool = false,
            dashboardCount: Int = 3,
            currentIndex: Int = 0
        ) -> KioskOverlayPresentation {
            KioskOverlayPresentation(
                config: KioskOverlayConfig(
                    dimLevel: dimLevel,
                    showClock: showClock,
                    clockPosition: clockPosition,
                    rotateInterval: rotateInterval
                ),
                isDimmed: isDimmed,
                isCursorHidden: isCursorHidden,
                dashboardCount: dashboardCount,
                currentIndex: currentIndex
            )
        }

        /// 2026-04-04 14:30:00 UTC.
        private func fixedDate() -> Date {
            var components = DateComponents()
            components.year = 2026
            components.month = 4
            components.day = 4
            components.hour = 14
            components.minute = 30
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = utc
            return calendar.date(from: components)!
        }

        /// The locale's short weekday symbol for `date`, derived independently of the
        /// formatter under test so the assertion is not circular.
        private func expectedShortWeekday(for date: Date) -> String {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = utc
            let weekdayIndex = calendar.component(.weekday, from: date) - 1
            let symbols = DateFormatter()
            symbols.locale = enUS
            return symbols.shortWeekdaySymbols[weekdayIndex]
        }
    }

    // MARK: - Test doubles

    /// A thread-safe buffered diagnostics sink for asserting the `view.opened` slug.
    private final class BufferedKioskOverlayTelemetry: KioskOverlayTelemetry, @unchecked Sendable {
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
