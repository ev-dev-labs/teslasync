//
//  AIAlertTuningSuggestions.ViewState.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  The localized, view-ready resolved view-state — split from the Model so each file stays within the
//  repo's SwiftLint file-length budget. These are the projected peers of the web render branches: the
//  output panel, the captured-proposal preview rows + Apply button, the ready card, and the phase
//  envelope. The view is a pure function of these values (no networking, no SwiftUI here).
//

import Foundation

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The localized, view-ready output panel — the projected peer of `AlertTuningOutputKind`. `body` is
/// the prose (or the composed "Helix error: …" / the friendly hint); `accessibilityLabel` is the
/// combined VoiceOver string.
public struct AlertTuningResolvedOutput: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case empty
        case thinking
        case prose
        case failed
    }

    public let kind: Kind
    public let body: String
    public let accessibilityLabel: String

    public init(kind: Kind, body: String, accessibilityLabel: String) {
        self.kind = kind
        self.body = body
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One row of the proposed-patch preview — the literal AlertRule field identifier + its rendered
/// value + the combined VoiceOver string.
public struct AlertTuningProposalRow: Sendable, Equatable, Identifiable {
    public var id: String {
        field
    }

    public let field: String
    public let value: String
    public let accessibilityLabel: String

    public init(field: String, value: String, accessibilityLabel: String) {
        self.field = field
        self.value = value
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The captured-proposal region — the native peer of the web `proposal && (...)` block: the "Apply to
/// form" action (with its disabled rule) and the "Proposed patch (review before saving):" preview
/// list. `isPresent == false` withdraws the whole region (web renders nothing when `proposal` is
/// null).
public struct AlertTuningResolvedProposal: Sendable, Equatable {
    public let isPresent: Bool
    public let previewLabel: String
    public let rows: [AlertTuningProposalRow]
    public let applyTitle: String
    public let applyDisabled: Bool
    public let applyAccessibilityLabel: String

    public init(
        isPresent: Bool,
        previewLabel: String = "",
        rows: [AlertTuningProposalRow] = [],
        applyTitle: String = "",
        applyDisabled: Bool = true,
        applyAccessibilityLabel: String = ""
    ) {
        self.isPresent = isPresent
        self.previewLabel = previewLabel
        self.rows = rows
        self.applyTitle = applyTitle
        self.applyDisabled = applyDisabled
        self.applyAccessibilityLabel = applyAccessibilityLabel
    }

    /// The withdrawn region (web `proposal == null`).
    public static let absent = AlertTuningResolvedProposal(isPresent: false)
}

/// The fully-resolved "ready" card — every string already localized + every flag already derived, so
/// the view is a pure function of this value (web `AIFeatureCard` props + the derived Suggest button +
/// output + the captured-proposal region).
public struct AlertTuningReady: Sendable, Equatable {
    public let title: String
    public let description: String
    public let badge: String
    /// The per-feature contextual verb ("Suggest tuning") surfaced as the button tooltip + the second
    /// half of its accessibility name.
    public let buttonContext: String
    /// The visible button label — "Ask Helix" idle / "Helix is thinking…" while streaming.
    public let actionTitle: String
    public let actionAccessibilityLabel: String
    public let canStart: Bool
    public let action: AlertTuningAction
    public let output: AlertTuningResolvedOutput
    public let proposal: AlertTuningResolvedProposal

    public init(
        title: String,
        description: String,
        badge: String,
        buttonContext: String,
        actionTitle: String,
        actionAccessibilityLabel: String,
        canStart: Bool,
        action: AlertTuningAction,
        output: AlertTuningResolvedOutput,
        proposal: AlertTuningResolvedProposal
    ) {
        self.title = title
        self.description = description
        self.badge = badge
        self.buttonContext = buttonContext
        self.actionTitle = actionTitle
        self.actionAccessibilityLabel = actionAccessibilityLabel
        self.canStart = canStart
        self.action = action
        self.output = output
        self.proposal = proposal
    }
}

/// The resolved view-state — `phase` selects the body, `ready` carries the localized card when the
/// gate is open and resolved.
public struct AlertTuningResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `withAiFeature` off → the surface renders nothing.
        case gated
        /// The `useAiEnabled` settings query resolving → skeleton chrome.
        case loading
        /// The availability query failed → a retryable error.
        case error(String)
        /// The gate is open → the Helix card.
        case ready
    }

    public let phase: Phase
    public let ready: AlertTuningReady?

    public init(phase: Phase, ready: AlertTuningReady? = nil) {
        self.phase = phase
        self.ready = ready
    }
}
