//
//  AlertMessageEditor.Tests.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  Unit coverage for the AlertMessageEditor projection core (`AlertMessageEditorAdapter`) — value
//  parity with the web source's logic: the `{{Token}}` extraction regex, the autocomplete filter +
//  grouping (flat cursor index + insertion + a11y label), the cursor wrap math, the op-validity
//  preset gate, the tag list + filter, the `{{`-trigger detection, the insertion splice, the preview
//  request body, and the maxLength guard — plus the VoiceOver summary builders.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no bundle: the
//  adapter + accessibility builders are pure and driven directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum AlertFixture {
    static let tokens: [AlertMessageTokenDTO] = [
        AlertMessageTokenDTO(key: "BatteryLevel", label: "Battery level (%)", group: "Signals"),
        AlertMessageTokenDTO(key: "VehicleName", label: "Vehicle name", group: "Rule"),
        AlertMessageTokenDTO(key: "Severity", label: "Severity", group: "Rule")
    ]

    static let presets: [AlertMessagePresetDTO] = [
        AlertMessagePresetDTO(
            id: "batt",
            name: "Low battery",
            template: "{{VehicleName}} at {{BatteryLevel}}%",
            summary: "Warn on low pack",
            kind: .signal,
            tags: ["battery", "signal"]
        ),
        AlertMessagePresetDTO(
            id: "range",
            name: "Range window",
            template: "{{Min}}–{{Max}}",
            summary: nil,
            kind: .signal,
            tags: ["range"]
        )
    ]

    static let role = AlertMessageEditorCopy.fallback
}

// MARK: - Adapter: token extraction + autocomplete projection

@MainActor
final class AlertMessageEditorAdapterTests: XCTestCase {
    func testExtractTemplateKeysMatchesWebRegex() {
        XCTAssertEqual(
            AlertMessageEditorAdapter.extractTemplateKeys("{{BatteryLevel}} and {{ VehicleName }}"),
            ["BatteryLevel", "VehicleName"]
        )
        XCTAssertEqual(AlertMessageEditorAdapter.extractTemplateKeys("{{Good_1}}"), ["Good_1"])
        XCTAssertTrue(AlertMessageEditorAdapter.extractTemplateKeys("{{1Bad}}").isEmpty)
        XCTAssertTrue(AlertMessageEditorAdapter.extractTemplateKeys("no tokens here").isEmpty)
    }

    func testFilterTokensBlankReturnsAll() {
        XCTAssertEqual(AlertMessageEditorAdapter.filterTokens(AlertFixture.tokens, needle: "  ").count, 3)
    }

    func testFilterTokensMatchesKeyOrLabelCaseInsensitively() {
        let byKey = AlertMessageEditorAdapter.filterTokens(AlertFixture.tokens, needle: "battery")
        XCTAssertEqual(byKey.map(\.key), ["BatteryLevel"])
        let byLabel = AlertMessageEditorAdapter.filterTokens(AlertFixture.tokens, needle: "VEHICLE")
        XCTAssertEqual(byLabel.map(\.key), ["VehicleName"])
    }

    func testProjectTokensGroupsAndFlattensWithIndex() {
        let projection = AlertMessageEditorAdapter.projectTokens(AlertFixture.tokens, copy: AlertFixture.role)
        XCTAssertEqual(projection.groups.map(\.name), ["Signals", "Rule"])
        XCTAssertEqual(projection.flat.map(\.flatIndex), [0, 1, 2])
        let first = projection.flat[0]
        XCTAssertEqual(first.insertion, "{{BatteryLevel}}")
        XCTAssertEqual(first.accessibilityLabel, "\(AlertFixture.role.tokenRole): {{BatteryLevel}} Battery level (%)")
        XCTAssertEqual(projection.groups[1].tokens.map(\.key), ["VehicleName", "Severity"])
    }

    func testCursorWrapMath() {
        XCTAssertEqual(AlertMessageEditorAdapter.clampCursor(5, count: 3), 2)
        XCTAssertEqual(AlertMessageEditorAdapter.clampCursor(2, count: 0), 0)
        XCTAssertEqual(AlertMessageEditorAdapter.nextCursor(2, count: 3), 0)
        XCTAssertEqual(AlertMessageEditorAdapter.previousCursor(0, count: 3), 2)
        XCTAssertEqual(AlertMessageEditorAdapter.nextCursor(0, count: 0), 0)
    }
}

// MARK: - Adapter: preset gallery gating

@MainActor
final class AlertMessageEditorPresetTests: XCTestCase {
    func testAvailableKeys() {
        XCTAssertEqual(
            AlertMessageEditorAdapter.availableKeys(AlertFixture.tokens),
            Set(["BatteryLevel", "VehicleName", "Severity"])
        )
    }

    func testOpValidPresetsHidesUnsatisfiablePresets() {
        let keys = Set(["BatteryLevel", "VehicleName"])
        let valid = AlertMessageEditorAdapter.opValidPresets(
            AlertFixture.presets,
            availableKeys: keys,
            op: .lessThan,
            tokensLoading: false
        )
        XCTAssertEqual(valid.map(\.id), ["batt"])
    }

    func testOpValidPresetsDegradesWhileLoadingOrNoOp() {
        let keys = Set(["BatteryLevel"])
        XCTAssertEqual(
            AlertMessageEditorAdapter.opValidPresets(
                AlertFixture.presets,
                availableKeys: keys,
                op: .lessThan,
                tokensLoading: true
            ).count,
            2
        )
        XCTAssertEqual(
            AlertMessageEditorAdapter.opValidPresets(
                AlertFixture.presets,
                availableKeys: keys,
                op: nil,
                tokensLoading: false
            ).count,
            2
        )
        XCTAssertEqual(
            AlertMessageEditorAdapter.opValidPresets(
                AlertFixture.presets,
                availableKeys: [],
                op: .lessThan,
                tokensLoading: false
            ).count,
            2
        )
    }

    func testPresetTagsSortedUnique() {
        XCTAssertEqual(AlertMessageEditorAdapter.presetTags(AlertFixture.presets), ["battery", "range", "signal"])
    }

    func testResolveActiveTagDropsStale() {
        XCTAssertNil(AlertMessageEditorAdapter.resolveActiveTag("gone", in: ["a", "b"]))
        XCTAssertEqual(AlertMessageEditorAdapter.resolveActiveTag("a", in: ["a", "b"]), "a")
        XCTAssertNil(AlertMessageEditorAdapter.resolveActiveTag(nil, in: ["a"]))
    }

    func testFilterPresetsByTag() {
        XCTAssertEqual(
            AlertMessageEditorAdapter.filterPresets(AlertFixture.presets, activeTag: "range").map(\.id),
            ["range"]
        )
        XCTAssertEqual(AlertMessageEditorAdapter.filterPresets(AlertFixture.presets, activeTag: nil).count, 2)
    }

    func testProjectPresetsBuildsCardsWithA11y() {
        let cards = AlertMessageEditorAdapter.projectPresets(AlertFixture.presets, copy: AlertFixture.role)
        XCTAssertEqual(cards[0].accessibilityLabel, "\(AlertFixture.role.presetRole): Low battery. Warn on low pack")
        XCTAssertEqual(cards[1].accessibilityLabel, "\(AlertFixture.role.presetRole): Range window")
    }

    func testProjectGalleryEndToEndDropsStaleTagAndGates() {
        let gallery = AlertMessageEditorAdapter.projectGallery(
            presets: AlertFixture.presets,
            context: PresetGalleryContext(
                availableKeys: Set(["BatteryLevel", "VehicleName"]),
                op: .lessThan,
                tokensLoading: false
            ),
            activeTag: "range",
            copy: AlertFixture.role
        )
        XCTAssertEqual(gallery.tags, ["battery", "signal"])
        XCTAssertEqual(gallery.cards.map(\.id), ["batt"])
    }
}

// MARK: - Adapter: trigger detection, insertion, preview request, maxLength

@MainActor
final class AlertMessageEditorEditingAdapterTests: XCTestCase {
    func testDetectTriggerOpensOnUnclosedBraces() {
        let trigger = AlertMessageEditorAdapter.detectTrigger(text: "Battery {{Bat", caret: 13)
        XCTAssertEqual(trigger, TokenTrigger(index: 8, partial: "Bat"))
    }

    func testDetectTriggerUsesLastOpenBraces() {
        let trigger = AlertMessageEditorAdapter.detectTrigger(text: "{{Foo}} and {{Ba", caret: 16)
        XCTAssertEqual(trigger, TokenTrigger(index: 12, partial: "Ba"))
    }

    func testDetectTriggerBailsOnWhitespaceOrClosed() {
        XCTAssertNil(AlertMessageEditorAdapter.detectTrigger(text: "{{Bat level", caret: 11))
        XCTAssertNil(AlertMessageEditorAdapter.detectTrigger(text: "{{Foo}}", caret: 7))
        XCTAssertNil(AlertMessageEditorAdapter.detectTrigger(text: "no braces", caret: 9))
    }

    func testInsertTokenSplicesAndReturnsCaret() {
        let result = AlertMessageEditorAdapter.insertToken(
            into: "Battery at {{Bat",
            triggerIndex: 11,
            caret: 16,
            key: "BatteryLevel"
        )
        XCTAssertEqual(result.text, "Battery at {{BatteryLevel}}")
        XCTAssertEqual(result.caret, 27)
    }

    func testInsertTokenMidStringPreservesSuffix() {
        let result = AlertMessageEditorAdapter.insertToken(
            into: "{{Ba suffix",
            triggerIndex: 0,
            caret: 4,
            key: "BatteryLevel"
        )
        XCTAssertEqual(result.text, "{{BatteryLevel}} suffix")
        XCTAssertEqual(result.caret, 16)
    }

    func testBuildPreviewRequestNilsBlankTemplate() {
        let draft = AlertMessageDraft(kind: .signal, op: .lessThan)
        XCTAssertNil(AlertMessageEditorAdapter.buildPreviewRequest(draft: draft, template: "   ", includeTitle: true)
            .msgTemplate)
        let filled = AlertMessageEditorAdapter.buildPreviewRequest(
            draft: draft,
            template: "Hi {{X}}",
            includeTitle: false
        )
        XCTAssertEqual(filled.msgTemplate, "Hi {{X}}")
        XCTAssertFalse(filled.includeTitle)
    }

    func testClampToMaxLength() {
        let long = String(repeating: "a", count: AlertMessageEditorConfig.templateMaxLength + 50)
        XCTAssertEqual(
            AlertMessageEditorAdapter.clampToMaxLength(long).count,
            AlertMessageEditorConfig.templateMaxLength
        )
        XCTAssertEqual(AlertMessageEditorAdapter.clampToMaxLength("short"), "short")
    }
}

// MARK: - Accessibility summaries

@MainActor
final class AlertMessageEditorAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, value in value }

    func testTokenSummaryPerPhase() {
        XCTAssertTrue(token(.hidden).contains("two opening braces"))
        XCTAssertEqual(token(.loading), "Loading suggestions")
        XCTAssertEqual(token(.content, count: 4), "4 suggestions")
        XCTAssertEqual(token(.empty), "No matching suggestions")
    }

    func testPreviewSummaryPerPhase() {
        XCTAssertEqual(preview(.empty), "Start typing to see a preview")
        XCTAssertEqual(preview(.loading), "Rendering preview")
        XCTAssertEqual(preview(.content), "Notification preview")
        XCTAssertEqual(preview(.error("x")), "Preview failed")
    }

    func testPresetSummaryPerPhase() {
        XCTAssertEqual(preset(.loading), "Loading presets")
        XCTAssertEqual(preset(.content, count: 2), "2 presets")
        XCTAssertEqual(preset(.empty), "No presets match this filter")
        XCTAssertEqual(preset(.error("x")), "Couldn't load presets")
    }

    private func token(_ phase: TokenSuggestionsPhase, count: Int = 0) -> String {
        AlertMessageEditorAccessibility.tokenSummary(for: phase, count: count, localize: echo)
    }

    private func preview(_ phase: PreviewPhase) -> String {
        AlertMessageEditorAccessibility.previewSummary(for: phase, localize: echo)
    }

    private func preset(_ phase: PresetGalleryPhase, count: Int = 0) -> String {
        AlertMessageEditorAccessibility.presetSummary(for: phase, count: count, localize: echo)
    }
}
