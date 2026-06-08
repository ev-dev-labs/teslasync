//
//  AdvancedSettings.Adapter.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  The testable projection core for the "Restore confirmation prompts" panel — the faithful port of
//  features/settings/components/AdvancedSettings.tsx. `AdvancedSettingsProjector` reproduces the
//  component's pipeline VERBATIM: the `useSilenceKeyLabel` switch (known ids → friendly label, unknown
//  ids → raw key for forward-compat), the `listSilenced()` de-dupe + sort, and the
//  `silenced.length === 0` empty / list branch. Foundation-only so it is unit-tested without a bundle
//  or a rendered view.
//

import Foundation

/// The dependency-free projection from persisted silence-key ids to de-duplicated, sorted restore
/// rows, plus the body-phase resolver. Every value uses the same identity + label as the web component
/// so the web and native panels resolve identical rows for an identical persisted set.
public enum AdvancedSettingsProjector {
    /// The web `useSilenceKeyLabel` switch: known ids get a friendly, localized label; an unknown id
    /// falls back to the raw key (web "forward-compat for new adopters that haven't shipped a
    /// translation yet").
    public static func label(for key: String, copy: AdvancedSettingsCopy = .fallback) -> String {
        switch key {
        case AdvancedSettingsConfig.discardDraftKey:
            copy.discardDraftLabel
        case AdvancedSettingsConfig.unsavedNavigationKey:
            copy.unsavedNavigationLabel
        default:
            key
        }
    }

    /// Builds the restore projection from the persisted ids: drops blank ids, removes duplicates (web
    /// reads through a `Set`), sorts for stable rendering (web `listSilenced()` `.sort()`), and maps
    /// each id to its friendly label + a combined VoiceOver row label.
    public static func project(
        keys: [String],
        copy: AdvancedSettingsCopy = .fallback
    ) -> AdvancedSettingsProjection {
        var seen = Set<String>()
        var ids: [String] = []
        for raw in keys {
            let key = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty else { continue }
            guard seen.insert(key).inserted else { continue }
            ids.append(key)
        }
        ids.sort()
        let rows = ids.map { key -> SilencedPromptRow in
            let friendly = label(for: key, copy: copy)
            return SilencedPromptRow(
                id: key,
                label: friendly,
                accessibilityLabel: "\(copy.promptRole): \(friendly)"
            )
        }
        return AdvancedSettingsProjection(rows: rows)
    }

    /// Resolves the body phase, mirroring the web precedence: a read in flight short-circuits to
    /// loading, then a load failure, then a resolved set is `content` when it has rows and `empty` when
    /// it does not (web `silenced.length === 0`).
    public static func resolvePhase(
        _ status: AdvancedSettingsLoadStatus,
        hasRows: Bool
    ) -> AdvancedSettingsPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasRows ? .content : .empty
        }
    }
}
