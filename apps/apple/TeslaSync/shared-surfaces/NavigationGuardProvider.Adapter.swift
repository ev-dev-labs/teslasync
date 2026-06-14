//
//  NavigationGuardProvider.Adapter.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  The testable, dependency-light core for the in-app unsaved-changes navigation guard — the SwiftUI
//  parity of `components/feedback/NavigationGuardProvider.tsx`. Everything here is pure (Foundation
//  only): the registered guard entry (web `NavigationGuardEntry`), the ordered registry the provider
//  owns (web `Map<id, GuardEntry>`), the `confirmIfDirty` decision (web `findDirty` + the
//  `<ConfirmDialog>` silence allowlist), the back-navigation intent (web `popstate` handler), the
//  confirm-copy builder (web `<ConfirmDialog>` props, the four `forms.*` keys verbatim), and the
//  VoiceOver label builders. No SwiftUI, no router, no bundle — so each piece is unit tested in
//  isolation.
//
//  Parity note: the web provider keeps a registry of "this form is dirty" callbacks and, on a guarded
//  navigation (a `GuardedLink`, an imperative `useGuardedNavigate`, or a browser back/forward), asks
//  the first dirty guard to confirm. This core reproduces those pure derivations as value types and
//  functions; the @Observable coordinator and the SwiftUI confirm chrome layer on top in the sibling
//  files.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias NavigationGuardResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Guard entry (web `NavigationGuardEntry`)

/// One registered "form is dirty" guard — the native mirror of the web `NavigationGuardEntry`. The
/// `id` is the consumer's stable per-mount identity (web `useId()`); `isDirty` reports unsaved edits;
/// `message` is the caller-localized confirm prompt shown when THIS guard blocks navigation (web
/// `getMessage`), or `nil` to fall back to the generic warning. The callbacks are read lazily by the
/// registry (web reads them from refs), exactly when a guarded navigation is attempted.
public struct NavigationGuardEntry {
    public let id: String
    public let isDirty: () -> Bool
    public let message: () -> String?

    public init(
        id: String,
        isDirty: @escaping () -> Bool,
        message: @escaping () -> String? = { nil }
    ) {
        self.id = id
        self.isDirty = isDirty
        self.message = message
    }
}

// MARK: - Registry (web `Map<id, GuardEntry>`)

/// The provider's ordered guard registry — the native parity of the web `guards.current` map. Keeps
/// insertion order so `firstDirty()` is deterministic (web iterates the map's values in insertion
/// order), replaces an entry registered under an existing id in place, and removes by id (web cleanup
/// fn). Pure value type — unit tested across set / replace / remove / first-dirty.
public struct NavigationGuardRegistry {
    private var order: [String] = []
    private var entries: [String: NavigationGuardEntry] = [:]

    public init() {}

    /// True when no guard is registered (web `guards.size === 0`).
    public var isEmpty: Bool {
        entries.isEmpty
    }

    /// The number of registered guards.
    public var count: Int {
        entries.count
    }

    /// Whether a guard is registered under `id`.
    public func contains(id: String) -> Bool {
        entries[id] != nil
    }

    /// Register (web `guards.set(id, entry)`). A repeat id replaces in place without re-ordering.
    public mutating func set(_ entry: NavigationGuardEntry) {
        if entries[entry.id] == nil {
            order.append(entry.id)
        }
        entries[entry.id] = entry
    }

    /// Unregister (web cleanup `guards.delete(id)`).
    public mutating func remove(id: String) {
        entries[id] = nil
        order.removeAll { $0 == id }
    }

    /// The first registered guard reporting dirty, in registration order (web `findDirty`). `nil` when
    /// every guard is clean (or none are registered).
    public func firstDirty() -> NavigationGuardEntry? {
        for id in order {
            if let entry = entries[id], entry.isDirty() {
                return entry
            }
        }
        return nil
    }
}

// MARK: - Confirm decision (web `confirmIfDirty` + the `<ConfirmDialog>` silence)

/// The resolved outcome of a guarded navigation request — the native parity of the web
/// `confirmIfDirty()` branch: either proceed immediately (no dirty guard, or a previously-silenced
/// action) or raise the confirm prompt with the blocking guard's optional message.
public enum NavigationGuardOutcome: Equatable {
    case proceed
    case prompt(customMessage: String?)
}

/// The pure guarded-navigation decision — the native port of the web `confirmIfDirty` core plus the
/// `<ConfirmDialog>` silence honoring:
///   • no dirty guard ⇒ `.proceed` (web `if (!dirty) return Promise.resolve(true)`).
///   • a dirty guard but the action was silenced ("Don't ask again") ⇒ `.proceed` (web ConfirmDialog
///     `isSilenced` ⇒ auto-`onConfirm`).
///   • a dirty guard, not silenced ⇒ `.prompt` with the guard's optional message (web `setPending`).
/// Pure + public so every branch is asserted.
public enum NavigationGuardDecision {
    public static func resolve(
        hasDirtyGuard: Bool,
        dirtyMessage: String?,
        isSilenced: Bool
    ) -> NavigationGuardOutcome {
        guard hasDirtyGuard else { return .proceed }
        if isSilenced { return .proceed }
        return .prompt(customMessage: dirtyMessage)
    }

    /// Whether silencing is honored for this surface — the web `<ConfirmDialog variant="warning"`
    /// `silenceKey="unsaved-navigation">` is a non-destructive prompt with a silence key, so the
    /// "Don't ask again" opt-out is offered whenever a non-empty key is configured.
    public static func silenceHonored(silenceKey: String) -> Bool {
        !silenceKey.isEmpty
    }
}

// MARK: - Back-navigation intent (web `popstate` handler)

/// The pure browser-back decision — the native parity of the web provider's `popstate` handler core:
/// when no guard is dirty the back is allowed through; when a guard is dirty the back is intercepted
/// and routed to the confirm prompt (web rolls the URL back, then `setPending`). The host navigation
/// layer awaits `NavigationGuardCoordinator.confirmBack()`; this value type is the unit-testable
/// decision behind it.
public enum NavigationGuardBackIntent: Equatable {
    case allow
    case confirm

    public static func evaluate(isDirty: Bool) -> NavigationGuardBackIntent {
        isDirty ? .confirm : .allow
    }
}

// MARK: - Confirm copy (web `<ConfirmDialog>` props)

/// The fully-resolved confirm-dialog copy — the four user-facing strings the web provider threads into
/// `<ConfirmDialog>`. A pure value so the card view is a function of it and snapshot tests assert it.
public struct NavigationGuardConfirmCopy: Sendable, Equatable {
    public let title: String
    public let message: String
    public let confirmLabel: String
    public let cancelLabel: String

    public init(title: String, message: String, confirmLabel: String, cancelLabel: String) {
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
        self.cancelLabel = cancelLabel
    }
}

/// Builds the confirm copy from the localizer and the blocking guard's optional custom message — the
/// native port of the web `<ConfirmDialog title message confirmLabel cancelLabel>`:
///   • title   = `t('forms.unsavedTitle', 'Unsaved changes')`
///   • message = the guard's message when present, else `t('forms.unsavedWarning', …)`
///   • confirm = `t('forms.discard', 'Discard changes')`
///   • cancel  = `t('forms.keepEditing', 'Keep editing')`
/// The four keys are preserved VERBATIM so a shared catalog resolves identically across web and native.
public enum NavigationGuardConfirmContent {
    /// The web `t()` keys — preserved verbatim for cross-platform catalog parity.
    public enum Keys {
        public static let title = "forms.unsavedTitle"
        public static let message = "forms.unsavedWarning"
        public static let discard = "forms.discard"
        public static let keepEditing = "forms.keepEditing"
    }

    /// The web English fallbacks (the `t(key, default)` second argument).
    public enum Fallbacks {
        public static let title = "Unsaved changes"
        public static let message = "You have unsaved changes. Discard them?"
        public static let discard = "Discard changes"
        public static let keepEditing = "Keep editing"
    }

    public static func build(
        customMessage: String?,
        localize: NavigationGuardResolve
    ) -> NavigationGuardConfirmCopy {
        let trimmed = customMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
        let message: String =
            if let trimmed, !trimmed.isEmpty {
                trimmed
            } else {
                localize(Keys.message, Fallbacks.message)
            }
        return NavigationGuardConfirmCopy(
            title: localize(Keys.title, Fallbacks.title),
            message: message,
            confirmLabel: localize(Keys.discard, Fallbacks.discard),
            cancelLabel: localize(Keys.keepEditing, Fallbacks.keepEditing)
        )
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver phrases from already-localised strings, so the spoken affordances are
/// asserted without rendering. The confirm prompt reads as one combined phrase (title + message); the
/// freshness chip and the silence toggle get explicit, state-aware labels.
public enum NavigationGuardAccessibility {
    /// The confirm dialog's combined region label (web `Modal` title + severity-prefixed message).
    public static func confirmSummary(
        title: String,
        message: String,
        localize: NavigationGuardResolve
    ) -> String {
        let warning = localize("navigationGuard.warningA11y", "Warning")
        return normalize("\(warning). \(title). \(message)")
    }

    /// The "Don't ask again" toggle label, with its checked state spoken (web silence checkbox).
    public static func silenceLabel(checked: Bool, localize: NavigationGuardResolve) -> String {
        let label = localize("navigationGuard.dontAskAgain", "Don't ask again")
        let state =
            checked
                ? localize("navigationGuard.checkedA11y", "checked")
                : localize("navigationGuard.uncheckedA11y", "not checked")
        return normalize("\(label), \(state)")
    }

    /// The freshness chip's spoken label for the connectivity axis.
    public static func freshnessLabel(
        connection: NavigationGuardConnection,
        localize: NavigationGuardResolve
    ) -> String {
        switch connection {
        case .live:
            localize("navigationGuard.live", "Live")
        case .stale:
            localize("navigationGuard.staleA11y", "Stale — tap to refresh")
        case .offline:
            localize("navigationGuard.offlineA11y", "Offline — guard state may be out of date")
        }
    }

    /// Collapses internal whitespace runs and trims the ends so a wrapped phrase never reads a double
    /// space.
    public static func normalize(_ text: String) -> String {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
