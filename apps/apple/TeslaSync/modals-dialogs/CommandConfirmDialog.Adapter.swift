//
//  CommandConfirmDialog.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  The testable, dependency-free projection core for the command-confirmation dialog — the faithful
//  port of features/system/components/CommandConfirmDialog.tsx. The web source is a red-bordered
//  `Modal` that gates a (often destructive) vehicle command behind two checks: an optional countdown
//  that ticks the Confirm button live before it can be pressed, and an optional "type the word to
//  confirm" text gate matched case-insensitively against the trimmed input. Everything here is pure
//  Foundation so the countdown arithmetic, the case-insensitive match, the `canConfirm` gate, the
//  confirm-disabled rule, the resolved visibility / body phase, and the dialog copy are all
//  unit-testable without a bundle, a view, or a timer.
//
//  Web parity notes:
//    • `countdown = def.countdown ?? 0`                       → `CommandConfirmRequest.countdown`,
//      `initialRemaining(countdown:)` (clamped ≥ 0).
//    • the `setInterval` `prev <= 1 ? 0 : prev - 1`           → `decremented(remaining:)`.
//    • `canConfirm = remaining === 0 && (!confirmInput ||      → `inputMatches(confirmInput:typed:)`
//       input.trim().toUpperCase() === confirmInput.toUpperCase())`  + `canConfirm(...)`.
//    • `disabled={!canConfirm}` + the `loading` prop          → `confirmDisabled(busy:canConfirm:)`.
//    • `${t('common.confirm')} (${remaining}s)`               → `confirmButtonTitle(remaining:localize:)`.
//    • `t(def.confirmKey, def.confirmFallback ?? 'Are you sure?')` → `messageText(_:localize:)` default.
//    • The web only ever renders with a command; `resolvePhase` / `resolveVisibility` widen that into
//      the prompt-required loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum CommandConfirmSurface {
    public static let slug = "CommandConfirmDialog"
}

// MARK: - Load status / render phase / freshness

/// The bound source's delivery status for the command being confirmed (web parent-supplied `open` +
/// `def`). The request is normally pushed synchronously; the loading / failed arms exist so an
/// intentionally-presented dialog renders real chrome rather than a blank box.
public enum CommandConfirmLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): drives the freshness chip + cached-data banner so a confirm prompt
/// assembled from a cached command context is clearly labeled while reconnecting / offline.
public enum CommandConfirmConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web early-returns nothing when there is no command
/// to confirm; `hidden` models that, and `presented` shows the dialog (whose body switches over
/// `phase`).
public enum CommandConfirmVisibility: Sendable, Equatable {
    case hidden
    case presented
}

/// What the presented dialog body renders. The web only ever shows the confirm form; the loading /
/// empty / error envelopes are added so an intentionally-presented dialog is never a blank box.
public enum CommandConfirmPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Command confirm request (web props)

/// One confirmation prompt the source delivers — the projection of the web `CommandConfirmDialogProps`
/// (the resolved `CommandDef` copy + behaviour flags). `title` / `message` arrive already-resolved
/// from the caller (web `t(def.labelKey, …)` / `t(def.confirmKey, …)`), `countdown` mirrors
/// `def.countdown`, `confirmInput` mirrors `def.confirmInput`, and `loading` mirrors the `loading`
/// prop (parent keeps the dialog open while the command is dispatched).
public struct CommandConfirmRequest: Sendable, Equatable {
    public let commandID: String
    public let title: String
    public let message: String
    public let countdown: Int
    public let confirmInput: String?
    public let loading: Bool

    public init(
        commandID: String,
        title: String,
        message: String = "",
        countdown: Int = 0,
        confirmInput: String? = nil,
        loading: Bool = false
    ) {
        self.commandID = commandID
        self.title = title
        self.message = message
        self.countdown = countdown
        self.confirmInput = confirmInput
        self.loading = loading
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution shared by the model and tests: the countdown arithmetic, the
/// case-insensitive typed-confirmation match, the `canConfirm` gate, the confirm-disabled rule, the
/// resolved visibility + body phase, the inline-failure envelope, and the dialog copy. All copy
/// resolves through an injected localizer so it stays bundle-free.
public enum CommandConfirmProjection {
    /// Localization keys for the copy the web inlines (`common.confirm` / `common.cancel`), the
    /// "Are you sure?" message default, the typed-confirmation prompt, and the countdown suffix.
    public enum Keys {
        public static let confirm = "common.confirm"
        public static let cancel = "common.cancel"
        public static let areYouSure = "commands.confirm.areYouSure"
        public static let typeToConfirm = "commands.confirm.typeToConfirm"
        public static let countdown = "commands.confirm.countdown"
    }

    /// English fallbacks matching the web source's literal defaults.
    public enum Fallbacks {
        public static let confirm = "Confirm"
        public static let cancel = "Cancel"
        public static let areYouSure = "Are you sure?"
        /// `{{word}}` is replaced with `confirmInput` (web `Type "{{word}}" to confirm:`).
        public static let typeToConfirm = "Type \"{{word}}\" to confirm:"
        /// `{{label}}` / `{{seconds}}` rebuild the web `${confirm} (${remaining}s)` string.
        public static let countdown = "{{label}} ({{seconds}}s)"
    }

    /// The starting countdown, clamped to a non-negative value (web `def.countdown ?? 0`).
    public static func initialRemaining(countdown: Int) -> Int {
        max(0, countdown)
    }

    /// One tick of the countdown — the verbatim port of the web `prev <= 1 ? 0 : prev - 1`.
    public static func decremented(remaining: Int) -> Int {
        remaining <= 1 ? 0 : remaining - 1
    }

    /// Whether the countdown is still ticking (web `remaining > 0`): the Confirm button is dimmed +
    /// gated, and shows the `(Ns)` suffix.
    public static func countdownActive(remaining: Int) -> Bool {
        remaining > 0
    }

    /// Whether a typed-confirmation gate is present (web `confirmInput` truthiness: an empty string is
    /// falsy, so no gate).
    public static func hasTypedGate(confirmInput: String?) -> Bool {
        guard let confirmInput else { return false }
        return !confirmInput.isEmpty
    }

    /// Whether the typed text satisfies the gate — the verbatim port of the web
    /// `!confirmInput || input.trim().toUpperCase() === confirmInput.toUpperCase()`.
    public static func inputMatches(confirmInput: String?, typed: String) -> Bool {
        guard hasTypedGate(confirmInput: confirmInput), let confirmInput else { return true }
        let normalizedTyped = typed.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return normalizedTyped == confirmInput.uppercased()
    }

    /// The verbatim port of the web `canConfirm`: the countdown has elapsed and the typed gate (if
    /// any) is satisfied.
    public static func canConfirm(remaining: Int, confirmInput: String?, typed: String) -> Bool {
        remaining == 0 && inputMatches(confirmInput: confirmInput, typed: typed)
    }

    /// Whether the Confirm action is disabled: a mutation is in flight (web `loading`) or the
    /// `canConfirm` gate is unmet (web `disabled={!canConfirm}`).
    public static func confirmDisabled(busy: Bool, canConfirm: Bool) -> Bool {
        busy || !canConfirm
    }

    /// The presented dialog's body phase. A usable command shows the confirm content; otherwise the
    /// loading / empty / error envelope renders so the dialog is never blank.
    public static func resolvePhase(status: CommandConfirmLoadStatus, hasRequest: Bool) -> CommandConfirmPhase {
        switch status {
        case .loading:
            hasRequest ? .content : .loading
        case .loaded:
            hasRequest ? .content : .empty
        case let .failed(message):
            hasRequest ? .content : .error(message)
        }
    }

    /// The web early-return resolved to a rendered surface: nothing while there is no command (web
    /// `null`), else the presented panel. `pinned` models an intentionally-presented dialog so the
    /// loading / empty / error chrome still renders rather than vanishing (engineering guideline #6).
    public static func resolveVisibility(hasRequest: Bool, pinned: Bool) -> CommandConfirmVisibility {
        (hasRequest || pinned) ? .presented : .hidden
    }

    /// The failure message kept on screen while a delivered command survives a failed reload (the
    /// inline error shown above the confirm content), else `nil`.
    public static func inlineFailure(status: CommandConfirmLoadStatus, hasRequest: Bool) -> String? {
        guard hasRequest, case let .failed(message) = status else { return nil }
        return message
    }

    // MARK: Copy

    /// The dialog message (web `t(def.confirmKey, def.confirmFallback ?? 'Are you sure?')`): the
    /// caller's resolved confirm copy, else the localized "Are you sure?" default.
    public static func messageText(_ request: CommandConfirmRequest, localize: (String, String) -> String) -> String {
        let trimmed = request.message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? localize(Keys.areYouSure, Fallbacks.areYouSure) : request.message
    }

    /// The Confirm button title: while the countdown ticks, the localized `Confirm (Ns)` template;
    /// otherwise the plain `Confirm` label (web `remaining > 0 ? \`Confirm (${remaining}s)\` : Confirm`).
    public static func confirmButtonTitle(remaining: Int, localize: (String, String) -> String) -> String {
        let label = localize(Keys.confirm, Fallbacks.confirm)
        guard countdownActive(remaining: remaining) else { return label }
        return localize(Keys.countdown, Fallbacks.countdown)
            .replacingOccurrences(of: "{{label}}", with: label)
            .replacingOccurrences(of: "{{seconds}}", with: String(remaining))
    }

    /// The Cancel button title (web `t('common.cancel', 'Cancel')`).
    public static func cancelButtonTitle(localize: (String, String) -> String) -> String {
        localize(Keys.cancel, Fallbacks.cancel)
    }

    /// The type-to-confirm prompt (web `t('commands.confirm.typeToConfirm', { word })`): the template
    /// with `{{word}}` substituted by the required string. Empty when no typed gate is set.
    public static func typeToConfirmLabel(
        confirmInput: String?,
        localize: (String, String) -> String
    ) -> String {
        guard hasTypedGate(confirmInput: confirmInput), let confirmInput else { return "" }
        return localize(Keys.typeToConfirm, Fallbacks.typeToConfirm)
            .replacingOccurrences(of: "{{word}}", with: confirmInput)
    }
}
