//
//  BrowserCompatBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  The testable, dependency-light core for the platform-compatibility banner — the SwiftUI parity of
//  `components/feedback/BrowserCompatBanner.tsx` (+ its `@/lib/browserCompat` helper). The web piece
//  detects, once on mount, which modern web-platform features the host browser is missing
//  (BroadcastChannel / ResizeObserver / Intl.RelativeTimeFormat / CSS `:has()` / structuredClone),
//  and — unless the user has dismissed it — shows a sticky warning telling them to update.
//
//  The native analogue is a platform-capability check: the app likewise depends on a small set of
//  system frameworks (Swift Charts, MapKit, Live Activities, Widgets, Background App Refresh). On a
//  supported iOS 18 / iPadOS 18 / macOS 15 runtime none are missing, so the banner stays hidden —
//  exactly as the web banner returns nothing on a modern browser. The probe + dismissal persistence
//  live in the seams; this file holds only pure, Foundation-only values: the required-capability
//  identities, the verbatim-keyed copy (web `compat.banner.*`), the body interpolation (web
//  `{{features}}` / `{{recommendation}}`), and the VoiceOver label builder. No store, no bundle, no
//  rendered view — each piece is unit tested in isolation. Tint/colour is applied at the view
//  boundary (P1/S9 tokens), never here.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias BrowserCompatResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Required capability (web required feature)

/// One system capability TeslaSync requires — the native identity of a single web-platform feature
/// the browser banner lists (e.g. `ResizeObserver`). A pure value (no detection logic, which lives
/// in the `CapabilityProbe` seam) so it can flow through the projection, the rendered body, and the
/// VoiceOver label and be asserted directly. The display name resolves through the P1/S10 facade at
/// the view boundary, so the value itself carries no localized literal.
public struct RequiredCapability: Sendable, Equatable, Identifiable {
    public let id: String
    public let nameKey: String
    public let nameFallback: String

    public init(id: String, nameKey: String, nameFallback: String) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
    }
}

/// The canonical set of capabilities the app requires — the native mirror of the web feature list in
/// `detectMissingFeatures()`. Each maps a real framework the SPA's web counterpart leans on (charts,
/// maps, cross-context live updates, glanceable surfaces, background sync). The `CapabilityProbe`
/// seam decides which, if any, are unavailable on the running device.
public enum BrowserCompatCapabilities {
    /// Swift Charts — the native parity of the web charting stack (Recharts via ResizeObserver).
    public static let swiftCharts = RequiredCapability(
        id: "swift_charts",
        nameKey: "compat.capability.swiftCharts",
        nameFallback: "Swift Charts"
    )

    /// MapKit — the native parity of the web map stack (Leaflet via ResizeObserver).
    public static let mapKit = RequiredCapability(
        id: "mapkit",
        nameKey: "compat.capability.mapKit",
        nameFallback: "MapKit"
    )

    /// Live Activities — real-time lock-screen / Dynamic Island state (web cross-tab BroadcastChannel).
    public static let liveActivities = RequiredCapability(
        id: "live_activities",
        nameKey: "compat.capability.liveActivities",
        nameFallback: "Live Activities"
    )

    /// WidgetKit — the glanceable Home / Lock Screen surfaces.
    public static let widgets = RequiredCapability(
        id: "widgetkit",
        nameKey: "compat.capability.widgets",
        nameFallback: "Widgets"
    )

    /// Background App Refresh — periodic background sync (web structuredClone cache hydration peer).
    public static let backgroundRefresh = RequiredCapability(
        id: "background_refresh",
        nameKey: "compat.capability.backgroundRefresh",
        nameFallback: "Background App Refresh"
    )

    /// The ordered, stable list the default probe walks (web `detectMissingFeatures` feature order).
    public static let all: [RequiredCapability] = [
        swiftCharts,
        mapKit,
        liveActivities,
        widgets,
        backgroundRefresh
    ]
}

// MARK: - Copy (web `compat.banner.*`)

/// The localized copy keys for the banner — the verbatim port of the web `BrowserCompatBanner`
/// strings. The title + body keys mirror the web source exactly (`compat.banner.title`,
/// `compat.banner.body`); the dismiss key carries the localized control label the web wrapper adds
/// (`compat.banner.dismiss`). The recommendation is the native parity of the web
/// `RECOMMENDED_BROWSERS_FALLBACK` ("Use Chrome ≥ 110, …"), adapted to the Apple update path. Pure
/// (key, fallback) values resolved through the P1/S10 facade at the view boundary.
public enum BrowserCompatCopy {
    public static let titleKey = "compat.banner.title"
    public static let titleFallback = "Your device is missing required features"

    /// The web body template, with i18next `{{features}}` / `{{recommendation}}` rewritten as the
    /// native `{features}` / `{recommendation}` tokens substituted by `BrowserCompatBody`.
    public static let bodyKey = "compat.banner.body"
    public static let bodyFallback = "TeslaSync needs {features} to work correctly. {recommendation}"

    public static let dismissKey = "compat.banner.dismiss"
    public static let dismissFallback = "Dismiss"

    /// The native parity of the web `RECOMMENDED_BROWSERS_FALLBACK` — guidance on the supported
    /// runtimes, substituted into the body's `{recommendation}` token.
    public static let recommendationKey = "compat.banner.recommendation"
    public static let recommendationFallback =
        "Update to iOS 18, iPadOS 18, or macOS 15 (or later), then reinstall TeslaSync."
}

// MARK: - Body interpolation (web i18next `{{features}}` / `{{recommendation}}`)

/// Builds the banner's body + the feature list from already-localized parts — the native parity of
/// the web `t('compat.banner.body', { features, recommendation })` interpolation and the
/// `missing.join(', ')` feature list. Pure string work, asserted without rendering.
public enum BrowserCompatBody {
    /// The token the localized body template carries for the comma-joined feature list.
    public static let featuresToken = "{features}"
    /// The token the localized body template carries for the recommended-runtime guidance.
    public static let recommendationToken = "{recommendation}"

    /// Joins the localized capability names into the inline list (web `missing.join(', ')`).
    public static func featureList(_ names: [String]) -> String {
        names.joined(separator: ", ")
    }

    /// Substitutes the feature list + recommendation into the localized body template. Tolerates a
    /// template missing either token (the surviving text is returned unchanged).
    public static func text(features: String, recommendation: String, template: String) -> String {
        template
            .replacingOccurrences(of: featuresToken, with: features)
            .replacingOccurrences(of: recommendationToken, with: recommendation)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from already-localized parts, so the spoken content is
/// asserted without rendering the view (web `role="status"` + `aria-live="polite"` banner).
public enum BrowserCompatAccessibility {
    /// Joins the banner's title + body into one VoiceOver sentence, never doubling a terminal period
    /// when the title already ends in one.
    public static func bannerLabel(title: String, body: String) -> String {
        guard !title.isEmpty else { return body }
        guard !body.isEmpty else { return title }
        let endsWithTerminal = title.last.map { ".!?".contains($0) } ?? false
        return title + (endsWithTerminal ? " " : ". ") + body
    }
}
