//
//  CommandSelectDialog.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  The testable, dependency-free projection core for the command option-picker dialog — the faithful
//  port of features/system/components/CommandSelectDialog.tsx. The web source is a focus-trapped
//  `Modal` that lets the user pick one value for a vehicle command that carries a `selectConfig`
//  (e.g. "Set seat heater level", "Open the trunk vs the frunk"): a header (the command icon + its
//  translated label) and a vertical list of option buttons (each an already-translated label + an
//  optional description), all disabled while the parent's command dispatch is in flight (`loading`),
//  with a trailing Cancel. Selecting an option fires `onSelect(value)`; Cancel / Escape fire
//  `onClose`.
//
//  Everything here is pure Foundation so the render-phase resolution, the resolved visibility, the
//  option projection, and the caller-label fallback are unit-tested without a store, a bundle, or a
//  rendered view.
//
//  Web parity notes:
//    • `def.selectConfig!.options` (`{ value, labelKey, labelFallback, description? }`) →
//      `[CommandSelectOption]`. The web resolves `t(opt.labelKey, opt.labelFallback)` at render; the
//      native registry adapter resolves the same keys upstream and delivers already-localized
//      `label` text as data (the same way ConfirmDialog delivers its title / message), so the view
//      holds no dynamic `t()` calls.
//    • `t(def.labelKey, def.labelFallback)` (the dialog title) → `CommandSelectRequest.title` (data).
//    • `def.icon` (a Lucide icon) → `CommandSelectRequest.iconSystemName` (an SF Symbol, data).
//    • the `loading` prop (disables every option) → `CommandSelectRequest.loading`, combined in the
//      model with its own in-flight `submittingValue` into `isBusy`.
//    • `t('common.cancel', 'Cancel')` (the only literal `t()` in the source) → `Keys.cancel` /
//      `Fallbacks.cancel`, resolved through the i18n facade.
//    • the web only ever renders the option list; `resolvePhase` widens that into the prompt-required
//      loading / empty / error envelopes so no state is ever a blank panel, and `resolveVisibility`
//      reproduces the web early-return (the `Modal` renders only while `open`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum CommandSelectSurface {
    public static let slug = "CommandSelectDialog"
}

// MARK: - Load status / render phase / freshness

/// The bound source's delivery status for the select request (web parent-supplied `open` + `def`).
/// The request is normally pushed synchronously; the loading / failed arms exist so an
/// intentionally-presented dialog renders real chrome rather than a blank box while it resolves.
public enum CommandSelectLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): drives the freshness chip + cached-data banner so an option list
/// assembled from a cached command context is clearly labeled while reconnecting / offline.
public enum CommandSelectConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web early-returns (renders the `Modal` only while
/// `open`); `hidden` models that, and `presented` shows the dialog (whose body switches over `phase`).
public enum CommandSelectVisibility: Sendable, Equatable {
    case hidden
    case presented
}

/// What the presented dialog body renders. The web only ever shows the option list; the loading /
/// empty / error envelopes are added so an intentionally-presented dialog is never a blank box.
public enum CommandSelectPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Select option + request (web `SelectOption` / props)

/// One selectable option — the projection of the web `SelectOption` the dialog renders: the value
/// sent to `onSelect`, the already-translated label (web `t(opt.labelKey, opt.labelFallback)`), and
/// the optional description line (web `opt.description`).
public struct CommandSelectOption: Sendable, Equatable, Identifiable {
    public let value: String
    public let label: String
    public let description: String?

    /// The option's stable identity is its command value (web `key={opt.value}`).
    public var id: String {
        value
    }

    public init(value: String, label: String, description: String? = nil) {
        self.value = value
        self.label = label
        self.description = description
    }
}

/// One option-picker prompt the source delivers — the projection of the web `CommandSelectDialogProps`
/// (the resolved `def` + the `loading` flag). `title` + each option `label` arrive already-translated
/// as data; `iconSystemName` is the SF Symbol parity of the Lucide `def.icon`; `loading` mirrors the
/// web `loading` prop (the parent keeps the dialog open + the options disabled while a command is in
/// flight).
public struct CommandSelectRequest: Sendable, Equatable {
    public let id: String
    public let title: String
    public let iconSystemName: String
    public let options: [CommandSelectOption]
    public let loading: Bool

    public init(
        id: String,
        title: String,
        iconSystemName: String = CommandSelectProjection.defaultIcon,
        options: [CommandSelectOption],
        loading: Bool = false
    ) {
        self.id = id
        self.title = title
        self.iconSystemName = iconSystemName.isEmpty ? CommandSelectProjection.defaultIcon : iconSystemName
        self.options = options
        self.loading = loading
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution shared by the model and tests: the resolved visibility + body
/// phase, the inline-failure envelope, and the caller-label fallbacks. All copy resolves through an
/// injected localizer so it stays bundle-free.
public enum CommandSelectProjection {
    /// The fallback SF Symbol for a command with no icon mapping — a generic "options" glyph (the
    /// native parity of a select-style command tile).
    public static let defaultIcon = "slider.horizontal.3"

    /// The localization keys the dialog resolves. `cancel` is the verbatim web source key
    /// (`t('common.cancel', 'Cancel')`); the rest back the native state envelope + VoiceOver.
    public enum Keys {
        public static let cancel = "common.cancel"
        public static let dialog = "command.select.a11y.dialog"
        public static let loading = "command.select.loading"
        public static let empty = "command.select.empty"
        public static let emptyMessage = "command.select.emptyMessage"
        public static let errorTitle = "command.select.errorTitle"
        public static let retry = "command.select.retry"
    }

    /// The English fallbacks for the keys above (web `t()` defaults + the native chrome copy).
    public enum Fallbacks {
        public static let cancel = "Cancel"
        public static let dialog = "Select an option"
        public static let loading = "Loading options…"
        public static let empty = "No options available"
        public static let emptyMessage = "This command has no options to choose from."
        public static let errorTitle = "Couldn't load options"
        public static let retry = "Retry"
    }

    /// The presented dialog's body phase. A request with options shows the option list; a resolved
    /// request with no options shows the empty state (web would render an empty list); otherwise the
    /// loading / error envelope renders so the dialog is never blank. A delivered request survives a
    /// failed reload (the failure is surfaced inline by `inlineFailure`).
    public static func resolvePhase(
        status: CommandSelectLoadStatus,
        hasRequest: Bool,
        hasOptions: Bool
    ) -> CommandSelectPhase {
        guard hasRequest else {
            switch status {
            case .loading: return .loading
            case .loaded: return .empty
            case let .failed(message): return .error(message)
            }
        }
        return hasOptions ? .content : .empty
    }

    /// The web early-return resolved to a rendered surface. With no request the dialog is hidden (web
    /// `open` is false). `pinned` models an intentionally-presented dialog: it suppresses the ambient
    /// hide so loading / empty / error chrome still renders rather than vanishing (engineering
    /// guideline #6).
    public static func resolveVisibility(hasRequest: Bool, pinned: Bool) -> CommandSelectVisibility {
        (hasRequest || pinned) ? .presented : .hidden
    }

    /// The failure message kept on screen while a delivered request survives a failed reload (the
    /// inline error shown above the option list), else `nil`.
    public static func inlineFailure(status: CommandSelectLoadStatus, hasRequest: Bool) -> String? {
        guard hasRequest, case let .failed(message) = status else { return nil }
        return message
    }

    /// The Cancel button label (web `t('common.cancel', 'Cancel')`).
    public static func cancelLabel(localize: (String, String) -> String) -> String {
        localize(Keys.cancel, Fallbacks.cancel)
    }

    /// The dialog title for display + VoiceOver: the request title, else the localized "Select an
    /// option" fallback when a request carries no title.
    public static func title(_ request: CommandSelectRequest?, localize: (String, String) -> String) -> String {
        guard let title = request?.title, !title.isEmpty else {
            return localize(Keys.dialog, Fallbacks.dialog)
        }
        return title
    }
}
