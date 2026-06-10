//
//  KioskSettingsModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  Adapter + projection + accessibility coverage for the KioskSettingsModal surface:
//    • `initialSelection` / `sanitizedSelection` — the saved-vs-all seed + the stale-id sanitize.
//    • `toggling` — add / remove with the keep-at-least-one rule (web `toggleDashboard`).
//    • `orderedIds` — the rotation selection projected back to display order.
//    • the four conditional reveals (rotation list / cursor timeout / dim brightness / clock position).
//    • the live-preview math — background alpha clamp, widget alpha (`0.03 + x*0.17`), blur (`4 + x*12`).
//    • the slider conversions — percent ↔ fraction + the bounds clamp.
//    • `phase` / `inlineFailure` — the loading / loaded-empty / failed envelopes + cached-reload error.
//    • `enterPayload` — the committed config carries the selection in display order.
//    • `KioskConfig.default` + the option catalogs — the web defaults + option-array parity.
//    • `KioskSettingsAccessibility` — the dialog / dashboard-row / enter VoiceOver content.
//
//  The state-holder coverage lives in KioskSettingsModal.ModelTests.swift. Pure, bundle-free: copy
//  resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum KioskSample {
    static func dashboards() -> [KioskDashboard] {
        [
            KioskDashboard(id: "a", name: "Alpha", isDefault: true),
            KioskDashboard(id: "b", name: "Bravo"),
            KioskDashboard(id: "c", name: "Charlie")
        ]
    }

    static func config(dashboardIds: [String] = []) -> KioskConfig {
        var config = KioskConfig.default
        config.dashboardIds = dashboardIds
        return config
    }
}

final class KioskSettingsProjectionTests: XCTestCase {
    // MARK: initialSelection / sanitizedSelection

    func testInitialSelectionUsesSavedIds() {
        let selection = KioskSettingsProjection.initialSelection(
            config: KioskSample.config(dashboardIds: ["b"]), dashboards: KioskSample.dashboards()
        )
        XCTAssertEqual(selection, ["b"])
    }

    func testInitialSelectionFallsBackToAllWhenEmpty() {
        let selection = KioskSettingsProjection.initialSelection(
            config: KioskSample.config(dashboardIds: []), dashboards: KioskSample.dashboards()
        )
        XCTAssertEqual(selection, ["a", "b", "c"])
    }

    func testInitialSelectionDropsStaleIdsThenFallsBackToAll() {
        let allStale = KioskSettingsProjection.initialSelection(
            config: KioskSample.config(dashboardIds: ["x"]), dashboards: KioskSample.dashboards()
        )
        XCTAssertEqual(allStale, ["a", "b", "c"])
        let mixed = KioskSettingsProjection.initialSelection(
            config: KioskSample.config(dashboardIds: ["b", "x"]), dashboards: KioskSample.dashboards()
        )
        XCTAssertEqual(mixed, ["b"])
    }

    func testSanitizedSelectionDropsVanishedIds() {
        let kept = KioskSettingsProjection.sanitizedSelection(["a", "x"], dashboards: KioskSample.dashboards())
        XCTAssertEqual(kept, ["a"])
    }

    func testSanitizedSelectionFallsBackToAllWhenNoneSurvive() {
        let kept = KioskSettingsProjection.sanitizedSelection(["x", "y"], dashboards: KioskSample.dashboards())
        XCTAssertEqual(kept, ["a", "b", "c"])
    }

    // MARK: toggling (keep-at-least-one)

    func testTogglingAddsUnselected() {
        XCTAssertEqual(KioskSettingsProjection.toggling(["a", "b"], id: "c"), ["a", "b", "c"])
    }

    func testTogglingRemovesSelectedWhenMoreThanOne() {
        XCTAssertEqual(KioskSettingsProjection.toggling(["a", "b", "c"], id: "b"), ["a", "c"])
    }

    func testTogglingKeepsLastSelected() {
        XCTAssertEqual(KioskSettingsProjection.toggling(["a"], id: "a"), ["a"])
    }

    func testOrderedIdsFollowsDashboardOrder() {
        let ids = KioskSettingsProjection.orderedIds(["c", "a"], dashboards: KioskSample.dashboards())
        XCTAssertEqual(ids, ["a", "c"])
    }

    // MARK: conditional reveals

    func testShowsRotationListMatrix() {
        XCTAssertTrue(KioskSettingsProjection.showsRotationList(rotateInterval: 30, dashboardCount: 3))
        XCTAssertFalse(KioskSettingsProjection.showsRotationList(rotateInterval: 0, dashboardCount: 3))
        XCTAssertFalse(KioskSettingsProjection.showsRotationList(rotateInterval: 30, dashboardCount: 1))
        XCTAssertFalse(KioskSettingsProjection.showsRotationList(rotateInterval: 0, dashboardCount: 1))
    }

    func testShowsSecondaryControls() {
        XCTAssertTrue(KioskSettingsProjection.showsCursorTimeout(hideCursor: true))
        XCTAssertFalse(KioskSettingsProjection.showsCursorTimeout(hideCursor: false))
        XCTAssertTrue(KioskSettingsProjection.showsDimBrightness(dimAfter: 10))
        XCTAssertFalse(KioskSettingsProjection.showsDimBrightness(dimAfter: 0))
        XCTAssertTrue(KioskSettingsProjection.showsClockPosition(showClock: true))
        XCTAssertFalse(KioskSettingsProjection.showsClockPosition(showClock: false))
    }

    // MARK: preview math

    func testBackgroundSwatchOpacityClamps() {
        XCTAssertEqual(KioskSettingsProjection.backgroundSwatchOpacity(0.7), 0.7, accuracy: 0.0001)
        XCTAssertEqual(KioskSettingsProjection.backgroundSwatchOpacity(1.5), 1.0, accuracy: 0.0001)
        XCTAssertEqual(KioskSettingsProjection.backgroundSwatchOpacity(-0.2), 0.0, accuracy: 0.0001)
    }

    func testWidgetSwatchOpacityAndBlur() {
        XCTAssertEqual(KioskSettingsProjection.widgetSwatchOpacity(1.0), 0.20, accuracy: 0.0001)
        XCTAssertEqual(KioskSettingsProjection.widgetSwatchOpacity(0.5), 0.115, accuracy: 0.0001)
        XCTAssertEqual(KioskSettingsProjection.widgetSwatchOpacity(1.5), 0.20, accuracy: 0.0001)
        XCTAssertEqual(KioskSettingsProjection.widgetSwatchBlur(0.0), 4.0, accuracy: 0.0001)
        XCTAssertEqual(KioskSettingsProjection.widgetSwatchBlur(0.5), 10.0, accuracy: 0.0001)
        XCTAssertEqual(KioskSettingsProjection.widgetSwatchBlur(1.0), 16.0, accuracy: 0.0001)
    }

    // MARK: slider conversions

    func testPercentFractionRoundTrip() {
        XCTAssertEqual(KioskSettingsProjection.percent(fromFraction: 0.85), 85)
        XCTAssertEqual(KioskSettingsProjection.percent(fromFraction: 1.0), 100)
        XCTAssertEqual(KioskSettingsProjection.percent(fromFraction: 0.0), 0)
        XCTAssertEqual(KioskSettingsProjection.fraction(fromPercent: 85), 0.85, accuracy: 0.0001)
    }

    func testClampedPercentRespectsBounds() {
        XCTAssertEqual(KioskSettingsProjection.clampedPercent(120, in: KioskCatalog.widgetOpacityBounds), 100)
        XCTAssertEqual(KioskSettingsProjection.clampedPercent(10, in: KioskCatalog.widgetOpacityBounds), 30)
        XCTAssertEqual(KioskSettingsProjection.clampedPercent(0, in: KioskCatalog.backgroundOpacityBounds), 0)
        XCTAssertEqual(KioskSettingsProjection.clampedPercent(40, in: KioskCatalog.brightnessBounds), 40)
    }

    // MARK: phase + inlineFailure

    func testPhaseMatrix() {
        XCTAssertEqual(KioskSettingsProjection.phase(status: .loading, hasDashboards: false), .loading)
        XCTAssertEqual(KioskSettingsProjection.phase(status: .loading, hasDashboards: true), .populated)
        XCTAssertEqual(KioskSettingsProjection.phase(status: .loaded, hasDashboards: false), .empty)
        XCTAssertEqual(KioskSettingsProjection.phase(status: .loaded, hasDashboards: true), .populated)
        XCTAssertEqual(KioskSettingsProjection.phase(status: .failed("x"), hasDashboards: false), .error("x"))
        XCTAssertEqual(KioskSettingsProjection.phase(status: .failed("x"), hasDashboards: true), .populated)
    }

    func testInlineFailure() {
        XCTAssertEqual(KioskSettingsProjection.inlineFailure(status: .failed("boom"), hasDashboards: true), "boom")
        XCTAssertNil(KioskSettingsProjection.inlineFailure(status: .failed("boom"), hasDashboards: false))
        XCTAssertNil(KioskSettingsProjection.inlineFailure(status: .loaded, hasDashboards: true))
    }

    // MARK: enterPayload

    func testEnterPayloadCarriesSelectionInOrder() {
        let payload = KioskSettingsProjection.enterPayload(
            config: KioskSample.config(dashboardIds: ["a"]),
            selection: ["c", "a"],
            dashboards: KioskSample.dashboards()
        )
        XCTAssertEqual(payload.dashboardIds, ["a", "c"])
    }

    // MARK: catalogs + defaults

    func testDefaultConfigMatchesWeb() {
        let config = KioskConfig.default
        XCTAssertEqual(config.rotateInterval, 30)
        XCTAssertTrue(config.hideCursor)
        XCTAssertEqual(config.cursorTimeout, 5)
        XCTAssertEqual(config.dimAfter, 0)
        XCTAssertEqual(config.dimLevel, 0.5, accuracy: 0.0001)
        XCTAssertTrue(config.showClock)
        XCTAssertEqual(config.clockPosition, .bottomRight)
        XCTAssertEqual(config.widgetOpacity, 1.0, accuracy: 0.0001)
        XCTAssertEqual(config.backgroundOpacity, 1.0, accuracy: 0.0001)
    }

    func testOptionCatalogsMatchWeb() {
        XCTAssertEqual(KioskCatalog.rotationOptions.map(\.value), [0, 10, 15, 30, 60, 120, 300])
        XCTAssertEqual(KioskCatalog.cursorTimeoutOptions.map(\.value), [3, 5, 10, 15])
        XCTAssertEqual(KioskCatalog.dimAfterOptions.map(\.value), [0, 5, 10, 15, 30, 60])
        XCTAssertEqual(KioskClockPosition.allCases.map(\.rawValue), [
            "top-left", "top-right", "bottom-left", "bottom-right"
        ])
        XCTAssertEqual(KioskCatalog.widgetOpacityBounds.step, 5)
        XCTAssertEqual(KioskCatalog.backgroundOpacityBounds.min, 0)
        XCTAssertEqual(KioskCatalog.brightnessBounds.max, 90)
    }
}

final class KioskSettingsAccessibilityTests: XCTestCase {
    func testDialogLabel() {
        XCTAssertEqual(
            KioskSettingsAccessibility.dialogLabel(localize: passthroughLocalize), "Kiosk Settings"
        )
    }

    func testDashboardRowLabelSelectedDefault() {
        let label = KioskSettingsAccessibility.dashboardRowLabel(
            name: "Alpha", selected: true, isDefault: true, localize: passthroughLocalize
        )
        XCTAssertEqual(label, "Alpha, Selected, Default")
    }

    func testDashboardRowLabelUnselectedNonDefault() {
        let label = KioskSettingsAccessibility.dashboardRowLabel(
            name: "Bravo", selected: false, isDefault: false, localize: passthroughLocalize
        )
        XCTAssertEqual(label, "Bravo, Not selected")
    }

    func testEnterLabel() {
        XCTAssertEqual(
            KioskSettingsAccessibility.enterLabel(localize: passthroughLocalize), "Enter Kiosk Mode"
        )
    }
}
