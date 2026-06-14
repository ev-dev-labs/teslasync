//
//  WidgetShell.Model.swift
//  TeslaSync — P4 widget primitive · 0013 · WidgetShell (Apple)
//
//  Pure (SwiftUI-free) model, render-state decisions, freshness logic, accessibility, i18n facade
//  and telemetry seam for the WidgetShell primitive — the native parity of
//  features/dashboard/widgets/WidgetShell.tsx. Keeping these Foundation-only lets the projection /
//  decision logic compile and unit-test on a plain host; the SwiftUI chrome layers on top in
//  WidgetShell.swift (+ subviews in WidgetShell.Views.swift).
//
//  WidgetShell is the shared widget-chrome building block: it wraps a caller-supplied content slot
//  with an optional titled header (icon + title + contextual "?" help + data-freshness chip + pin +
//  actions), renders the loading skeleton and the query-error state, and pulses softly when the data
//  timestamp changes. It owns no networking and no data source — every input is supplied by the
//  hosting widget (web: a pure presentational component).
//

import Foundation
import OSLog

// MARK: - Contextual help metadata (web `WidgetHelp` from widgets/types.ts)

/// A "Learn more" link rendered under the help body — the native port of the web
/// `learnMore?: { url; label? }`.
public struct WidgetHelpLink: Equatable, Sendable {
    public let url: URL
    public let label: String?

    public init(url: URL, label: String? = nil) {
        self.url = url
        self.label = label
    }
}

/// Metadata describing a widget's contextual help — the native port of the web `WidgetHelp`
/// (`{ text?, i18nKey?, defaultValue?, learnMore? }`). Resolution mirrors the web `HelpTooltip`:
/// prefer the translated `i18nKey` (with `defaultValue` fallback), else the literal `text`; an empty
/// result yields `nil` so the host can omit the affordance entirely (web `if (!resolved) return null`).
public struct WidgetHelp: Equatable, Sendable {
    public let text: String?
    public let i18nKey: String?
    public let defaultValue: String?
    public let learnMore: WidgetHelpLink?

    public init(
        text: String? = nil,
        i18nKey: String? = nil,
        defaultValue: String? = nil,
        learnMore: WidgetHelpLink? = nil
    ) {
        self.text = text
        self.i18nKey = i18nKey
        self.defaultValue = defaultValue
        self.learnMore = learnMore
    }

    /// Web `resolved = i18nKey ? t(i18nKey, defaultValue ?? '') : (text ?? '')`, returning `nil` for
    /// the empty result so the help button is omitted. `localize` is the P1/S10 facade
    /// `(key, fallback) -> String`, injected so this stays SwiftUI-free and unit-testable.
    public func resolvedText(localize: (_ key: String, _ fallback: String) -> String) -> String? {
        let resolved: String = if let i18nKey, !i18nKey.isEmpty {
            localize(i18nKey, defaultValue ?? "")
        } else {
            text ?? ""
        }
        return resolved.isEmpty ? nil : resolved
    }
}

// MARK: - Render state (web `if (loading) … ; if (error) …`)

/// The top-level render branch the shell resolves before drawing chrome, mirroring the web early
/// returns: `loading` wins over `error`, otherwise the titled/title-less content surface renders.
public enum WidgetShellState: Equatable, Sendable {
    case loading
    case error
    case ready

    /// Web precedence: `if (loading) return <Skeleton/>; if (error) return <QueryError/>;`. An empty
    /// error string is falsy in JS, so it is treated as "no error" (→ `ready`).
    public static func resolve(loading: Bool, error: String?) -> WidgetShellState {
        if loading { return .loading }
        if let error, !error.isEmpty { return .error }
        return .ready
    }
}

// MARK: - Data-freshness status (web `DataFreshness` four-state machine)

/// The freshness chip's status, mapped from a TanStack-Query-like result exactly as the web
/// `DataFreshness` does: `isError → error`, else `isFetching → fetching`, else `isStale → stale`,
/// else `fresh`.
public enum WidgetShellFreshnessStatus: String, Equatable, Sendable, CaseIterable {
    case fresh
    case fetching
    case stale
    case error

    public static func resolve(isError: Bool, isFetching: Bool, isStale: Bool) -> WidgetShellFreshnessStatus {
        if isError { return .error }
        if isFetching { return .fetching }
        if isStale { return .stale }
        return .fresh
    }

    /// P1/S10 key for the spoken status word (web embeds the raw status in `a11y.dataFreshness`).
    public var localizationKey: String {
        "freshness.status.\(rawValue)"
    }
}

// MARK: - Relative-time bucket (web `formatRelativeTime`)

/// A coarse "time since update" bucket — the SwiftUI-free core of the web `formatRelativeTime`
/// (`<60s → just now`, `<60m → Nm`, `<24h → Nh`, `<7d → Nd`, else `Nw`). The view resolves the bucket
/// to a localized string at the display boundary (P1/S10), keeping the threshold logic testable.
public enum WidgetShellRelativeTimeBucket: Equatable, Sendable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)
    case weeks(Int)

    public static func bucket(updatedAtMillis: Double, nowMillis: Double) -> WidgetShellRelativeTimeBucket {
        // Web `Math.floor((Date.now() - ms) / 1000)`.
        let seconds = Int(floor((nowMillis - updatedAtMillis) / 1000.0))
        if seconds < 60 { return .justNow }
        if seconds < 3600 { return .minutes(seconds / 60) }
        if seconds < 86400 { return .hours(seconds / 3600) }
        if seconds < 604_800 { return .days(seconds / 86400) }
        return .weeks(seconds / 604_800)
    }
}

// MARK: - Freshness label composition (web `relativeTime` ternary)

/// What the freshness chip shows after its dot + icon — the native port of the web
/// `relativeTime = updatedAt && !isFetching ? formatRelative : isFetching ? 'updating…' :
/// isError ? 'error' : ''`. `none` renders no trailing text.
public enum WidgetShellFreshnessLabel: Equatable, Sendable {
    case relative(WidgetShellRelativeTimeBucket)
    case updating
    case error
    case none

    public static func resolve(
        updatedAtMillis: Double?,
        isFetching: Bool,
        isError: Bool,
        nowMillis: Double
    ) -> WidgetShellFreshnessLabel {
        if let updatedAtMillis, updatedAtMillis > 0, !isFetching {
            return .relative(.bucket(updatedAtMillis: updatedAtMillis, nowMillis: nowMillis))
        }
        if isFetching { return .updating }
        if isError { return .error }
        return .none
    }
}

// MARK: - Pulse-on-update (web `justUpdated` effect)

/// The decision behind the web `justUpdated` 1.5 s green-glow effect: pulse only when a *prior*
/// timestamp existed (not the first value) and the new, positive timestamp differs from it
/// (web `prevUpdatedAt.current !== undefined && prevUpdatedAt.current !== effectiveUpdatedAt`).
public enum WidgetShellPulse {
    public static func shouldPulse(previous: Double?, next: Double?) -> Bool {
        guard let next, next > 0 else { return false }
        guard let previous else { return false }
        return previous != next
    }
}

// MARK: - Header / freshness layout decisions (web `title ? … : …`, `freshnessCompact = !title`)

/// Pure layout decisions mirroring the web component's conditional structure so they can be unit
/// tested without SwiftUI.
public enum WidgetShellLayout {
    /// Web renders the titled header only for a truthy `title`; an empty/absent title falls through
    /// to the title-less branch (overlay freshness).
    public static func showsTitleHeader(title: String?) -> Bool {
        guard let title else { return false }
        return !title.isEmpty
    }

    /// Web `freshnessCompact = !title` — title-less widgets (typically 1×1) show the dot-only chip.
    public static func freshnessIsCompact(title: String?) -> Bool {
        !showsTitleHeader(title: title)
    }
}

// MARK: - Accessibility label builders (pure, testable)

/// VoiceOver label composition for the shell's interactive chrome. Format strings come from the
/// P1/S10 facade; these helpers stay pure so the join logic is unit-testable.
public enum WidgetShellAccessibility {
    /// Web `aria-label={'Data freshness: {{state}}'}` for the non-interactive freshness chip.
    public static func dataFreshnessLabel(format: String, status: String) -> String {
        String(format: format, status)
    }

    /// Web `ariaLabel={`More info about ${title}`}` for the help trigger.
    public static func helpLabel(format: String, title: String) -> String {
        String(format: format, title)
    }
}

// MARK: - Diagnostics surface slug (P1/S11 `view.opened`)

/// Stable, non-generic home for the surface slug so tests can reference it without spelling out the
/// view's generic parameters.
public enum WidgetShellSurface {
    public static let slug = "WidgetShell"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` diagnostics event for a surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core telemetry
/// (consent-gated + redacted there). Only the stable surface slug is emitted — never PII.
public protocol WidgetShellTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event
/// carrying only the public surface slug.
public struct OSLogWidgetShellTelemetry: WidgetShellTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "WidgetShell" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The web `WidgetShell` is anonymous; the
/// strings it renders come from the chrome it composes (`DataFreshness`, `HelpTooltip`, `PinButton`,
/// `QueryError`), captured verbatim here.
public enum WidgetShellStrings {
    public static let table = "WidgetShell"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
