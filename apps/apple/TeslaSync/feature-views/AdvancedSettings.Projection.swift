//
//  AdvancedSettings.Projection.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  The projected output types for the "Restore confirmation prompts" panel (one resolved restore row +
//  the whole-list projection), the diagnostics surface slug, and the VoiceOver summary builders.
//  Foundation-only so it executes on a plain host and is pinned by tests.
//

import Foundation

// MARK: - Projected pieces

/// One silenced-prompt row (web `<li>` rendered for each `silenced` id): the persisted action id (web
/// React `key`), the friendly label (web `labelFor(key)`), and a combined VoiceOver label.
public struct SilencedPromptRow: Sendable, Equatable, Identifiable {
    /// Stable identity — the persisted action id (web `key={key}`); also the value passed to `unsilence`.
    public var id: String
    /// The label shown in the row (web `labelFor(key)`).
    public var label: String
    /// The combined VoiceOver label (role word + the friendly label).
    public var accessibilityLabel: String

    public init(id: String, label: String, accessibilityLabel: String) {
        self.id = id
        self.label = label
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully projected restore list (web sorted `silenced`): the de-duplicated, sorted rows the panel
/// renders. An empty list reproduces the web `EmptyState` branch.
public struct AdvancedSettingsProjection: Sendable, Equatable {
    public var rows: [SilencedPromptRow]

    public init(rows: [SilencedPromptRow]) {
        self.rows = rows
    }

    /// Whether the panel shows restore rows (vs its empty state).
    public var hasRows: Bool {
        !rows.isEmpty
    }

    public static let empty = AdvancedSettingsProjection(rows: [])
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core
/// so it is reachable from the projection's unit tests.
public enum AdvancedSettingsSurface {
    public static let slug = "AdvancedSettings"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum AdvancedSettingsAccessibility {
    /// The spoken status of the restore list for the current phase. `count` is the resolved row count
    /// (only meaningful for `.content`).
    public static func summary(
        for phase: AdvancedSettingsPhase,
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .loading:
            return localize("advanced.restoreConfirms.a11y.loading", "Loading silenced prompts")
        case .content:
            let template = localize("advanced.restoreConfirms.a11y.count", "%d silenced prompts")
            return String(format: template, count)
        case .empty:
            return localize("advanced.restoreConfirms.a11y.empty", "No silenced prompts")
        case .error:
            return localize("advanced.restoreConfirms.a11y.error", "Couldn't load silenced prompts")
        }
    }

    /// The per-row restore button's VoiceOver label, naming the prompt it re-enables (web `Restore`
    /// button beside each `<li>`), so the control is not just an unlabelled "Restore".
    public static func restoreLabel(
        for label: String,
        localize: (String, String) -> String
    ) -> String {
        let template = localize("advanced.restoreConfirms.a11y.restore", "Restore “%@”")
        return String(format: template, label)
    }
}
