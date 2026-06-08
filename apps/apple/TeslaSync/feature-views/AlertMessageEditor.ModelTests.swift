//
//  AlertMessageEditor.ModelTests.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  Unit coverage for the `AlertMessageEditorModel` state holder: the `view.opened` telemetry, the
//  catalog loads (honouring the disabled gate), the parent `onTemplateChange` / `onIncludeTitleChange`
//  forwarding, the `{{`-trigger autocomplete open / filter / cursor / insert / close, the preset
//  gallery open / tag filter / apply, the debounced preview, the per-area render phases, and the
//  stale auto-refresh / offline wiring.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryAlertMessageEditorSource`.
//

import XCTest
@testable import TeslaSync

@MainActor final class AlertMessageEditorModelTests: XCTestCase {
    private func tokens() -> [AlertMessageTokenDTO] {
        [
            AlertMessageTokenDTO(key: "BatteryLevel", label: "Battery level (%)", group: "Signals"),
            AlertMessageTokenDTO(key: "VehicleName", label: "Vehicle name", group: "Rule")
        ]
    }

    private func presets() -> [AlertMessagePresetDTO] {
        [
            AlertMessagePresetDTO(id: "a", name: "Battery", template: "{{BatteryLevel}}", kind: .signal, tags: ["b"]),
            AlertMessagePresetDTO(id: "c", name: "Vehicle", template: "{{VehicleName}}", kind: .signal, tags: ["r"])
        ]
    }

    private func loaded(
        preview: AlertMessagePreviewResultDTO? = AlertMessagePreviewResultDTO(title: "T", body: "B"),
        connection: AlertMessageConnection = .live
    ) -> AlertMessageEditorUpdate {
        AlertMessageEditorUpdate(
            tokensStatus: .loaded,
            tokens: tokens(),
            presetsStatus: .loaded,
            presets: presets(),
            previewStatus: preview == nil ? .idle : .loaded,
            preview: preview,
            connection: connection,
            updatedAt: Date()
        )
    }

    private func makeModel(
        template: String = "",
        includeTitle: Bool = true,
        draft: AlertMessageDraft = AlertMessageDraft(kind: .signal, op: .lessThan),
        disabled: Bool = false,
        initial: AlertMessageEditorUpdate? = nil,
        telemetry: AlertMessageEditorTelemetry = OSLogAlertMessageEditorTelemetry(),
        previewDebounce: TimeInterval = 0,
        onTemplateChange: @escaping @MainActor (String) -> Void = { _ in },
        onIncludeTitleChange: @escaping @MainActor (Bool) -> Void = { _ in }
    ) -> (AlertMessageEditorModel, InMemoryAlertMessageEditorSource) {
        let source = InMemoryAlertMessageEditorSource(initial: initial)
        let model = AlertMessageEditorModel(
            source: source,
            template: template,
            includeTitle: includeTitle,
            draft: draft,
            disabled: disabled,
            telemetry: telemetry,
            copy: .fallback,
            previewDebounce: previewDebounce,
            onTemplateChange: onTemplateChange,
            onIncludeTitleChange: onIncludeTitleChange
        )
        return (model, source)
    }

    // MARK: Lifecycle

    func testStartEmitsViewOpenedOnceLoadsCatalogsAndPreviews() {
        let spy = SpyAlertTelemetry()
        let (model, source) = makeModel(initial: loaded(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AlertMessageEditor.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.tokenLoads.count, 1)
        XCTAssertEqual(source.presetLoads, [AlertRuleKind.signal.rawValue])
        XCTAssertEqual(source.previewRequests.count, 1)
    }

    func testStartHonorsDisabledForTokenLoad() {
        let (model, source) = makeModel(disabled: true, initial: loaded())
        model.start()
        XCTAssertTrue(source.tokenLoads.isEmpty)
        XCTAssertEqual(source.presetLoads.count, 1)
    }

    // MARK: Template editing + autocomplete

    func testSetTemplateForwardsChangeAndClamps() {
        var changes: [String] = []
        let (model, _) = makeModel(initial: loaded(), onTemplateChange: { changes.append($0) })
        model.start()
        model.setTemplate("Battery low", caret: 11)
        XCTAssertEqual(model.template, "Battery low")
        XCTAssertEqual(changes.last, "Battery low")
        let long = String(repeating: "x", count: AlertMessageEditorConfig.templateMaxLength + 10)
        model.setTemplate(long, caret: long.count)
        XCTAssertEqual(model.template.count, AlertMessageEditorConfig.templateMaxLength)
    }

    func testSetTemplateOpensAutocompleteOnTrigger() {
        let (model, _) = makeModel(initial: loaded())
        model.start()
        model.setTemplate("Battery at {{Bat", caret: 16)
        XCTAssertTrue(model.isAutocompleteOpen)
        XCTAssertEqual(model.tokenProjection.flat.map(\.key), ["BatteryLevel"])
        XCTAssertEqual(model.tokenPhase, .content)
    }

    func testUpdateCaretClosesAutocompleteWhenTriggerGone() {
        let (model, _) = makeModel(initial: loaded())
        model.start()
        model.setTemplate("{{Bat", caret: 5)
        XCTAssertTrue(model.isAutocompleteOpen)
        model.setTemplate("plain text", caret: 10)
        XCTAssertFalse(model.isAutocompleteOpen)
        XCTAssertEqual(model.tokenPhase, .hidden)
    }

    func testMoveCursorWraps() {
        let (model, _) = makeModel(initial: loaded())
        model.start()
        model.setTemplate("{{", caret: 2)
        XCTAssertEqual(model.tokenProjection.flat.count, 2)
        XCTAssertEqual(model.autocompleteCursor, 0)
        model.moveCursorUp()
        XCTAssertEqual(model.autocompleteCursor, 1)
        model.moveCursorDown()
        XCTAssertEqual(model.autocompleteCursor, 0)
    }

    func testInsertHighlightedTokenSplicesClosesAndRequestsCaret() {
        var changes: [String] = []
        let (model, _) = makeModel(initial: loaded(), onTemplateChange: { changes.append($0) })
        model.start()
        model.setTemplate("Battery at {{Bat", caret: 16)
        model.insertHighlightedToken()
        XCTAssertEqual(model.template, "Battery at {{BatteryLevel}}")
        XCTAssertFalse(model.isAutocompleteOpen)
        XCTAssertEqual(model.caretRequest, 27)
        XCTAssertEqual(changes.last, "Battery at {{BatteryLevel}}")
    }

    func testCloseAutocompleteDismisses() {
        let (model, _) = makeModel(initial: loaded())
        model.start()
        model.setTemplate("{{Bat", caret: 5)
        model.closeAutocomplete()
        XCTAssertFalse(model.isAutocompleteOpen)
        XCTAssertEqual(model.tokenPhase, .hidden)
    }

    // MARK: Include-title + preset gallery

    func testSetIncludeTitleForwardsAndPreviews() {
        var toggles: [Bool] = []
        let (model, source) = makeModel(initial: loaded(), onIncludeTitleChange: { toggles.append($0) })
        model.start()
        let before = source.previewRequests.count
        model.setIncludeTitle(false)
        XCTAssertFalse(model.includeTitle)
        XCTAssertEqual(toggles, [false])
        XCTAssertEqual(source.previewRequests.count, before + 1)
        XCTAssertEqual(source.previewRequests.last?.includeTitle, false)
    }

    func testPresetGalleryOpenCloseAndTagFilter() {
        let (model, _) = makeModel(initial: loaded())
        model.start()
        model.openPresetGallery()
        XCTAssertTrue(model.isPresetModalOpen)
        XCTAssertEqual(model.galleryProjection.cards.count, 2)
        model.setActiveTag("r")
        XCTAssertEqual(model.galleryProjection.cards.map(\.id), ["c"])
        model.closePresetGallery()
        XCTAssertFalse(model.isPresetModalOpen)
    }

    func testApplyPresetAdoptsTemplateClosesAndForwards() {
        var changes: [String] = []
        let (model, _) = makeModel(initial: loaded(), onTemplateChange: { changes.append($0) })
        model.start()
        model.openPresetGallery()
        let card = model.galleryProjection.cards[0]
        model.applyPreset(card)
        XCTAssertEqual(model.template, card.template)
        XCTAssertFalse(model.isPresetModalOpen)
        XCTAssertEqual(changes.last, card.template)
        XCTAssertEqual(model.caretRequest, card.template.count)
    }

    // MARK: Phases from snapshots

    func testPreviewPhasesFromSnapshots() {
        let (model, source) = makeModel(initial: AlertMessageEditorUpdate(previewStatus: .idle))
        model.start()
        XCTAssertEqual(model.previewPhase, .empty)
        source.push(AlertMessageEditorUpdate(previewStatus: .loading))
        XCTAssertEqual(model.previewPhase, .loading)
        source.push(AlertMessageEditorUpdate(previewStatus: .loaded, preview: .init(title: "T", body: "B")))
        XCTAssertEqual(model.previewPhase, .content)
        source.push(AlertMessageEditorUpdate(previewStatus: .failed("boom")))
        XCTAssertEqual(model.previewPhase, .error("boom"))
    }

    func testTokenPhasesWhenAutocompleteOpen() {
        let (model, source) = makeModel(initial: AlertMessageEditorUpdate(tokensStatus: .loading))
        model.start()
        model.setTemplate("{{", caret: 2)
        XCTAssertEqual(model.tokenPhase, .loading)
        source.push(AlertMessageEditorUpdate(tokensStatus: .loaded, tokens: tokens()))
        XCTAssertEqual(model.tokenPhase, .content)
        source.push(AlertMessageEditorUpdate(tokensStatus: .loaded, tokens: []))
        XCTAssertEqual(model.tokenPhase, .empty)
    }

    func testPresetPhasesFromSnapshots() {
        let (model, source) = makeModel(initial: AlertMessageEditorUpdate(presetsStatus: .loading))
        model.start()
        XCTAssertEqual(model.presetPhase, .loading)
        source.push(AlertMessageEditorUpdate(presetsStatus: .loaded, presets: presets()))
        XCTAssertEqual(model.presetPhase, .content)
        source.push(AlertMessageEditorUpdate(presetsStatus: .loaded, presets: []))
        XCTAssertEqual(model.presetPhase, .empty)
        source.push(AlertMessageEditorUpdate(presetsStatus: .failed("nope"), presets: []))
        XCTAssertEqual(model.presetPhase, .error("nope"))
    }

    // MARK: Freshness wiring

    func testStaleAutoRefreshesOnceUntilLive() {
        let (model, source) = makeModel(initial: loaded(connection: .live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(connection: .live))
        source.push(loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        source.push(loaded(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.previewPhase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testUpdateDraftReloadsCatalogsAndPreviews() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        let tokenLoadsBefore = source.tokenLoads.count
        model.updateDraft(AlertMessageDraft(kind: .computedMetric, op: .greaterThan, metricID: "m1"))
        XCTAssertEqual(source.tokenLoads.count, tokenLoadsBefore + 1)
        XCTAssertEqual(source.presetLoads.last, AlertRuleKind.computedMetric.rawValue)
        XCTAssertEqual(source.previewRequests.last?.draft.metricID, "m1")
    }

    func testPreviewDebounceCoalescesToLast() async {
        let (model, source) = makeModel(previewDebounce: 0.05)
        model.setTemplate("a {{X}}", caret: 7)
        model.setTemplate("ab {{X}}", caret: 8)
        model.setTemplate("abc {{X}}", caret: 9)
        XCTAssertTrue(source.previewRequests.isEmpty)
        try? await Task.sleep(for: .seconds(0.25))
        XCTAssertEqual(source.previewRequests.count, 1)
        XCTAssertEqual(source.previewRequests.last?.msgTemplate, "abc {{X}}")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAlertTelemetry: AlertMessageEditorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
