//
//  InfoTile.Tests.swift
//  TeslaSync — P4 feature view · 0280 · InfoTile (Apple)
//
//  Unit coverage for the InfoTile surface: the value/color/accessibility projections
//  (the "adapter"), the `InfoTileModel` state holder (display projection, sub gating,
//  combined accessibility label + test id, and the P1/S11 `view.opened` telemetry), and
//  the i18n facade. These run in the TeslaSync(/-macOS) XCTest targets. They have no
//  network and no real store — the surface is purely presentational.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: value / color / accessibility projections

final class InfoTileAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    // Value display (web `typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value`)

    func testDisplayText() {
        XCTAssertEqual(InfoTileValue.text("85%").display(localize: echo), "85%")
        XCTAssertEqual(InfoTileValue.text("Not charging").display(localize: echo), "Not charging")
    }

    func testDisplayBoolean() {
        XCTAssertEqual(InfoTileValue.bool(true).display(localize: echo), "Yes")
        XCTAssertEqual(InfoTileValue.bool(false).display(localize: echo), "No")
    }

    func testDisplayNumber() {
        XCTAssertEqual(InfoTileValue.number(42).display(localize: echo), "42")
        XCTAssertEqual(InfoTileValue.number(42.5).display(localize: echo), "42.5")
    }

    func testEmptyTextRendersDash() {
        XCTAssertEqual(InfoTileValue.text("").display(localize: echo), "—")
        XCTAssertEqual(InfoTileValue.text("   ").display(localize: echo), "—")
        XCTAssertEqual(InfoTileValue.text("\n\t").display(localize: echo), "—")
    }

    func testIsEmpty() {
        XCTAssertTrue(InfoTileValue.text("").isEmpty)
        XCTAssertTrue(InfoTileValue.text("  ").isEmpty)
        XCTAssertFalse(InfoTileValue.text("x").isEmpty)
        XCTAssertFalse(InfoTileValue.number(0).isEmpty)
        XCTAssertFalse(InfoTileValue.bool(false).isEmpty)
    }

    // Number formatting (web `String(number)` — no grouping, whole numbers lose .0)

    func testNumberFormatting() {
        XCTAssertEqual(InfoTileValue.format(42), "42")
        XCTAssertEqual(InfoTileValue.format(0), "0")
        XCTAssertEqual(InfoTileValue.format(-7), "-7")
        XCTAssertEqual(InfoTileValue.format(1_000_000), "1000000")
        XCTAssertEqual(InfoTileValue.format(3.14), "3.14")
    }

    // Value tint → every case maps to a token (exhaustive, no dropped case)

    func testValueColorCoversEveryCase() {
        XCTAssertEqual(InfoTileValueColor.allCases.count, 7)
        for tint in InfoTileValueColor.allCases {
            // Accessing `.color` must resolve a token for every case (no crash, no gap).
            _ = tint.color
        }
        XCTAssertEqual(InfoTileValueColor.primary.rawValue, "primary")
        XCTAssertEqual(InfoTileValueColor.danger.rawValue, "danger")
    }

    // Accessibility label (combined, blank parts dropped)

    func testAccessibilityLabelCombinesParts() {
        XCTAssertEqual(
            InfoTileAccessibility.label(label: "Battery", value: "85%", sub: "320 km range"),
            "Battery, 85%, 320 km range"
        )
        XCTAssertEqual(InfoTileAccessibility.label(label: "Sentry", value: "Off", sub: nil), "Sentry, Off")
        XCTAssertEqual(InfoTileAccessibility.label(label: "Sentry", value: "Off", sub: ""), "Sentry, Off")
        XCTAssertEqual(InfoTileAccessibility.label(label: "", value: "85%", sub: nil), "85%")
    }

    // Test id slugify (native chrome)

    func testAccessibilityTestID() {
        XCTAssertEqual(InfoTileAccessibility.testID(label: "Battery"), "info-tile-battery")
        XCTAssertEqual(InfoTileAccessibility.testID(label: "Tire Pressure FL"), "info-tile-tire-pressure-fl")
        XCTAssertEqual(InfoTileAccessibility.testID(label: "Inside  Temp!!"), "info-tile-inside-temp")
        XCTAssertEqual(InfoTileAccessibility.testID(label: "123"), "info-tile-123")
        XCTAssertEqual(InfoTileAccessibility.testID(label: ""), "info-tile-value")
    }

    // i18n facade resolves the fallback (bundle-free → returns value)

    func testLocalizationFacadeReturnsFallback() {
        XCTAssertEqual(InfoTileStrings.string("infoTile.value.yes", "Yes"), "Yes")
        XCTAssertEqual(InfoTileStrings.string("infoTile.value.no", "No"), "No")
        XCTAssertEqual(InfoTileStrings.string("infoTile.value.empty", "—"), "—")
    }
}

// MARK: - State holder: projection + sub gating + accessibility + telemetry

@MainActor
final class InfoTileModelTests: XCTestCase {
    private func makeModel(
        systemImage: String = "battery.75percent",
        label: String = "Battery",
        value: InfoTileValue = .text("85%"),
        valueColor: InfoTileValueColor = .primary,
        sub: String? = nil,
        telemetry: any InfoTileTelemetry = OSLogInfoTileTelemetry()
    ) -> InfoTileModel {
        InfoTileModel(
            systemImage: systemImage,
            label: label,
            value: value,
            valueColor: valueColor,
            sub: sub,
            telemetry: telemetry
        )
    }

    func testDisplayValueUsesFacade() {
        XCTAssertEqual(makeModel(value: .bool(true)).displayValue, "Yes")
        XCTAssertEqual(makeModel(value: .bool(false)).displayValue, "No")
        XCTAssertEqual(makeModel(value: .text("")).displayValue, "—")
        XCTAssertEqual(makeModel(value: .number(48213)).displayValue, "48213")
    }

    func testHasSubGating() {
        XCTAssertFalse(makeModel(sub: nil).hasSub)
        XCTAssertFalse(makeModel(sub: "").hasSub)
        XCTAssertFalse(makeModel(sub: "  ").hasSub)
        XCTAssertTrue(makeModel(sub: "320 km range").hasSub)
    }

    func testAccessibilityLabelAndID() {
        let model = makeModel(label: "Battery", value: .text("85%"), sub: "320 km range")
        XCTAssertEqual(model.accessibilityLabel, "Battery, 85%, 320 km range")
        XCTAssertEqual(model.accessibilityID, "info-tile-battery")

        let noSub = makeModel(label: "Sentry", value: .bool(false), sub: nil)
        XCTAssertEqual(noSub.accessibilityLabel, "Sentry, No")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyInfoTileTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [InfoTileSurface.slug])
        XCTAssertEqual(InfoTileSurface.slug, "InfoTile")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyInfoTileTelemetry: InfoTileTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
