//
//  ToggleCommandTile.Tests.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  Adapter-projection coverage for the ToggleCommandTile surface (the pure, dependency-
//  free core): variant→tone, definition state-binding + on/off symbol swap, the
//  command-parameters value, the on/off power label (web `commands.on` / `commands.off`),
//  the active-tone styling rule, the last-status outcome parse (web
//  `lastStatus.startsWith('✓')`), the render phase, the freshness chip, the VoiceOver
//  builders (web `aria-label`), and the i18n facade. The `ToggleCommandTileModel` state
//  holder is covered in ToggleCommandTile.ModelTests.swift.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: definition + status → projection

@MainActor final class ToggleCommandTileAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    // Variant → tone (web `onStyles[variant]`)

    func testVariantToneMapping() {
        XCTAssertEqual(ToggleCommandTileVariant.default.tone, .accent)
        XCTAssertEqual(ToggleCommandTileVariant.danger.tone, .danger)
        XCTAssertEqual(ToggleCommandTileVariant.success.tone, .success)
    }

    // Definition projection

    func testDefStateBinding() {
        let bound = ToggleCommandTileDef(
            id: "lock",
            command: "lock",
            commandOff: "unlock",
            labelKey: "k",
            labelFallback: "Lock",
            systemImageOn: "lock.fill",
            stateField: "is_locked"
        )
        XCTAssertTrue(bound.hasStateBinding)

        let unbound = ToggleCommandTileDef(id: "v", command: "v", labelKey: "k", labelFallback: "V", systemImageOn: "x")
        XCTAssertFalse(unbound.hasStateBinding)

        let blankField = ToggleCommandTileDef(
            id: "b",
            command: "b",
            labelKey: "k",
            labelFallback: "B",
            systemImageOn: "x",
            stateField: ""
        )
        XCTAssertFalse(blankField.hasStateBinding)
    }

    func testDefSystemImageSwapsWhenOff() {
        let withOff = ToggleCommandTileDef(
            id: "v",
            command: "v",
            labelKey: "k",
            labelFallback: "V",
            systemImageOn: "person.fill.checkmark",
            systemImageOff: "person.fill.xmark"
        )
        XCTAssertEqual(withOff.systemImage(isOn: true), "person.fill.checkmark")
        XCTAssertEqual(withOff.systemImage(isOn: false), "person.fill.xmark")

        let noOff = ToggleCommandTileDef(
            id: "s",
            command: "s",
            labelKey: "k",
            labelFallback: "S",
            systemImageOn: "bolt"
        )
        XCTAssertEqual(noOff.systemImage(isOn: true), "bolt")
        XCTAssertEqual(noOff.systemImage(isOn: false), "bolt") // falls back to the on symbol
    }

    // Command parameters value

    func testCommandParametersEqualityAndEmptiness() {
        XCTAssertTrue(ToggleCommandParameters().isEmpty)
        XCTAssertFalse(ToggleCommandParameters(["on": .bool(true)]).isEmpty)
        XCTAssertEqual(ToggleCommandParameters(["on": .bool(true)]), ToggleCommandParameters(["on": .bool(true)]))
        XCTAssertNotEqual(ToggleCommandParameters(["on": .bool(true)]), ToggleCommandParameters(["on": .bool(false)]))
    }

    // Power label (web `commands.on` / `commands.off`)

    func testPowerLabelKeysAndFallbacks() {
        XCTAssertEqual(ToggleCommandPower.from(isOn: true), .on)
        XCTAssertEqual(ToggleCommandPower.from(isOn: false), .off)
        XCTAssertEqual(ToggleCommandPower.on.labelKey, "commands.on")
        XCTAssertEqual(ToggleCommandPower.on.labelFallback, "ON")
        XCTAssertEqual(ToggleCommandPower.off.labelKey, "commands.off")
        XCTAssertEqual(ToggleCommandPower.off.labelFallback, "OFF")
    }

    // Active-tone style (web `isOn ? onStyles[variant] : neutral`)

    func testActiveToneOnlyWhenOn() {
        XCTAssertEqual(ToggleCommandTileStyle.activeTone(isOn: true, variant: .success), .success)
        XCTAssertEqual(ToggleCommandTileStyle.activeTone(isOn: true, variant: .danger), .danger)
        XCTAssertNil(ToggleCommandTileStyle.activeTone(isOn: false, variant: .danger))
    }

    // Last-status outcome (web `lastStatus.startsWith('✓')`)

    func testOutcomeParseNilForBlank() {
        XCTAssertNil(ToggleCommandOutcome.parse(nil))
        XCTAssertNil(ToggleCommandOutcome.parse(""))
        XCTAssertNil(ToggleCommandOutcome.parse("   "))
    }

    func testOutcomeParseSuccessMarker() {
        XCTAssertEqual(ToggleCommandOutcome.parse("✓ Locked"), .succeeded(detail: "Locked"))
        XCTAssertEqual(ToggleCommandOutcome.parse("  ✓ On  "), .succeeded(detail: "On"))
        XCTAssertEqual(ToggleCommandOutcome.parse("✓"), .succeeded(detail: nil))
    }

    func testOutcomeParseFailure() {
        XCTAssertEqual(ToggleCommandOutcome.parse("Command failed"), .failed(detail: "Command failed"))
        XCTAssertEqual(ToggleCommandOutcome.parse("✗ Boom"), .failed(detail: "Boom"))
    }

    func testOutcomeToneAndSymbol() {
        XCTAssertEqual(ToggleCommandOutcome.succeeded(detail: nil).tone, .success)
        XCTAssertEqual(ToggleCommandOutcome.failed(detail: nil).tone, .danger)
        XCTAssertEqual(ToggleCommandOutcome.succeeded(detail: nil).systemImage, "checkmark.circle.fill")
        XCTAssertEqual(ToggleCommandOutcome.failed(detail: nil).systemImage, "exclamationmark.circle.fill")
        XCTAssertEqual(ToggleCommandOutcome.failed(detail: "x").detail, "x")
    }

    // Render phase (web `loading` + `lastStatus`)

    func testPhaseProjection() {
        XCTAssertEqual(ToggleCommandTilePhase.project(isExecuting: true, outcome: nil), .executing)
        XCTAssertEqual(
            ToggleCommandTilePhase.project(isExecuting: true, outcome: .succeeded(detail: nil)),
            .executing
        )
        XCTAssertEqual(
            ToggleCommandTilePhase.project(isExecuting: false, outcome: .failed(detail: "x")),
            .result(.failed(detail: "x"))
        )
        XCTAssertEqual(ToggleCommandTilePhase.project(isExecuting: false, outcome: nil), .idle)
    }

    // Freshness chip (native live-state chrome)

    func testConnectionChipMapsEveryState() {
        XCTAssertNil(ToggleCommandConnectionChip.project(.live))
        XCTAssertEqual(ToggleCommandConnectionChip.project(.stale)?.tone, .warning)
        XCTAssertEqual(ToggleCommandConnectionChip.project(.stale)?.labelKey, "commands.tile.freshness.stale")
        XCTAssertEqual(ToggleCommandConnectionChip.project(.offline)?.tone, .neutral)
        XCTAssertEqual(ToggleCommandConnectionChip.project(.offline)?.labelKey, "commands.tile.freshness.offline")
    }

    // Accessibility builders (web `aria-label`, power value, hints, testid)

    func testAccessibilityFavoriteAndPowerValue() {
        XCTAssertEqual(ToggleCommandTileAccessibility.favoriteLabel(localize: echo), "Toggle favorite")
        XCTAssertEqual(ToggleCommandTileAccessibility.powerValue(isOn: true, localize: echo), "On")
        XCTAssertEqual(ToggleCommandTileAccessibility.powerValue(isOn: false, localize: echo), "Off")
    }

    func testAccessibilityActivationHint() {
        XCTAssertEqual(
            ToggleCommandTileAccessibility.activationHint(isOn: true, requiresInput: false, localize: echo),
            "Turns the command off"
        )
        XCTAssertEqual(
            ToggleCommandTileAccessibility.activationHint(isOn: false, requiresInput: true, localize: echo),
            "Opens options before turning on"
        )
        XCTAssertEqual(
            ToggleCommandTileAccessibility.activationHint(isOn: false, requiresInput: false, localize: echo),
            "Turns the command on"
        )
    }

    func testAccessibilityTestIDs() {
        XCTAssertEqual(ToggleCommandTileAccessibility.testID(commandID: "lock"), "toggle-command-tile-lock")
        XCTAssertEqual(
            ToggleCommandTileAccessibility.favoriteTestID(commandID: "lock"),
            "toggle-command-tile-favorite-lock"
        )
    }

    // i18n facade resolves the verbatim source keys (bundle-free → returns value)

    func testLocalizationFacadeReturnsFallback() {
        XCTAssertEqual(ToggleCommandTileStrings.string("commands.toggleFavorite", "Toggle favorite"), "Toggle favorite")
        XCTAssertEqual(ToggleCommandTileStrings.string("commands.on", "ON"), "ON")
        XCTAssertEqual(ToggleCommandTileStrings.string("commands.off", "OFF"), "OFF")
    }
}
