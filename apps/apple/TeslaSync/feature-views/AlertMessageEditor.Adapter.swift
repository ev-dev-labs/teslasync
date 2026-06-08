//
//  AlertMessageEditor.Adapter.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The testable projection core for the message-template editor — the faithful port of
//  features/notifications/components/AlertMessageEditor.tsx. Reproduces the component's logic
//  VERBATIM: the `{{Token}}` extraction regex (`substituteRe` parity), the autocomplete filter +
//  grouping, the op-validity preset gate, the tag list + filter, the `{{`-trigger detection + the
//  insertion splice, and the preview-request body. Foundation-only so it is unit-tested without a
//  bundle or a rendered view.
//

import Foundation

/// The dependency-free projection from the three helper catalogs + the editor's controlled inputs to
/// the rendered suggestion list, preset gallery, autocomplete trigger, and preview request. Every
/// value uses the same shape + precedence as the web component so the surfaces resolve identically.
public enum AlertMessageEditorAdapter {
    // MARK: - Template token extraction (web template-token regex / extractTemplateKeys)

    /// The token keys referenced by a template, in order — the parity of the web
    /// `extractTemplateKeys` (regex `\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}`). Used by the op-validity
    /// preset gate so a preset is hidden when it references a value the current op does not populate.
    public static func extractTemplateKeys(_ template: String) -> [String] {
        let pattern = "\\{\\{\\s*([A-Za-z][A-Za-z0-9_]*)\\s*\\}\\}"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let text = template as NSString
        let matches = regex.matches(in: template, range: NSRange(location: 0, length: text.length))
        return matches.compactMap { match in
            let range = match.range(at: 1)
            guard range.location != NSNotFound else { return nil }
            return text.substring(with: range)
        }
    }

    // MARK: - Autocomplete filter + grouping (web filtered token list + grouped buckets)

    /// Filters the token catalog by the typed needle — case-insensitively over key OR label (web
    /// filtered token list). A blank needle returns the whole catalog.
    public static func filterTokens(
        _ all: [AlertMessageTokenDTO],
        needle rawNeedle: String
    ) -> [AlertMessageTokenDTO] {
        let needle = rawNeedle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return all }
        return all.filter { $0.key.lowercased().contains(needle) || $0.label.lowercased().contains(needle) }
    }

    /// Projects the filtered catalog into the display groups + the flattened cursor sequence (web
    /// `grouped` buckets with the flat `index` keyboard navigation tracks).
    public static func projectTokens(
        _ filtered: [AlertMessageTokenDTO],
        copy: AlertMessageEditorCopy
    ) -> TokenSuggestionProjection {
        var flat: [TokenSuggestion] = []
        var order: [String] = []
        var buckets: [String: [TokenSuggestion]] = [:]
        for (index, token) in filtered.enumerated() {
            let suggestion = TokenSuggestion(
                id: token.key,
                key: token.key,
                label: token.label,
                insertion: "{{\(token.key)}}",
                flatIndex: index,
                accessibilityLabel: "\(copy.tokenRole): {{\(token.key)}} \(token.label)"
            )
            flat.append(suggestion)
            if buckets[token.group] == nil { order.append(token.group) }
            buckets[token.group, default: []].append(suggestion)
        }
        let groups = order.map { TokenSuggestionGroup(name: $0, tokens: buckets[$0] ?? []) }
        return TokenSuggestionProjection(groups: groups, flat: flat)
    }

    /// Re-clamps the highlighted cursor when the filtered list shrinks (web re-clamp effect).
    public static func clampCursor(_ cursor: Int, count: Int) -> Int {
        count == 0 ? 0 : min(max(cursor, 0), count - 1)
    }

    /// Web `ArrowDown`: advance the cursor, wrapping (no-op when empty).
    public static func nextCursor(_ cursor: Int, count: Int) -> Int {
        count > 0 ? (cursor + 1) % count : 0
    }

    /// Web `ArrowUp`: retreat the cursor, wrapping (no-op when empty).
    public static func previousCursor(_ cursor: Int, count: Int) -> Int {
        count > 0 ? (cursor - 1 + count) % count : 0
    }

    // MARK: - Preset gallery (web availableKeys / opValidPresets / presetTags / filteredPresets)

    /// The set of token keys the current rule's op populates (web `availableKeys`).
    public static func availableKeys(_ tokens: [AlertMessageTokenDTO]) -> Set<String> {
        Set(tokens.map(\.key))
    }

    /// Hides presets that reference a token the current op does not populate (web `opValidPresets`).
    /// Degrades to the full catalog while the token query is loading, the catalog is empty, or the
    /// rule has no op yet — better to over-show for one frame than flash an empty gallery.
    public static func opValidPresets(
        _ all: [AlertMessagePresetDTO],
        availableKeys: Set<String>,
        op: AlertRuleOp?,
        tokensLoading: Bool
    ) -> [AlertMessagePresetDTO] {
        if tokensLoading || availableKeys.isEmpty || op == nil { return all }
        return all.filter { preset in
            extractTemplateKeys(preset.template).allSatisfy { availableKeys.contains($0) }
        }
    }

    /// The sorted, de-duplicated tag chips across the op-valid presets (web `presetTags`).
    public static func presetTags(_ presets: [AlertMessagePresetDTO]) -> [String] {
        var tags = Set<String>()
        for preset in presets {
            for tag in preset.tags {
                tags.insert(tag)
            }
        }
        return tags.sorted()
    }

    /// Drops a stale active tag when the gallery no longer offers it (web reset-to-"All" effect).
    public static func resolveActiveTag(_ activeTag: String?, in tags: [String]) -> String? {
        guard let activeTag else { return nil }
        return tags.contains(activeTag) ? activeTag : nil
    }

    /// Applies the active tag filter (web `filteredPresets`); `nil` is the web "All".
    public static func filterPresets(
        _ presets: [AlertMessagePresetDTO],
        activeTag: String?
    ) -> [AlertMessagePresetDTO] {
        guard let activeTag else { return presets }
        return presets.filter { $0.tags.contains(activeTag) }
    }

    /// Projects presets into renderable cards with VoiceOver labels.
    public static func projectPresets(
        _ presets: [AlertMessagePresetDTO],
        copy: AlertMessageEditorCopy
    ) -> [PresetCardModel] {
        presets.map { preset in
            PresetCardModel(
                id: preset.id,
                name: preset.name,
                template: preset.template,
                summary: preset.summary,
                tags: preset.tags,
                accessibilityLabel: presetAccessibilityLabel(preset, role: copy.presetRole)
            )
        }
    }

    /// The full gallery projection: op-valid → tags → active-tag filter → cards.
    public static func projectGallery(
        presets all: [AlertMessagePresetDTO],
        context: PresetGalleryContext,
        activeTag: String?,
        copy: AlertMessageEditorCopy
    ) -> PresetGalleryProjection {
        let valid = opValidPresets(
            all,
            availableKeys: context.availableKeys,
            op: context.op,
            tokensLoading: context.tokensLoading
        )
        let tags = presetTags(valid)
        let resolved = resolveActiveTag(activeTag, in: tags)
        let cards = projectPresets(filterPresets(valid, activeTag: resolved), copy: copy)
        return PresetGalleryProjection(tags: tags, cards: cards)
    }

    private static func presetAccessibilityLabel(_ preset: AlertMessagePresetDTO, role: String) -> String {
        if let summary = preset.summary, !summary.isEmpty {
            return "\(role): \(preset.name). \(summary)"
        }
        return "\(role): \(preset.name)"
    }

    // MARK: - Autocomplete trigger + insertion (web handleTextareaChange / token insertion)

    /// Walks back from the caret for an un-closed `{{` and reports the trigger window (web
    /// `handleTextareaChange`). Returns `nil` — closing the menu — when there is no open `{{` before
    /// the caret or the partial token contains whitespace (the user is typing something else).
    public static func detectTrigger(text: String, caret: Int) -> TokenTrigger? {
        let chars = Array(text)
        let safeCaret = min(max(caret, 0), chars.count)
        let upTo = Array(chars[0 ..< safeCaret])
        guard let openIdx = lastIndexOfPair(upTo, "{") else { return nil }
        let closeIdx = lastIndexOfPair(upTo, "}") ?? -1
        guard openIdx > closeIdx else { return nil }
        let partial = String(upTo[(openIdx + 2)...])
        if partial.rangeOfCharacter(from: .whitespacesAndNewlines) != nil { return nil }
        return TokenTrigger(index: openIdx, partial: partial)
    }

    /// Splices `{{key}}` over the trigger window (web token-insertion splice): the text before the
    /// trigger + the canonical token + the text from the caret onward, and the restored caret offset.
    public static func insertToken(
        into template: String,
        triggerIndex: Int,
        caret: Int,
        key: String
    ) -> TokenInsertion {
        let chars = Array(template)
        let trigger = min(max(triggerIndex, 0), chars.count)
        let safeCaret = min(max(caret, trigger), chars.count)
        let before = String(chars[0 ..< trigger])
        let after = String(chars[safeCaret...])
        let insertion = "{{\(key)}}"
        return TokenInsertion(text: before + insertion + after, caret: before.count + insertion.count)
    }

    /// The last index `i` where `chars[i]` and `chars[i+1]` both equal `pair` (web `lastIndexOf`).
    private static func lastIndexOfPair(_ chars: [Character], _ pair: Character) -> Int? {
        guard chars.count >= 2 else { return nil }
        var index = chars.count - 2
        while index >= 0 {
            if chars[index] == pair, chars[index + 1] == pair { return index }
            index -= 1
        }
        return nil
    }

    // MARK: - Preview request (web message-preview body) + maxLength guard

    /// Builds the preview-request body from the draft + template + include-title toggle (web
    /// `AlertMessagePreviewRequest`). `msgTemplate` is `nil` when the field is blank (web `null`).
    public static func buildPreviewRequest(
        draft: AlertMessageDraft,
        template: String,
        includeTitle: Bool
    ) -> AlertMessagePreviewRequestDTO {
        let blank = template.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return AlertMessagePreviewRequestDTO(
            draft: draft,
            msgTemplate: blank ? nil : template,
            includeTitle: includeTitle
        )
    }

    /// Enforces the web `maxLength={1024}` cap on the template body.
    public static func clampToMaxLength(_ text: String) -> String {
        text.count > AlertMessageEditorConfig.templateMaxLength
            ? String(text.prefix(AlertMessageEditorConfig.templateMaxLength))
            : text
    }
}

// MARK: - Autocomplete trigger + insertion value types

/// An open `{{` trigger window: the character index where `{{` starts + the partial token typed
/// after it (web `triggerIndex` + `autocompleteFilter`).
public struct TokenTrigger: Sendable, Equatable {
    public var index: Int
    public var partial: String

    public init(index: Int, partial: String) {
        self.index = index
        self.partial = partial
    }
}

/// The result of splicing a token into the template: the next template body + the restored caret
/// character offset (web `next` + the `setSelectionRange` caret).
public struct TokenInsertion: Sendable, Equatable {
    public var text: String
    public var caret: Int

    public init(text: String, caret: Int) {
        self.text = text
        self.caret = caret
    }
}
