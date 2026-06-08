import XCTest
@testable import TeslaSync

/// Unit coverage for the `ToolCard` feature view. `ToolCard` is a pure
/// presentational container (the web source fetches nothing), so the meaningful,
/// host-free surface area is: the `color` → tint adapter (incl. the `cyan`
/// fallback), the per-configuration presentation projection, the accessibility
/// policy, and the `view.opened` telemetry slug. These mirror the web
/// `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan` branch and the card's
/// composition. No rendering / no KMP runtime required.
@MainActor final class ToolCardTests: XCTestCase {
    // MARK: - Tint adapter (web color string → native projection)

    func testTintMapsEveryKnownWebColor() {
        XCTAssertEqual(ToolCardTint(web: "cyan"), .cyan)
        XCTAssertEqual(ToolCardTint(web: "green"), .green)
        XCTAssertEqual(ToolCardTint(web: "purple"), .purple)
        XCTAssertEqual(ToolCardTint(web: "amber"), .amber)
        XCTAssertEqual(ToolCardTint(web: "red"), .red)
    }

    func testTintCoversExactlyTheWebColorMapKeys() {
        // Parity guard: the native case set must equal the web ICON_COLOR_MAP keys.
        XCTAssertEqual(ToolCardTint.allCases.map(\.rawValue), ["cyan", "green", "purple", "amber", "red"])
    }

    func testTintFallsBackToCyanForUnknownOrEmpty() {
        XCTAssertEqual(ToolCardTint(web: "chartreuse"), .cyan)
        XCTAssertEqual(ToolCardTint(web: ""), .cyan)
        XCTAssertEqual(ToolCardTint(web: "  "), .cyan)
        XCTAssertEqual(ToolCardTint.fallback, .cyan)
    }

    func testTintInitIsCaseInsensitive() {
        XCTAssertEqual(ToolCardTint(web: "CYAN"), .cyan)
        XCTAssertEqual(ToolCardTint(web: "Amber"), .amber)
    }

    func testTintChipOpacitiesMatchWebScale() {
        // web: bg-{color}/10  +  ring-{color}/20
        XCTAssertEqual(ToolCardTint.backgroundOpacity, 0.10, accuracy: 0.0001)
        XCTAssertEqual(ToolCardTint.borderOpacity, 0.20, accuracy: 0.0001)
    }

    func testTintChipColorsDeriveFromAccent() {
        for tint in ToolCardTint.allCases {
            XCTAssertEqual(tint.iconBackground, tint.accent.opacity(ToolCardTint.backgroundOpacity))
            XCTAssertEqual(tint.iconBorder, tint.accent.opacity(ToolCardTint.borderOpacity))
        }
    }

    // MARK: - Presentation projection (per-configuration "snapshot")

    func testPresentationShowsDescriptionFlag() {
        let withDescription = ToolCardPresentation(iconSystemName: "key", tint: .cyan, hasDescription: true)
        let withoutDescription = ToolCardPresentation(iconSystemName: "key", tint: .cyan, hasDescription: false)
        XCTAssertTrue(withDescription.showsDescription)
        XCTAssertFalse(withoutDescription.showsDescription)
    }

    func testPresentationCarriesIconAndTint() {
        let presentation = ToolCardPresentation(iconSystemName: "globe", tint: .purple, hasDescription: true)
        XCTAssertEqual(presentation.iconSystemName, "globe")
        XCTAssertEqual(presentation.tint, .purple)
    }

    func testPresentationMakeResolvesWebInputs() {
        let known = ToolCardPresentation.make(iconSystemName: "shield", colorName: "red", hasDescription: true)
        XCTAssertEqual(known.tint, .red)
        XCTAssertTrue(known.showsDescription)

        let unknown = ToolCardPresentation.make(iconSystemName: "shield", colorName: "nope", hasDescription: false)
        XCTAssertEqual(unknown.tint, .cyan) // fallback parity
        XCTAssertFalse(unknown.showsDescription)
    }

    // MARK: - Accessibility policy (no snapshot library in this repo)

    func testAccessibilityPolicyHidesIconAndCombinesHeader() {
        for tint in ToolCardTint.allCases {
            let presentation = ToolCardPresentation(iconSystemName: "bolt", tint: tint, hasDescription: true)
            XCTAssertTrue(presentation.iconIsDecorative, "icon chip must be hidden from VoiceOver")
            XCTAssertTrue(presentation.combinesHeaderForVoiceOver, "title + description must read as one element")
        }
    }

    func testPresentationSurfaceSlugIsStable() {
        let presentation = ToolCardPresentation(iconSystemName: "key", tint: .green, hasDescription: false)
        XCTAssertEqual(presentation.surfaceSlug, "ToolCard")
        XCTAssertEqual(presentation.surfaceSlug, ToolCardSurface.slug)
    }

    // MARK: - Telemetry (P1/S11 view.opened)

    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyToolCardTelemetry()
        ToolCardSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["ToolCard"])
    }

    func testReportOpenIsTheExactSlugContract() {
        let spy = SpyToolCardTelemetry()
        ToolCardSurface.reportOpen(to: spy)
        ToolCardSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["ToolCard", "ToolCard"])
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyToolCardTelemetry: ToolCardTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
