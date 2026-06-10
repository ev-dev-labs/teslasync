//
//  PresetGallery.Tests.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  Adapter + accessibility coverage for the AutomationPresetGallery surface:
//    • `AutomationPresetGalleryProjection` — phase resolution across loading / loaded / empty /
//      failed × item presence, the trigger-label map (each kind + the no-trigger
//      fallback), the "{{count}} actions" + "Install {{name}}" interpolations, and the
//      icon → SF Symbol map incl. the shield default.
//    • `AutomationTriggerKind` — wire parsing + the first-trigger projection.
//    • `AutomationPresetGalleryAccessibility` — the gallery summary + card VoiceOver content.
//
//  The state-holder coverage lives in PresetGallery.ModelTests.swift. Pure, bundle-free:
//  copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real
/// copy without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum PresetGallerySamplePresets {
    static func geofence() -> AutomationPresetItem {
        AutomationPresetItem(
            id: "sentry-on-leave",
            name: "Sentry on leave",
            summary: "Arm Sentry when you drive away from home.",
            iconKey: "Shield",
            triggers: [.geofence],
            actionCount: 2
        )
    }

    static func noTrigger() -> AutomationPresetItem {
        AutomationPresetItem(
            id: "blank",
            name: "Blank template",
            summary: "Start from scratch.",
            iconKey: "Unmapped",
            triggers: [],
            actionCount: 0
        )
    }
}

// MARK: - Adapter: projection (phase)

final class AutomationPresetGalleryPhaseTests: XCTestCase {
    func testLoadingResolvesByItemPresence() {
        XCTAssertEqual(
            AutomationPresetGalleryProjection.resolvePhase(status: .loading, itemCount: 0),
            .loading
        )
        XCTAssertEqual(
            AutomationPresetGalleryProjection.resolvePhase(status: .loading, itemCount: 3),
            .content
        )
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(
            AutomationPresetGalleryProjection.resolvePhase(status: .loaded, itemCount: 0),
            .empty
        )
        XCTAssertEqual(
            AutomationPresetGalleryProjection.resolvePhase(status: .loaded, itemCount: 4),
            .content
        )
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(
            AutomationPresetGalleryProjection.resolvePhase(status: .failed("boom"), itemCount: 0),
            .error("boom")
        )
        XCTAssertEqual(
            AutomationPresetGalleryProjection.resolvePhase(status: .failed("boom"), itemCount: 1),
            .content
        )
    }
}

// MARK: - Adapter: trigger labels + kind parsing

final class AutomationPresetGalleryTriggerTests: XCTestCase {
    func testTriggerLabelForEachKind() {
        let cases: [(AutomationTriggerKind, String)] = [
            (.schedule, "Schedule"),
            (.event, "Vehicle Event"),
            (.geofence, "Geofence"),
            (.signal, "Signal Threshold")
        ]
        for (kind, expected) in cases {
            XCTAssertEqual(
                AutomationPresetGalleryProjection.triggerLabel(for: kind, localize: passthroughLocalize),
                expected
            )
        }
    }

    func testTriggerLabelForNilIsNoTrigger() {
        XCTAssertEqual(
            AutomationPresetGalleryProjection.triggerLabel(for: nil, localize: passthroughLocalize),
            "No trigger configured"
        )
    }

    func testWireParsing() {
        XCTAssertEqual(AutomationTriggerKind(wire: "trigger_schedule"), .schedule)
        XCTAssertEqual(AutomationTriggerKind(wire: "trigger_event"), .event)
        XCTAssertEqual(AutomationTriggerKind(wire: "trigger_geofence"), .geofence)
        XCTAssertEqual(AutomationTriggerKind(wire: "trigger_signal"), .signal)
        XCTAssertNil(AutomationTriggerKind(wire: "trigger_unknown"))
    }

    func testFirstTriggerKindProjection() {
        XCTAssertEqual(PresetGallerySamplePresets.geofence().firstTriggerKind, .geofence)
        XCTAssertNil(PresetGallerySamplePresets.noTrigger().firstTriggerKind)
    }
}

// MARK: - Adapter: badge / install interpolation

final class AutomationPresetGalleryInterpolationTests: XCTestCase {
    func testActionCountLabelInterpolatesCount() {
        XCTAssertEqual(
            AutomationPresetGalleryProjection.actionCountLabel(count: 3, localize: passthroughLocalize),
            "3 actions"
        )
        XCTAssertEqual(
            AutomationPresetGalleryProjection.actionCountLabel(count: 0, localize: passthroughLocalize),
            "0 actions"
        )
    }

    func testInstallLabelInterpolatesName() {
        XCTAssertEqual(
            AutomationPresetGalleryProjection.installLabel(name: "Sentry on leave", localize: passthroughLocalize),
            "Install Sentry on leave"
        )
    }
}

// MARK: - Adapter: icon mapping (web `iconMap[…] ?? Shield`)

final class AutomationPresetGalleryIconTests: XCTestCase {
    func testKnownIconsMapToSymbols() {
        let cases: [(String, String)] = [
            ("Shield", "shield.fill"),
            ("Moon", "moon.fill"),
            ("Sun", "sun.max.fill"),
            ("ShieldCheck", "checkmark.shield.fill"),
            ("Lock", "lock.fill"),
            ("UserX", "person.fill.xmark"),
            ("CarFront", "car.fill"),
            ("Siren", "light.beacon.max.fill")
        ]
        for (key, expected) in cases {
            XCTAssertEqual(AutomationPresetGalleryProjection.symbolName(forIcon: key), expected)
        }
    }

    func testUnmappedIconFallsBackToShield() {
        XCTAssertEqual(AutomationPresetGalleryProjection.symbolName(forIcon: "Nope"), "shield.fill")
        XCTAssertEqual(PresetGallerySamplePresets.noTrigger().symbolName, "shield.fill")
    }
}

// MARK: - Accessibility

final class AutomationPresetGalleryAccessibilityTests: XCTestCase {
    func testGallerySummary() {
        let summary = AutomationPresetGalleryAccessibility.gallerySummary(count: 5, localize: passthroughLocalize)
        XCTAssertEqual(summary, "Automation presets: 5")
    }

    func testCardLabelIncludesNameTriggerAndActions() {
        let label = AutomationPresetGalleryAccessibility.cardLabel(
            PresetGallerySamplePresets.geofence(),
            localize: passthroughLocalize
        )
        XCTAssertTrue(label.contains("Sentry on leave"))
        XCTAssertTrue(label.contains("Geofence"))
        XCTAssertTrue(label.contains("2 actions"))
    }

    func testCardLabelUsesNoTriggerFallback() {
        let label = AutomationPresetGalleryAccessibility.cardLabel(
            PresetGallerySamplePresets.noTrigger(),
            localize: passthroughLocalize
        )
        XCTAssertTrue(label.contains("No trigger configured"))
        XCTAssertTrue(label.contains("0 actions"))
    }
}
