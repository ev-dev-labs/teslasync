//
//  AlertMessageEditor.Editing.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The editing behaviour for `AlertMessageEditorModel` (kept in an extension so the @Observable type
//  body stays focused): the controlled template / include-title forwarding, the `{{`-trigger
//  autocomplete (open / filter / cursor / insert / close), the preset gallery (open / tag filter /
//  apply), the debounced live preview, the freshness-driven refresh, and the resolved render phases.
//  Pure orchestration over `AlertMessageEditorAdapter`; no networking lives here.
//

import Foundation
import SwiftUI

// MARK: - View-facing copy + bindings

public extension AlertMessageEditorModel {
    /// The field label (web `label ?? t('…messageTemplateLabel')`).
    var labelText: String {
        labelOverride ?? AlertMessageEditorStrings.string(
            "alertEditor.messageTemplateLabel",
            "Message Template"
        )
    }

    /// The field help copy (web `helpContent ?? t('…messageTemplateHelp')`).
    var helpText: String {
        helpOverride ?? AlertMessageEditorStrings.string(
            "alertEditor.messageTemplateHelp",
            "Per-rule body template. Reference live signals with double-brace tokens like " +
                "{{BatteryLevel}}. Leave blank to use the op-aware default body."
        )
    }

    /// The spoken status of the token autocomplete area.
    var tokenAccessibilitySummary: String {
        AlertMessageEditorAccessibility.tokenSummary(
            for: tokenPhase,
            count: tokenProjection.flat.count,
            localize: AlertMessageEditorStrings.localize
        )
    }

    /// The spoken status of the live-preview panel.
    var previewAccessibilitySummary: String {
        AlertMessageEditorAccessibility.previewSummary(
            for: previewPhase,
            localize: AlertMessageEditorStrings.localize
        )
    }

    /// The spoken status of the preset gallery.
    var presetAccessibilitySummary: String {
        AlertMessageEditorAccessibility.presetSummary(
            for: presetPhase,
            count: galleryProjection.cards.count,
            localize: AlertMessageEditorStrings.localize
        )
    }

    /// A `Binding` over `includeTitle` the SwiftUI toggle writes through `setIncludeTitle`.
    var includeTitleBinding: Binding<Bool> {
        Binding(get: { [weak self] in self?.includeTitle ?? true }, set: { [weak self] in self?.setIncludeTitle($0) })
    }

    /// A `Binding` over the preset gallery presentation the SwiftUI sheet writes through.
    var presetModalBinding: Binding<Bool> {
        Binding(
            get: { [weak self] in self?.isPresetModalOpen ?? false },
            set: { [weak self] open in open ? self?.openPresetGallery() : self?.closePresetGallery() }
        )
    }
}

// MARK: - Template editing + include-title

public extension AlertMessageEditorModel {
    /// Handles a template edit at the given caret (web `handleTextareaChange`): enforces the 1024-char
    /// cap, forwards the parent `onTemplateChange`, re-evaluates the `{{` trigger (cursor reset to the
    /// top, web `setAutocompleteCursor(0)`), and re-schedules the debounced preview.
    func setTemplate(_ newText: String, caret newCaret: Int) {
        let clamped = AlertMessageEditorAdapter.clampToMaxLength(newText)
        template = clamped
        caret = min(max(newCaret, 0), clamped.count)
        onTemplateChange(clamped)
        evaluateTrigger(resetCursor: true)
        schedulePreview()
    }

    /// Handles a caret move without a text edit (web caret tracking): re-evaluates the `{{` trigger,
    /// keeping the highlighted cursor so keyboard navigation is preserved.
    func updateCaret(_ offset: Int) {
        caret = min(max(offset, 0), template.count)
        evaluateTrigger(resetCursor: false)
    }

    /// Toggles include-title (web `onIncludeTitleChange`) and re-renders the preview.
    func setIncludeTitle(_ newValue: Bool) {
        includeTitle = newValue
        onIncludeTitleChange(newValue)
        schedulePreview()
    }

    private func evaluateTrigger(resetCursor: Bool) {
        if let trigger = AlertMessageEditorAdapter.detectTrigger(text: template, caret: caret) {
            if resetCursor { autocompleteCursor = 0 }
            isAutocompleteOpen = true
            triggerIndex = trigger.index
            autocompleteFilter = trigger.partial
        } else {
            resetAutocompleteState()
        }
        recompute()
    }
}

// MARK: - Autocomplete navigation + insertion

public extension AlertMessageEditorModel {
    /// Web `ArrowDown`: advance the highlighted suggestion (wrapping).
    func moveCursorDown() {
        guard isAutocompleteOpen else { return }
        autocompleteCursor = AlertMessageEditorAdapter.nextCursor(autocompleteCursor, count: tokenProjection.flat.count)
    }

    /// Web `ArrowUp`: retreat the highlighted suggestion (wrapping).
    func moveCursorUp() {
        guard isAutocompleteOpen else { return }
        autocompleteCursor = AlertMessageEditorAdapter.previousCursor(
            autocompleteCursor,
            count: tokenProjection.flat.count
        )
    }

    /// Web `Enter` / `Tab`: insert the highlighted suggestion.
    func insertHighlightedToken() {
        guard isAutocompleteOpen else { return }
        let flat = tokenProjection.flat
        guard !flat.isEmpty else { return }
        let index = min(max(autocompleteCursor, 0), flat.count - 1)
        insertToken(flat[index])
    }

    /// Web option click: splice `{{key}}` over the trigger window, restore the caret, close the menu,
    /// and re-render the preview.
    func insertToken(_ suggestion: TokenSuggestion) {
        guard let triggerIndex else { return }
        let result = AlertMessageEditorAdapter.insertToken(
            into: template,
            triggerIndex: triggerIndex,
            caret: caret,
            key: suggestion.key
        )
        template = result.text
        caret = result.caret
        onTemplateChange(result.text)
        closeAutocomplete()
        requestCaret(result.caret)
        schedulePreview()
    }

    /// Web `Escape`: dismiss the autocomplete menu.
    func closeAutocomplete() {
        resetAutocompleteState()
        recompute()
    }

    private func resetAutocompleteState() {
        isAutocompleteOpen = false
        triggerIndex = nil
        autocompleteFilter = ""
        autocompleteCursor = 0
    }
}

// MARK: - Preset gallery

public extension AlertMessageEditorModel {
    /// Web "Pick a preset": open the preset gallery.
    func openPresetGallery() {
        isPresetModalOpen = true
    }

    /// Dismiss the preset gallery.
    func closePresetGallery() {
        isPresetModalOpen = false
    }

    /// Web tag chip: filter the gallery (`nil` is "All").
    func setActiveTag(_ tag: String?) {
        activeTag = tag
        recompute()
    }

    /// Web `applyPreset`: adopt the preset template, close the modal, restore the caret to the end,
    /// and re-render the preview.
    func applyPreset(_ card: PresetCardModel) {
        applyPresetTemplate(card.template)
    }

    /// Adopts a raw preset template (web `onTemplateChange(preset.template)`).
    func applyPresetTemplate(_ presetTemplate: String) {
        let clamped = AlertMessageEditorAdapter.clampToMaxLength(presetTemplate)
        template = clamped
        caret = clamped.count
        onTemplateChange(clamped)
        isPresetModalOpen = false
        closeAutocomplete()
        requestCaret(clamped.count)
        schedulePreview()
    }
}

// MARK: - Preview scheduling, caret requests, draft updates, refresh

public extension AlertMessageEditorModel {
    /// Re-runs the current catalog loads (error-state retry / stale auto-refresh).
    func refresh() {
        source.refresh()
    }

    /// Adopts a new rule draft (web `draft` prop change): reloads the catalogs + re-renders.
    func updateDraft(_ newDraft: AlertMessageDraft) {
        draft = newDraft
        reloadCatalogs()
        recompute()
        schedulePreview()
    }

    /// The view applies the requested caret to its `TextSelection` then calls this to clear it.
    func consumeCaretRequest() {
        caretRequest = nil
    }

    internal func requestCaret(_ offset: Int) {
        caretRequest = offset
        caretRequestVersion &+= 1
    }

    /// Debounced live preview (web 150 ms `setTimeout` → `previewMut.mutate`).
    internal func schedulePreview() {
        previewTask?.cancel()
        let request = AlertMessageEditorAdapter.buildPreviewRequest(
            draft: draft,
            template: template,
            includeTitle: includeTitle
        )
        guard previewDebounce > 0 else {
            source.renderPreview(request)
            return
        }
        previewTask = Task { [weak self, previewDebounce] in
            try? await Task.sleep(for: .seconds(previewDebounce))
            guard !Task.isCancelled else { return }
            self?.source.renderPreview(request)
        }
    }
}

// MARK: - Phase resolution

extension AlertMessageEditorModel {
    /// Re-derives every area's projection + render phase from the latest snapshot + editor state.
    func recompute() {
        let filtered = AlertMessageEditorAdapter.filterTokens(latestTokens, needle: autocompleteFilter)
        tokenProjection = AlertMessageEditorAdapter.projectTokens(filtered, copy: copy)
        autocompleteCursor = AlertMessageEditorAdapter.clampCursor(
            autocompleteCursor,
            count: tokenProjection.flat.count
        )
        tokenPhase = resolveTokenPhase()

        galleryProjection = AlertMessageEditorAdapter.projectGallery(
            presets: latestPresets,
            context: PresetGalleryContext(
                availableKeys: AlertMessageEditorAdapter.availableKeys(latestTokens),
                op: draft.op,
                tokensLoading: latestTokensStatus.isLoading
            ),
            activeTag: activeTag,
            copy: copy
        )
        activeTag = AlertMessageEditorAdapter.resolveActiveTag(activeTag, in: galleryProjection.tags)
        presetPhase = resolvePresetPhase()

        previewPhase = resolvePreviewPhase()
    }

    private func resolveTokenPhase() -> TokenSuggestionsPhase {
        guard isAutocompleteOpen else { return .hidden }
        switch latestTokensStatus {
        case .idle, .loading:
            return tokenProjection.hasSuggestions ? .content : .loading
        case .failed, .loaded:
            return tokenProjection.hasSuggestions ? .content : .empty
        }
    }

    private func resolvePresetPhase() -> PresetGalleryPhase {
        switch latestPresetsStatus {
        case .idle, .loading:
            galleryProjection.hasCards ? .content : .loading
        case let .failed(message):
            galleryProjection.hasCards ? .content : .error(message)
        case .loaded:
            galleryProjection.hasCards ? .content : .empty
        }
    }

    private func resolvePreviewPhase() -> PreviewPhase {
        if case let .failed(message) = latestPreviewStatus { return .error(message) }
        if case .loading = latestPreviewStatus, preview == nil { return .loading }
        return preview == nil ? .empty : .content
    }
}
