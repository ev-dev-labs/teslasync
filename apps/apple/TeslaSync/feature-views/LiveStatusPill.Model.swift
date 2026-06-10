//
//  LiveStatusPill.Model.swift
//  TeslaSync — P4 feature view · 0249 · LiveStatusPill (Apple)
//
//  The pure, host-free projection of a `LiveStatusPill`'s inputs into the
//  structural decisions the view renders — the native parity of the web
//  component's three connection tones and its relative-time ladder
//  (web/src/features/system/components/status/LiveStatusPill.tsx).
//
//  The web source carries exactly these branches, all reproduced here:
//
//    • the `TONE` record keyed by `StatusLiveState`
//      (`live` → green + Activity, `reconnecting` → amber + pulsing Wifi,
//      `offline` → grey + WifiOff) — see ``LiveStatusState``,
//    • the `relative(now, lastUpdateAt)` ladder
//      (`null → "—"`, `< 5s → "just now"`, `< 60s → "{s}s ago"`,
//      `< 1h → "{m}m ago"`, else `"{h}h ago"`) — see ``LiveStatusRelative``,
//    • the composed `aria-label`
//      (`"Live status stream: {label}, updated {rel}"`) — see
//      ``LiveStatusPillStrings/accessibilityLabel(stateLabel:relative:)``.
//
//  LiveStatusPill is a pure presentational chip — it owns no data, exactly like
//  the web component — so the loading / empty / error / stale states belong to
//  whatever surface embeds the pill. The connection-level `offline` state and
//  the `lastUpdateAt == nil` "no update yet" case (web `"—"`) are the branches
//  the pill itself carries, and both are reproduced in full.
//
//  Keeping these decisions in `Equatable` value types lets the XCTest suite
//  cover every configuration (and the accessibility policy) without a rendering
//  host — the same approach the sibling presentational surfaces use.
//

import SwiftUI

// MARK: - Surface identity

/// Stable, non-identifying identity for the `LiveStatusPill` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is referenced by both the view and its tests so the two never drift.
public enum LiveStatusPillSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "LiveStatusPill"

    /// Reports the surface becoming visible. This is the exact code path the
    /// view runs from its `.task`, factored out so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any LiveStatusPillTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Connection state (web `StatusLiveState` + `TONE` map)

/// The SSE connection state the pill reflects — the native parity of the web
/// `StatusLiveState` union (`'live' | 'reconnecting' | 'offline'`) defined in
/// `useStatusLiveSSE`. The visual mapping (web `TONE[state]`) is carried by the
/// computed properties below so the lookup and the type stay in one place.
public enum LiveStatusState: String, CaseIterable, Sendable {
    /// SSE flowing — web `live` (green dot, Activity glyph, no pulse).
    case live
    /// Last open errored, backing off — web `reconnecting` (amber, pulsing Wifi).
    case reconnecting
    /// Gave up after backoff — web `offline` (grey, WifiOff).
    case offline

    /// The accent color, mirroring the web `TONE[...].cls` hue: `live` → green
    /// (`statusSuccess`), `reconnecting` → amber (`statusWarning`), `offline` →
    /// grey (`textMuted`). Resolved from generated design tokens so the hue is
    /// theme- and high-contrast-aware.
    public var tint: Color {
        switch self {
        case .live: Color.TS.statusSuccess
        case .reconnecting: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    /// Whether the status dot pulses — web `TONE[...].pulse`, true only for
    /// `reconnecting` (web `animate-pulse`).
    public var pulses: Bool {
        self == .reconnecting
    }

    /// The leading glyph — the native analogue of the web Lucide icon:
    /// `live` → `Activity` (`waveform.path.ecg`), `reconnecting` → `Wifi`
    /// (`wifi`), `offline` → `WifiOff` (`wifi.slash`).
    public var iconSystemName: String {
        switch self {
        case .live: "waveform.path.ecg"
        case .reconnecting: "wifi"
        case .offline: "wifi.slash"
        }
    }

    /// The per-surface i18n key for the state label (web `TONE[...].label`).
    public var labelKey: String {
        switch self {
        case .live: "liveStatusPill.state.live"
        case .reconnecting: "liveStatusPill.state.reconnecting"
        case .offline: "liveStatusPill.state.offline"
        }
    }

    /// The English fallback for the state label (web `TONE[...].label`), used
    /// when the localized table is absent (tests / standalone builds).
    public var labelFallback: String {
        switch self {
        case .live: "Live"
        case .reconnecting: "Reconnecting"
        case .offline: "Offline"
        }
    }
}

// MARK: - Relative time (web `relative(now, lastUpdateAt)`)

/// The native parity of the web `relative(now, lastUpdateAt)` bucketer. The web
/// component receives `now` and `lastUpdateAt` as epoch-millisecond numbers (the
/// `now` is a tick the parent advances so the label re-renders); this models the
/// same numeric contract so the magnitude + unit are unit-tested without any
/// localized prose.
public enum LiveStatusRelative: Equatable, Sendable {
    /// `lastUpdateAt == nil` — web returns the em dash `"—"`.
    case none
    /// `secs < 5` — web `"just now"`.
    case justNow
    /// `secs < 60` — web `"{secs}s ago"`.
    case seconds(Int)
    /// `secs < 3600` — web `"{floor(secs / 60)}m ago"`.
    case minutes(Int)
    /// otherwise — web `"{floor(secs / 3600)}h ago"`.
    case hours(Int)

    /// Buckets the elapsed time exactly as the web `relative(now, lastUpdateAt)`:
    /// `secs = max(0, floor((now - lastUpdateAt) / 1000))`, then the `< 5 / < 60 /
    /// < 3600 / else` ladder. A `nil` `lastUpdateAt` (web `== null`) maps to
    /// ``none``; negative elapsed (clock skew) clamps to `0` ⇒ ``justNow``.
    ///
    /// - Parameters:
    ///   - now: the current instant, epoch milliseconds (web `now`).
    ///   - lastUpdateAt: the last delivery instant, epoch milliseconds, or `nil`.
    public static func bucket(now: Double, lastUpdateAt: Double?) -> LiveStatusRelative {
        guard let last = lastUpdateAt else { return .none }
        let elapsedMs = now - last
        guard elapsedMs.isFinite else { return .justNow }
        let secs = Swift.max(0, Int((elapsedMs / 1000).rounded(.down)))
        if secs < 5 { return .justNow }
        if secs < 60 { return .seconds(secs) }
        if secs < 3600 { return .minutes(secs / 60) }
        return .hours(secs / 3600)
    }
}

// MARK: - Localization facade (P1/S10)

/// Resolves the surface's strings by key with the web English fallback, so the
/// Swift sources hold no hardcoded prose. Keys live in the "LiveStatusPill"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time. In tests / preview bundles (where the table is absent) `NSLocalizedString`
/// returns the `value:` fallback, keeping the projection deterministic.
///
/// The web source renders three literal labels (`Live` / `Reconnecting` /
/// `Offline`), the relative-time strings, and the composed `aria-label`; every
/// one is keyed here so no English literal survives in native code.
public enum LiveStatusPillStrings {
    public static let table = "LiveStatusPill"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments.
    /// The template is localized first, so translators control word order around
    /// the numbers.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }

    /// The localized state label (web `TONE[state].label`).
    public static func label(_ state: LiveStatusState) -> String {
        string(state.labelKey, state.labelFallback)
    }

    /// The localized relative-time label (web `relative(...)` return value).
    public static func relativeLabel(_ bucket: LiveStatusRelative) -> String {
        switch bucket {
        case .none:
            string("liveStatusPill.relative.none", "—")
        case .justNow:
            string("liveStatusPill.relative.justNow", "just now")
        case let .seconds(value):
            format("liveStatusPill.relative.seconds", "%@s ago", String(value))
        case let .minutes(value):
            format("liveStatusPill.relative.minutes", "%@m ago", String(value))
        case let .hours(value):
            format("liveStatusPill.relative.hours", "%@h ago", String(value))
        }
    }

    /// The composed VoiceOver label — web
    /// `aria-label={`Live status stream: ${tone.label}, updated ${rel}`}`.
    public static func accessibilityLabel(stateLabel: String, relative: String) -> String {
        format("liveStatusPill.a11y.label", "Live status stream: %1$@, updated %2$@", stateLabel, relative)
    }
}

// MARK: - Presentation (pure projection of the inputs → render config)

/// The pure, `Equatable` projection of a `LiveStatusPill`'s inputs (`state`,
/// `now`, `lastUpdateAt`) into the render decisions: the resolved tone and the
/// bucketed relative time. Mirrors the web component's derived values
/// (`tone = TONE[state]`, `rel = relative(now, lastUpdateAt)`).
public struct LiveStatusPillPresentation: Equatable, Sendable {
    /// The connection state (web `state`); drives the tint, glyph, pulse, label.
    public let state: LiveStatusState
    /// The bucketed relative time (web `rel`).
    public let relative: LiveStatusRelative

    public init(state: LiveStatusState, now: Double, lastUpdateAt: Double?) {
        self.state = state
        relative = LiveStatusRelative.bucket(now: now, lastUpdateAt: lastUpdateAt)
    }

    /// The accent color (web `TONE[state].cls` hue).
    public var tint: Color {
        state.tint
    }

    /// Whether the status dot pulses (web `TONE[state].pulse`).
    public var pulses: Bool {
        state.pulses
    }

    /// The leading glyph name (web Lucide `Icon`).
    public var iconSystemName: String {
        state.iconSystemName
    }

    /// The localized state label (web `tone.label`).
    public var labelText: String {
        LiveStatusPillStrings.label(state)
    }

    /// The localized relative-time text (web `rel`).
    public var relativeText: String {
        LiveStatusPillStrings.relativeLabel(relative)
    }

    /// The composed VoiceOver label (web `aria-label`).
    public var accessibilityLabel: String {
        LiveStatusPillStrings.accessibilityLabel(stateLabel: labelText, relative: relativeText)
    }

    /// The diagnostics slug this presentation belongs to.
    public var surfaceSlug: String {
        LiveStatusPillSurface.slug
    }
}
