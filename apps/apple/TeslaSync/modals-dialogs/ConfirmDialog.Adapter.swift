//
//  ConfirmDialog.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  The testable, dependency-free projection core for the destructive-action confirmation dialog —
//  the faithful port of components/ui/ConfirmDialog.tsx. Everything here is pure Foundation so the
//  variant→severity map, the silence-honored predicate, the typed-confirmation gate, the
//  confirm-disabled rule, the resolved visibility / body phase, and the caller-label resolution are
//  all unit-tested without a bundle, a view, or persistence.
//
//  Web parity notes:
//    • `variantToSeverity` (`danger → critical`, `warning → warn`) → `severity(for:)`, and the
//      `iconComponents` map (`AlertOctagon` / `AlertTriangle`) → `ConfirmSeverity.iconSystemName`.
//    • `silenceHonored = silenceKey && variant !== 'danger' && !requireTypedConfirmation` →
//      `silenceHonored(variant:silenceKey:requireTypedConfirmation:)`. Destructive + typed prompts
//      always re-prompt regardless of the caller's `silenceKey`.
//    • `typedMatches = !requireTypedConfirmation || typed === requireTypedConfirmation` and
//      `confirmDisabled = loading || !typedMatches` → the two predicates of the same name.
//    • `inputLabel = typedConfirmationLabel ?? \`Type "X" to confirm\`` → `typedConfirmationLabel`.
//    • The web early-return (`open && silenced` → render `null`, fire `onConfirm`) resolves to the
//      `resolveVisibility` machine: a silenced action auto-resolves to `.hidden` while the model
//      fires the confirm seam. A `pinned` flag suppresses the ambient hide so an intentionally-
//      presented dialog still renders loading / empty / error chrome (engineering guideline #6).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum ConfirmDialogSurface {
    public static let slug = "ConfirmDialog"
}

// MARK: - Variant + severity (web `variant` / `variantToSeverity`)

/// The caller-selected emphasis (web `variant`). `danger` is the destructive default; `warning` is
/// the softer amber path. Both always render real confirm affordances.
public enum ConfirmVariant: String, Sendable, Equatable, CaseIterable {
    case danger
    case warning
}

/// The resolved severity the variant maps onto (web `Severity` — the two values the dialog uses).
/// Carries the SF Symbol parity of the web Lucide icon so the icon choice is unit-testable without
/// SwiftUI.
public enum ConfirmSeverity: String, Sendable, Equatable, CaseIterable {
    /// Web `critical` (`AlertOctagon`, red).
    case critical
    /// Web `warn` (`AlertTriangle`, amber).
    case warn

    /// The SF Symbol mirroring the web Lucide icon (`AlertOctagon` / `AlertTriangle`).
    public var iconSystemName: String {
        switch self {
        case .critical: "exclamationmark.octagon.fill"
        case .warn: "exclamationmark.triangle.fill"
        }
    }
}

// MARK: - Load status / render phase / freshness

/// The bound source's delivery status for the confirm request (web parent-supplied `open`). The
/// request is normally pushed synchronously; the loading / failed arms exist so an intentionally-
/// presented dialog renders real chrome rather than a blank box while a request is resolved.
public enum ConfirmLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): drives the freshness chip + cached-data banner so a confirm
/// prompt assembled from a cached context is clearly labeled while reconnecting / offline.
public enum ConfirmConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web early-returns `null` when there is nothing to
/// confirm (or the action is silenced); `hidden` models that, and `presented` shows the dialog
/// (whose body switches over `phase`).
public enum ConfirmVisibility: Sendable, Equatable {
    case hidden
    case presented
}

/// What the presented dialog body renders. The web only ever shows the confirm form; the loading /
/// empty / error envelopes are added so an intentionally-presented dialog is never a blank box.
public enum ConfirmPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Confirm request (web props)

/// One confirmation prompt the source delivers — the projection of the web `ConfirmDialogProps`
/// (the caller-supplied content + behaviour flags). `confirmLabel` / `cancelLabel` /
/// `typedConfirmationLabel` are optional so the model can fall back to the localized defaults, and
/// `loading` mirrors the web `loading` prop (parent keeps the dialog open while a mutation is in
/// flight).
public struct ConfirmRequest: Sendable, Equatable {
    public let title: String
    public let message: String
    public let confirmLabel: String?
    public let cancelLabel: String?
    public let variant: ConfirmVariant
    public let loading: Bool
    public let requireTypedConfirmation: String?
    public let typedConfirmationLabel: String?
    public let silenceKey: String?

    public init(
        title: String,
        message: String,
        confirmLabel: String? = nil,
        cancelLabel: String? = nil,
        variant: ConfirmVariant = .danger,
        loading: Bool = false,
        requireTypedConfirmation: String? = nil,
        typedConfirmationLabel: String? = nil,
        silenceKey: String? = nil
    ) {
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
        self.cancelLabel = cancelLabel
        self.variant = variant
        self.loading = loading
        self.requireTypedConfirmation = requireTypedConfirmation
        self.typedConfirmationLabel = typedConfirmationLabel
        self.silenceKey = silenceKey
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution shared by the model and tests: the variant→severity map, the
/// silence-honored predicate, the typed-confirmation gate, the confirm-disabled rule, the resolved
/// visibility + body phase, the inline-failure envelope, and the caller-label fallbacks.
public enum ConfirmDialogProjection {
    /// The localization keys for the defaulted caller labels (web prop defaults `'Confirm'` /
    /// `'Cancel'`) and the typed-confirmation label template (web `Type "X" to confirm`).
    public enum Keys {
        public static let confirm = "confirm.confirm"
        public static let cancel = "confirm.cancel"
        public static let typedLabel = "confirm.typed.label"
        public static let silenceCheckbox = "confirm.silence.checkbox"
    }

    /// The English fallbacks for the defaulted caller labels (web prop defaults + template).
    public enum Fallbacks {
        public static let confirm = "Confirm"
        public static let cancel = "Cancel"
        /// `{{value}}` is replaced with `requireTypedConfirmation` (web `Type "X" to confirm`).
        public static let typedLabel = "Type \"{{value}}\" to confirm"
        public static let silenceCheckbox = "Don't ask again for this action"
    }

    /// Verbatim port of the web `variantToSeverity` map.
    public static func severity(for variant: ConfirmVariant) -> ConfirmSeverity {
        switch variant {
        case .danger: .critical
        case .warning: .warn
        }
    }

    /// Verbatim port of the web `silenceHonored` predicate: silencing is honored only for a
    /// non-destructive prompt that has no typed-confirmation gate. Destructive + typed prompts must
    /// always re-confirm, so a caller may pass `silenceKey` on those without effect.
    public static func silenceHonored(
        variant: ConfirmVariant,
        silenceKey: String?,
        requireTypedConfirmation: String?
    ) -> Bool {
        guard let silenceKey, !silenceKey.isEmpty else { return false }
        return variant != .danger && requireTypedConfirmation == nil
    }

    /// Verbatim port of the web `typedMatches`: no gate, or the typed text equals the required
    /// string exactly.
    public static func typedMatches(requireTypedConfirmation: String?, typed: String) -> Bool {
        guard let required = requireTypedConfirmation else { return true }
        return typed == required
    }

    /// Verbatim port of the web `confirmDisabled = loading || !typedMatches`.
    public static func confirmDisabled(busy: Bool, typedMatches: Bool) -> Bool {
        busy || !typedMatches
    }

    /// The presented dialog's body phase. A usable request shows the confirm content; otherwise the
    /// loading / empty / error envelope renders so the dialog is never blank.
    public static func resolvePhase(status: ConfirmLoadStatus, hasRequest: Bool) -> ConfirmPhase {
        switch status {
        case .loading:
            hasRequest ? .content : .loading
        case .loaded:
            hasRequest ? .content : .empty
        case let .failed(message):
            hasRequest ? .content : .error(message)
        }
    }

    /// The web early-return resolved to a rendered surface. A silenced action (`autoResolved`)
    /// hides itself while the model fires the confirm seam (web `null` + `onConfirm`). `pinned`
    /// models an intentionally-presented dialog: it suppresses the ambient hide so loading / empty /
    /// error chrome still renders rather than vanishing (engineering guideline #6).
    public static func resolveVisibility(
        hasRequest: Bool,
        pinned: Bool,
        autoResolved: Bool
    ) -> ConfirmVisibility {
        if autoResolved { return .hidden }
        return (hasRequest || pinned) ? .presented : .hidden
    }

    /// The failure message kept on screen while a delivered request survives a failed reload (the
    /// inline error shown above the confirm content), else `nil`.
    public static func inlineFailure(status: ConfirmLoadStatus, hasRequest: Bool) -> String? {
        guard hasRequest, case let .failed(message) = status else { return nil }
        return message
    }

    /// The confirm button label: the caller's override, else the localized default (web
    /// `confirmLabel = 'Confirm'`).
    public static func confirmLabel(_ request: ConfirmRequest, localize: (String, String) -> String) -> String {
        nonEmpty(request.confirmLabel) ?? localize(Keys.confirm, Fallbacks.confirm)
    }

    /// The cancel button label: the caller's override, else the localized default (web
    /// `cancelLabel = 'Cancel'`).
    public static func cancelLabel(_ request: ConfirmRequest, localize: (String, String) -> String) -> String {
        nonEmpty(request.cancelLabel) ?? localize(Keys.cancel, Fallbacks.cancel)
    }

    /// The typed-confirmation field label (web `inputLabel`): the caller's override, else the
    /// localized `Type "X" to confirm` template with the required string substituted. Empty when no
    /// typed-confirmation gate is set.
    public static func typedConfirmationLabel(
        _ request: ConfirmRequest,
        localize: (String, String) -> String
    ) -> String {
        if let override = nonEmpty(request.typedConfirmationLabel) { return override }
        guard let required = request.requireTypedConfirmation else { return "" }
        return localize(Keys.typedLabel, Fallbacks.typedLabel)
            .replacingOccurrences(of: "{{value}}", with: required)
    }

    /// Trims optional caller copy to `nil` when blank so an empty override falls back to the default.
    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}
