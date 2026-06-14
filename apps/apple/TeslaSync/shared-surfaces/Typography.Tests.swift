//
//  Typography.Tests.swift
//  TeslaSync — P4 shared surface · 0232 · Typography (Apple)
//
//  The state-holder + view-composition + facade + SwiftUI-bridge half of the coverage (the pure projection
//  + value types live in Typography.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • TypographyContent — the blank-text detection that drives the native empty leaf.
//    • TypographyModel — the once-only `view.opened`, the content store, and the change-guarded update.
//    • Views — the public surface, the heading peer, the convenience factories, and the subviews compose in
//      every real branch.
//    • Bridges — each resolved descriptor maps onto the matching SwiftUI primitive (Dynamic-Type text style,
//      weight, design, tracking token) with no fallback.
//    • Strings — the a11y copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - TypographyContent (blank detection)

final class TypographyContentTests: XCTestCase {
    private func content(_ text: String) -> TypographyContent {
        TypographyContent(text: text, style: TypographyProjector.style(for: .body))
    }

    func testBlankDetection() {
        XCTAssertTrue(content("").isBlank)
        XCTAssertTrue(content("   \n\t").isBlank)
        XCTAssertFalse(content("142.6 kWh").isBlank)
    }
}

// MARK: - TypographyModel (render state + once-only telemetry)

@MainActor
final class TypographyModelTests: XCTestCase {
    private func model(
        _ text: String = "Body",
        role: TypographyRole = .body,
        telemetry: TypographyTelemetry = OSLogTypographyTelemetry()
    ) -> TypographyModel {
        let content = TypographyContent(text: text, style: TypographyProjector.style(for: role))
        return TypographyModel(content: content, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [TypographySurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [TypographySurface.slug], "view.opened fires once per instance")
    }

    func testInitStoresContent() {
        let holder = model("142.6", role: .metricValue)
        XCTAssertEqual(holder.content.text, "142.6")
        XCTAssertEqual(holder.content.style, TypographyProjector.style(for: .metricValue))
    }

    func testUpdateReplacesChangedContentAndIgnoresEqual() {
        let holder = model("Body", role: .body)
        let next = TypographyContent(text: "Caption", style: TypographyProjector.style(for: .caption))
        holder.update(next)
        XCTAssertEqual(holder.content, next)
        holder.update(next)
        XCTAssertEqual(holder.content, next, "an equal update is a no-op")
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class TypographyViewTests: XCTestCase {
    func testComposesForEveryRole() {
        for role in TypographyRole.allCases {
            _ = Typography("Specimen", role: role)
        }
    }

    func testComposesForGranularCompositions() {
        _ = Typography("Plain")
        _ = Typography("Big", size: .threeXl, weight: .bold, color: .primary)
        _ = Typography("Dim", size: .sm, color: .disabled)
        _ = Typography("Mono", mono: true)
    }

    func testComposesEmptyLeafForBlankText() {
        _ = Typography("", role: .body)
        _ = Typography("   ", role: .pageTitle)
        _ = TypographyEmptyLeaf()
        _ = TypographyStyledText(content: TypographyContent(
            text: "",
            style: TypographyProjector.style(for: .body)
        ))
    }

    func testComposesFromInjectedModel() {
        let injected = TypographyModel(
            content: TypographyContent(text: "Body", style: TypographyProjector.style(for: .body)),
            telemetry: SpyTelemetry()
        )
        _ = Typography(model: injected)
        XCTAssertEqual(Typography.surfaceSlug, "Typography")
    }

    func testComposesEveryHeadingLevel() {
        for level in TypographyHeadingLevel.allCases {
            _ = TypographyHeading("Heading", level: level)
        }
    }

    func testComposesEveryConvenienceFactory() {
        _ = Typography.pageTitle("Page")
        _ = Typography.sectionTitle("Section")
        _ = Typography.panelTitle("Panel")
        _ = Typography.subhead("Sub")
        _ = Typography.caption("Caption")
        _ = Typography.helperText("Helper")
        _ = Typography.errorText("Error")
        _ = Typography.label("Label")
        _ = Typography.metricValue("42")
        _ = Typography.metricLabel("kWh")
        _ = Typography.code("vehicle_id")
    }
}

// MARK: - Bridges (resolved descriptor → SwiftUI primitive)

final class TypographyBridgeTests: XCTestCase {
    func testTextStyleBridgeMapsEveryCaseToTheSameNamedStyle() {
        let pairs: [(TypographyTextStyle, Font.TextStyle)] = [
            (.caption2, .caption2), (.caption, .caption), (.footnote, .footnote),
            (.subheadline, .subheadline), (.callout, .callout), (.body, .body),
            (.headline, .headline), (.title3, .title3), (.title2, .title2),
            (.title, .title), (.largeTitle, .largeTitle)
        ]
        XCTAssertEqual(pairs.count, TypographyTextStyle.allCases.count)
        for (token, expected) in pairs {
            XCTAssertEqual(token.swiftUI, expected)
        }
    }

    func testWeightBridge() {
        XCTAssertEqual(TypographyWeight.regular.swiftUI, .regular)
        XCTAssertEqual(TypographyWeight.medium.swiftUI, .medium)
        XCTAssertEqual(TypographyWeight.semibold.swiftUI, .semibold)
        XCTAssertEqual(TypographyWeight.bold.swiftUI, .bold)
    }

    func testDesignBridge() {
        XCTAssertEqual(TypographyDesign.standard.swiftUI, .default)
        XCTAssertEqual(TypographyDesign.monospaced.swiftUI, .monospaced)
    }

    func testTrackingBridgeResolvesToTypeMetricTokens() {
        XCTAssertEqual(TypographyTracking.display.points, TSTypeMetrics.displayTracking, accuracy: 0.0001)
        XCTAssertEqual(TypographyTracking.title.points, TSTypeMetrics.titleTracking, accuracy: 0.0001)
        XCTAssertEqual(TypographyTracking.section.points, TSTypeMetrics.sectionTracking, accuracy: 0.0001)
        XCTAssertEqual(TypographyTracking.panel.points, TSTypeMetrics.panelTracking, accuracy: 0.0001)
        XCTAssertEqual(TypographyTracking.body.points, TSTypeMetrics.bodyTracking, accuracy: 0.0001)
        XCTAssertEqual(TypographyTracking.bodySm.points, TSTypeMetrics.bodySmTracking, accuracy: 0.0001)
        XCTAssertEqual(TypographyTracking.caption.points, TSTypeMetrics.captionTracking, accuracy: 0.0001)
        XCTAssertEqual(TypographyTracking.label.points, TSTypeMetrics.labelTracking, accuracy: 0.0001)
    }

    func testColourTokenBridgeResolvesEveryCase() {
        XCTAssertEqual(TypographyColorToken.allCases.count, 7)
        XCTAssertEqual(TypographyColorToken.primary.swiftUI, Color.TS.textPrimary)
        XCTAssertEqual(TypographyColorToken.secondary.swiftUI, Color.TS.textSecondary)
        XCTAssertEqual(TypographyColorToken.muted.swiftUI, Color.TS.textMuted)
        XCTAssertEqual(TypographyColorToken.inverse.swiftUI, Color.TS.bg)
        XCTAssertEqual(TypographyColorToken.danger.swiftUI, Color.TS.statusDanger)
        for token in [TypographyColorToken.subtle, .disabled] {
            _ = token.swiftUI
        }
    }

    func testStyleResolvesAFontForEveryRole() {
        for role in TypographyRole.allCases {
            _ = TypographyProjector.style(for: role).font
        }
    }

    func testHeadingLevelAccessibilityRankBridge() {
        XCTAssertEqual(TypographyHeadingLevel.page.accessibilityHeadingLevel, .h1)
        XCTAssertEqual(TypographyHeadingLevel.section.accessibilityHeadingLevel, .h2)
        XCTAssertEqual(TypographyHeadingLevel.panel.accessibilityHeadingLevel, .h3)
        XCTAssertEqual(TypographyHeadingLevel.sub.accessibilityHeadingLevel, .h4)
    }
}

// MARK: - Strings facade (P1/S10)

final class TypographyStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(TypographyStrings.emptyTitle, "Nothing to display")
        XCTAssertEqual(TypographyStrings.emptyMessage, "Text appears here when it becomes available.")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: TypographyTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
