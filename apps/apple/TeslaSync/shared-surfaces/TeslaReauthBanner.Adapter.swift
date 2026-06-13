//
//  TeslaReauthBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  The testable, dependency-light core for the Tesla re-authentication banner — the SwiftUI parity of
//  `components/feedback/TeslaReauthBanner.tsx`. Everything here is pure (Foundation only): the string
//  resolver seam (the native shape of the web `useTranslation` `t(key, fallback)`), the Tesla OAuth
//  grant status the banner switches on (the native parity of the web `visible` flag the banner toggles
//  off the `teslasync:tesla-auth-expired` / `teslasync:tesla-auth-recovered` document events), the
//  resolved banner copy (the web `tesla.reauth.title` / `tesla.reauth.body` / `tesla.reauth.cta` /
//  `common.dismiss` strings), and the VoiceOver label builder. No store, no bundle, no rendered view,
//  so each piece is unit tested in isolation.
//
//  Parity note: the web surface is self-driven — it mounts in `<Layout>`, listens to document-level
//  `tesla-auth-expired` / `tesla-auth-recovered` events, shows a sticky `role="alert"` row while the
//  Tesla refresh token is expired, deep-links to `/tesla-account` on "Reconnect", hides on "Dismiss",
//  and replays the queued Tesla mutations on recovery. This core reproduces the pure derivations as
//  values and functions; the event source, the recovery drain, and the SwiftUI chrome layer on top in
//  the sibling files.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias TeslaReauthResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Tesla OAuth grant status (web `visible` trigger)

/// The health of the Tesla third-party OAuth grant as the banner consumes it — the native parity of
/// the web `visible` flag the banner derives from the `teslasync:tesla-auth-expired` /
/// `teslasync:tesla-auth-recovered` document events. The Tesla refresh token has a hard 8-week TTL;
/// once it expires every Tesla-backed call returns 401 `TESLA_TOKEN_EXPIRED` and the web banner shows.
public enum TeslaReauthStatus: String, Sendable, Equatable, CaseIterable {
    /// Not yet observed (the initial read, before the auth signal has reported). Web: pre-event.
    case unknown
    /// The grant is healthy — the web banner is not visible.
    case connected
    /// The refresh token has expired — the web banner is visible (web `tesla-auth-expired`).
    case expired
}

// MARK: - Banner copy (web `tesla.reauth.*` + `common.dismiss`)

/// The fully-resolved banner copy — the four web strings pre-composed so the view is a pure function
/// of this value and the snapshot tests assert the exact copy. A pure value type (no bundle), built
/// through the injected resolver so the native port holds no English literals.
public struct TeslaReauthCopy: Sendable, Equatable {
    /// Web `t('tesla.reauth.title', 'Tesla account disconnected')`.
    public let title: String
    /// Web `t('tesla.reauth.body', 'Reconnect to resume live data and commands.')`.
    public let body: String
    /// Web `t('tesla.reauth.cta', 'Reconnect')`.
    public let cta: String
    /// Web `t('common.dismiss', 'Dismiss')` — the dismiss control's `aria-label`.
    public let dismiss: String

    public init(title: String, body: String, cta: String, dismiss: String) {
        self.title = title
        self.body = body
        self.cta = cta
        self.dismiss = dismiss
    }

    /// Resolves the four web strings through the P1/S10 facade with the web English fallbacks.
    public static func render(strings: TeslaReauthResolve = TeslaReauthStrings.string) -> TeslaReauthCopy {
        TeslaReauthCopy(
            title: strings("tesla.reauth.title", "Tesla account disconnected"),
            body: strings("tesla.reauth.body", "Reconnect to resume live data and commands."),
            cta: strings("tesla.reauth.cta", "Reconnect"),
            dismiss: strings("common.dismiss", "Dismiss")
        )
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's VoiceOver label from the resolved copy, so the spoken content is asserted
/// without rendering. Mirrors the web `role="alert"` / `aria-live="assertive"` region announcing the
/// disconnection: the title and the reassurance body are read in one pass, while the "Reconnect" and
/// "Dismiss" controls stay individually focusable with their own labels.
public enum TeslaReauthAccessibility {
    /// Composes "{title}. {body}" then normalises whitespace — collapses internal runs (a wrapped copy
    /// never reads a double space) and trims the ends.
    public static func bannerLabel(copy: TeslaReauthCopy) -> String {
        collapse("\(copy.title). \(copy.body)")
    }

    private static func collapse(_ value: String) -> String {
        value
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
