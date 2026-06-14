//
//  Toast.Adapter.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  The testable, dependency-light core for the transient toast surface — the SwiftUI parity of
//  `components/feedback/Toast.tsx`. Everything here is pure (Foundation only): the toast severity kind
//  (web `ToastType`), the closure-free descriptor (web `Toast` minus its handler), the severity
//  presentation (the port of the web `icons` / `styles` / `ariaRole` maps), the bounded-queue reducer
//  (the port of the web `[...prev.slice(-4), toast]` cap), the auto-dismiss arithmetic (web
//  `opts.duration ?? 4000` + the `duration > 0` guard), and the VoiceOver label builder. No store, no
//  bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface is a context provider (`ToastProvider`) plus the `useToast` /
//  `useOptionalToast` hooks. A call site fires `toast.success(title, message)`; the provider appends an
//  id'd toast (capped to the five newest), auto-dismisses it after 4s, and renders the stack bottom-right.
//  This core reproduces the pure derivations as values and functions; the observable store lives in
//  Toast.Model.swift and the SwiftUI chrome in the sibling view files.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum ToastSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Toast"
}

// MARK: - Localization seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `useTranslation` `t(key, default)`
/// call. Kept as a plain closure so the pure core needs no bundle: the production app passes the P1/S10
/// facade, while tests pass the identity-fallback resolver.
public typealias ToastResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Kind (web `ToastType`)

/// The toast severity — the native mirror of the web `ToastType` union (`success | error | info |
/// warning`). Drives the icon, the tint, and the announcement assertiveness.
public enum ToastKind: String, Sendable, Equatable, CaseIterable {
    case success
    case error
    case info
    case warning
}

// MARK: - Announcement role (web `ariaRole` / `aria-live`)

/// The screen-reader announcement role — the native peer of the web `role="alert"` (assertive) vs
/// `role="status"` (polite). Errors interrupt; the rest announce politely (web `ariaRole` map).
public enum ToastRole: String, Sendable, Equatable {
    case alert
    case status

    /// The matching `aria-live` politeness (web `role === 'alert' ? 'assertive' : 'polite'`).
    public var isAssertive: Bool {
        self == .alert
    }
}

// MARK: - Tint (web `styles` border/icon color, semantic not literal)

/// The semantic accent for a kind — the native peer of the web per-kind `styles` (border + icon color),
/// mapped to a brand status token rather than a literal Tailwind shade (ADR-006). The view layer resolves
/// each case to `Color.TS.status*`, so the toast reads correctly in light, dark, and high-contrast themes.
public enum ToastTint: String, Sendable, Equatable {
    case success
    case danger
    case info
    case warning
}

// MARK: - Action style (web discriminated `ToastAction`)

/// Which affordance a toast's optional action renders — the native peer of the web `ToastAction`
/// discriminated union: a `navigation` link (web `{ label, to }` → `<Link>`) or a `callback` button (web
/// `{ label, onClick }` → `<button>`). When a call site supplies both, the navigation form wins so
/// existing call-sites stay intact (web comment).
public enum ToastActionStyle: String, Sendable, Equatable {
    case navigation
    case callback
}

// MARK: - Descriptor (web `Toast`, closure-free)

/// One toast's view-ready, closure-free description — the native peer of the web `Toast` value minus its
/// action handler (carried by ``ToastAction`` in the model layer). A pure value so the projection + the
/// queue + the VoiceOver label are asserted without a store or a clock.
public struct ToastDescriptor: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: ToastKind
    public let title: String
    /// Web `t.message` — the optional secondary line.
    public let message: String?
    /// Web `opts.duration ?? 4000` — already resolved to a concrete value in milliseconds.
    public let durationMilliseconds: Int
    /// The visible action label (web `action.label`), or `nil` when the toast has no action.
    public let actionLabel: String?
    /// Which affordance the action renders, or `nil` when there is no action.
    public let actionStyle: ToastActionStyle?

    public init(
        id: String,
        kind: ToastKind,
        title: String,
        message: String? = nil,
        durationMilliseconds: Int = ToastDuration.defaultMilliseconds,
        actionLabel: String? = nil,
        actionStyle: ToastActionStyle? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.message = message
        self.durationMilliseconds = durationMilliseconds
        self.actionLabel = actionLabel
        self.actionStyle = actionStyle
    }
}

// MARK: - Presentation (web `icons` / `styles` / `ariaRole`)

/// The pure per-kind presentation — the native port of the web `icons`, `styles`, and `ariaRole` maps.
/// SwiftUI-free: it yields an SF Symbol name, a semantic ``ToastTint``, and a ``ToastRole`` that the view
/// layer renders, so every mapping is asserted in one place without rendering.
public enum ToastPresentation {
    /// Web `icons[type]` → the HIG-idiomatic SF Symbol peer of each lucide glyph
    /// (CheckCircle / AlertCircle / Info / AlertTriangle).
    public static func iconSystemName(for kind: ToastKind) -> String {
        switch kind {
        case .success: "checkmark.circle.fill"
        case .error: "exclamationmark.circle.fill"
        case .info: "info.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        }
    }

    /// Web `styles[type]` accent → the semantic status tint (success/danger/info/warning).
    public static func tint(for kind: ToastKind) -> ToastTint {
        switch kind {
        case .success: .success
        case .error: .danger
        case .info: .info
        case .warning: .warning
        }
    }

    /// Web `ariaRole[type]` → `alert` for errors (assertive), `status` for the rest (polite).
    public static func role(for kind: ToastKind) -> ToastRole {
        kind == .error ? .alert : .status
    }

    /// Convenience — whether the kind announces assertively (web `aria-live="assertive"`).
    public static func isAssertive(for kind: ToastKind) -> Bool {
        role(for: kind).isAssertive
    }
}

// MARK: - Duration (web `opts.duration ?? 4000`)

/// The toast's auto-dismiss arithmetic — the web default (`opts.duration ?? 4000`) plus the `duration > 0`
/// guard that distinguishes an auto-dismissing toast from a sticky one. Pure so the timing is asserted
/// without a real clock.
public enum ToastDuration {
    /// Web `const duration = opts.duration ?? 4000`.
    public static let defaultMilliseconds = 4000

    /// Resolves an optional caller duration to a concrete value (web `?? 4000`).
    public static func resolve(_ milliseconds: Int?) -> Int {
        milliseconds ?? defaultMilliseconds
    }

    /// Web `if (duration > 0) setTimeout(...)` — a non-positive duration disables auto-dismiss.
    public static func isAutoDismissing(_ milliseconds: Int) -> Bool {
        milliseconds > 0
    }

    /// Converts a millisecond duration to the seconds the scheduler sleeps, clamped at zero.
    public static func seconds(_ milliseconds: Int) -> TimeInterval {
        max(0, Double(milliseconds) / 1000.0)
    }
}

// MARK: - Queue (web `[...prev.slice(-4), toast]`)

/// The toast queue's pure reducer — the port of the web `setToasts(prev => [...prev.slice(-4), toast])`
/// cap (keep at most the five newest, appended oldest-first) and the `dismiss` filter. Generic over any
/// id'd item so it is exercised by both the closure-free ``ToastDescriptor`` (tests) and the live
/// ``ToastItem`` (the store).
public enum ToastQueue {
    /// Web cap: `prev.slice(-4)` keeps the four newest, then the new toast is appended → five at most.
    public static let capacity = 5

    /// Appends a toast and trims to the newest `capacity` — the verbatim port of
    /// `[...prev.slice(-4), toast]` (`(prev + [toast]).suffix(capacity)`).
    public static func appending<Item: Identifiable>(
        _ item: Item,
        to items: [Item],
        capacity: Int = capacity
    ) -> [Item] where Item.ID == String {
        Array((items + [item]).suffix(capacity))
    }

    /// Drops the toast with the matching id, preserving the order of the rest (web `dismiss`).
    public static func removing<Item: Identifiable>(
        id: String,
        from items: [Item]
    ) -> [Item] where Item.ID == String {
        items.filter { $0.id != id }
    }
}

// MARK: - Accessibility (testable seam)

/// Builds a toast's combined VoiceOver label from already-localised parts, so the spoken content is
/// asserted without rendering. The web conveys severity through the ARIA role; VoiceOver has no equivalent
/// implicit cue, so the native surface names it — the localized severity word, the title, then the
/// message, read in one polite/assertive pass.
public enum ToastAccessibility {
    /// "{severity}: {title}. {message}" — joined so a terminal period is never doubled and empty parts are
    /// skipped. `severity` is the already-localised spoken word for the kind.
    public static func label(severity: String, title: String, message: String?) -> String {
        var label = severity
        if !title.isEmpty {
            label += label.isEmpty ? title : ": \(title)"
        }
        if let message, !message.isEmpty {
            if label.isEmpty {
                label = message
            } else {
                let endsWithTerminal = label.last.map { ".!?".contains($0) } ?? false
                label += (endsWithTerminal ? " " : ". ") + message
            }
        }
        return label
    }
}
