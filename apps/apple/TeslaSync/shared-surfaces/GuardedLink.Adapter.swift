//
//  GuardedLink.Adapter.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  The testable, dependency-light core for the navigation-guard link — the SwiftUI parity of
//  `components/feedback/GuardedLink.tsx`. Everything here is pure (Foundation only): the navigation
//  destination + the forwarded react-router options (`replace` / `relative` / `state`), the activation
//  value type (the native shape of the web click event), the guard-bypass decision (the verbatim port
//  of the web `shouldSkipGuard`), and the VoiceOver hint builder. No router, no bundle, no rendered
//  view, so each piece is unit tested in isolation.
//
//  Parity note: the web `GuardedLink` is a drop-in `<Link>` replacement. On a primary click it runs the
//  caller's `onClick`, bails for modifier / middle clicks and `target="_blank"` (so opening in a new
//  tab keeps the dirty form mounted in the current tab), and otherwise calls `confirmIfDirty()` before
//  `navigate(to, { replace, state, relative })`. This core reproduces those pure derivations as values
//  and functions; the SwiftUI chrome and the confirm flow layer on top in the sibling files.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias GuardedResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Destination (web `to: To`)

/// The link's navigation target — the native mirror of the web `to` prop (`react-router`'s `To`). The
/// common case is an in-app route path; an empty path is the native parity of a missing/blank `to`
/// (which renders the friendly empty leaf instead of a broken link).
public struct GuardedDestination: Sendable, Equatable {
    /// The in-app route path, e.g. "/automations" (web `to`). Trimmed on init.
    public let path: String

    public init(path: String) {
        self.path = path.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// True when no usable destination was supplied (the empty-leaf trigger).
    public var isEmpty: Bool {
        path.isEmpty
    }
}

// MARK: - Navigation options (web `{ replace, relative, state }`)

/// The relative-routing mode forwarded to `navigate` — the native parity of react-router's
/// `RelativeRoutingType` (`'route' | 'path'`).
public enum GuardedRelativeRouting: String, Sendable, Equatable, CaseIterable {
    case route
    case path
}

/// The navigation options `GuardedLink` forwards to `navigate(to, options)` — the native parity of the
/// web `replace` / `relative` / `state` props it threads through. `state` is modelled as a string map
/// (the serialisable subset of the web history `state`) so the value stays `Sendable` + `Equatable`.
public struct GuardedNavigationOptions: Sendable, Equatable {
    public var replace: Bool
    public var relative: GuardedRelativeRouting?
    public var state: [String: String]?

    public init(
        replace: Bool = false,
        relative: GuardedRelativeRouting? = nil,
        state: [String: String]? = nil
    ) {
        self.replace = replace
        self.relative = relative
        self.state = state
    }
}

// MARK: - Activation modifiers (web `e.metaKey | ctrlKey | shiftKey | altKey`)

/// The modifier keys held during an activation — the native mirror of the web mouse-event modifier
/// flags. Any held modifier bypasses the guard (the browser opens in a new tab / window natively, so
/// the dirty form stays put), exactly as the web `shouldSkipGuard` returns early for them.
public struct GuardedActivationModifiers: OptionSet, Sendable, Equatable {
    public let rawValue: Int
    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    /// Web `metaKey` (⌘ on Apple platforms).
    public static let command = GuardedActivationModifiers(rawValue: 1 << 0)
    /// Web `ctrlKey`.
    public static let control = GuardedActivationModifiers(rawValue: 1 << 1)
    /// Web `shiftKey`.
    public static let shift = GuardedActivationModifiers(rawValue: 1 << 2)
    /// Web `altKey` (⌥).
    public static let option = GuardedActivationModifiers(rawValue: 1 << 3)

    /// Web: `if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return true`.
    public var bypassesGuard: Bool {
        !isEmpty
    }
}

// MARK: - Link target (web `target` prop)

/// Where the activation would open — the native parity of the web `target` prop. `sameContext`
/// (web `''` / `'_self'`) runs the guard; `newContext` (web `'_blank'` and friends) bypasses it so the
/// current window keeps its unsaved work.
public enum GuardedLinkTarget: Sendable, Equatable {
    case sameContext
    case newContext

    /// Maps a raw web `target` string to the native target — `nil` / `""` / `"_self"` stay in-context,
    /// every other value (e.g. `"_blank"`) opens a new context. Mirrors the web
    /// `target && target !== '' && target !== '_self'` test.
    public init(rawTarget: String?) {
        guard let rawTarget, !rawTarget.isEmpty, rawTarget != "_self" else {
            self = .sameContext
            return
        }
        self = .newContext
    }
}

// MARK: - Activation (web click event)

/// One link activation — the native shape of the web `MouseEvent` `GuardedLink` inspects before
/// deciding whether to guard. `isPreempted` mirrors the web `e.defaultPrevented` (the caller's
/// `onClick` already handled it); `isPrimary` mirrors `e.button === 0` (a non-primary press, like a
/// middle click, opens natively and bypasses the guard).
public struct GuardedActivation: Sendable, Equatable {
    public var modifiers: GuardedActivationModifiers
    public var isPrimary: Bool
    public var target: GuardedLinkTarget
    public var isPreempted: Bool

    public init(
        modifiers: GuardedActivationModifiers = [],
        isPrimary: Bool = true,
        target: GuardedLinkTarget = .sameContext,
        isPreempted: Bool = false
    ) {
        self.modifiers = modifiers
        self.isPrimary = isPrimary
        self.target = target
        self.isPreempted = isPreempted
    }

    /// A plain primary activation (left-click, no modifiers, same context) — the guarded happy path.
    public static let primary = GuardedActivation()

    /// The "open in a new window/scene" affordance — the Apple-idiomatic parity of a ⌘-click or
    /// `target="_blank"`: it bypasses the guard so the current editor keeps its unsaved work.
    public static let newContext = GuardedActivation(target: .newContext)

    /// A caller-consumed activation (web `e.defaultPrevented`) — neither guard nor navigation runs.
    public static let preempted = GuardedActivation(isPreempted: true)
}

// MARK: - Guard decision (web `shouldSkipGuard`)

/// The pure guard-bypass decision — the VERBATIM port of the web `shouldSkipGuard`:
///
///     function shouldSkipGuard(e, target) {
///       if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return true
///       if (e.button !== 0) return true
///       if (target && target !== '' && target !== '_self') return true
///       return false
///     }
///
/// When this returns true the activation opens natively (a new window/scene) and the guard is skipped
/// so the dirty form stays mounted in the current context. Pure + public so every branch is asserted.
public enum GuardDecision {
    public static func shouldSkipGuard(_ activation: GuardedActivation) -> Bool {
        if activation.modifiers.bypassesGuard {
            return true
        }
        if !activation.isPrimary {
            return true
        }
        if activation.target == .newContext {
            return true
        }
        return false
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the link's VoiceOver hint from the already-localised strings, so the spoken affordance is
/// asserted without rendering. The link's accessible NAME is its label (supplied by the caller, the
/// web `children`); the hint announces the guard behaviour — a guarded link warns that it confirms
/// before discarding unsaved work, matching the web confirm flow.
public enum GuardedAccessibility {
    public static func hint(isDirty: Bool, strings: GuardedResolve = GuardedLinkStrings.string) -> String {
        isDirty
            ? strings("guardedLink.a11yHintGuarded", "Confirms unsaved changes before navigating")
            : strings("guardedLink.a11yHint", "Navigates within the app")
    }

    /// Normalises a label/message for a spoken element — collapses internal whitespace runs and trims
    /// the ends so a wrapped label never reads a double space.
    public static func normalize(_ text: String) -> String {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
