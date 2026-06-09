//
//  AIFeatureToggleList.Adapter.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  The pure, Foundation-only projection core for the AI feature-toggle settings surface — the SwiftUI
//  parity of features/settings/components/AIFeatureToggleList.tsx.
//
//  It ports the web component's body VERBATIM: iterate `AI_FEATURE_IDS` (here `AIFeatureRegistry.all`)
//  in registry order, resolve each row's copy through the i18n facade
//  (`t('ai.settings.feature.<id>.label', meta.name)` / `…description', meta.description)`), and read the
//  switch state as `Boolean(values[id])` (an absent id is off). The registry name is the label's web
//  fallback; the long description lives in the i18n catalogue (AIFeatureToggleList.strings) so it is
//  never an oversized Swift literal. Everything is SwiftUI-free so it is exhaustively unit-testable.
//

import Foundation

// MARK: - Projected row (web per-feature `<div>` label + Caption + Toggle)

/// One feature toggle row, fully resolved for the view: the registry-ordered id, the localized label
/// (web `meta.name` fallback) and description (web `meta.description`, from the catalogue), the current
/// opt-in state (`Boolean(values[id])`), and the VoiceOver label/value. The description is empty only
/// when the catalogue is unavailable (e.g. the host test harness, which doesn't bundle the table); the
/// production bundle always resolves the real registry blurb.
public struct AIFeatureToggleRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let description: String
    public let isEnabled: Bool
    public let accessibilityLabel: String
    public let accessibilityValue: String

    public init(
        id: String,
        label: String,
        description: String,
        isEnabled: Bool,
        accessibilityLabel: String,
        accessibilityValue: String
    ) {
        self.id = id
        self.label = label
        self.description = description
        self.isEnabled = isEnabled
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
    }
}

// MARK: - Projection (web render branch, view-ready)

/// The view-ready projection of the whole list — every feature row plus a combined VoiceOver summary.
/// A pure function of the opt-in values map, so the view is a pure function of this value and the whole
/// pipeline is unit-tested in isolation.
public struct AIFeatureToggleProjection: Sendable, Equatable {
    public let rows: [AIFeatureToggleRow]
    public let accessibilitySummary: String

    public init(rows: [AIFeatureToggleRow], accessibilitySummary: String) {
        self.rows = rows
        self.accessibilitySummary = accessibilitySummary
    }
}

/// Pure projection from the opt-in values map to the view-ready `AIFeatureToggleProjection` — the
/// native port of the web component's body. Reproduces the registry-order iteration, every `t()`
/// lookup, and the `Boolean(values[id])` state read, pinned by the adapter unit tests.
public enum AIFeatureToggleProjector {
    /// Builds every row from `AIFeatureRegistry.all` (web `AI_FEATURE_IDS`), in order. An id absent from
    /// `values` reads as off, exactly like the web `Boolean(values[id])`.
    public static func project(values: [String: Bool]) -> AIFeatureToggleProjection {
        let rows = AIFeatureRegistry.all.map { descriptor -> AIFeatureToggleRow in
            let enabled = values[descriptor.id] ?? false
            let label = AIFeatureToggleStrings.string(labelKey(descriptor.id), descriptor.name)
            let description = AIFeatureToggleStrings.string(descriptionKey(descriptor.id), "")
            return AIFeatureToggleRow(
                id: descriptor.id,
                label: label,
                description: description,
                isEnabled: enabled,
                accessibilityLabel: label,
                accessibilityValue: stateText(enabled)
            )
        }
        let summary = rows
            .map { AIFeatureToggleAccessibility.tile($0.accessibilityLabel, $0.accessibilityValue) }
            .joined(separator: ", ")
        return AIFeatureToggleProjection(rows: rows, accessibilitySummary: summary)
    }

    /// The i18n key for a feature's label — web `ai.settings.feature.<id>.label`.
    public static func labelKey(_ id: String) -> String {
        "ai.settings.feature.\(id).label"
    }

    /// The i18n key for a feature's description — web `ai.settings.feature.<id>.description`.
    public static func descriptionKey(_ id: String) -> String {
        "ai.settings.feature.\(id).description"
    }

    /// The localized on/off word for a switch state, used for the VoiceOver value + summary.
    public static func stateText(_ enabled: Bool) -> String {
        enabled
            ? AIFeatureToggleStrings.string("ai.settings.feature.enabled", "On")
            : AIFeatureToggleStrings.string("ai.settings.feature.disabled", "Off")
    }
}

// MARK: - Accessibility summaries

/// Builds the combined VoiceOver strings for the rows, joining the already-localized parts so the
/// labels stay translation-driven.
public enum AIFeatureToggleAccessibility {
    /// Joins non-empty parts with ", " (the standard VoiceOver list separator).
    public static func join(_ parts: [String]) -> String {
        parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    /// "<label>, <value>" for one row's VoiceOver label.
    public static func tile(_ label: String, _ value: String) -> String {
        join([label, value])
    }
}
