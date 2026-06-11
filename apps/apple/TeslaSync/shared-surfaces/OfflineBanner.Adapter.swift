//
//  OfflineBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  The testable, dependency-light core for the offline banner — the SwiftUI parity of
//  `components/feedback/OfflineBanner.tsx`. Everything here is pure (Foundation only): the connectivity
//  value (the web `useOnlineStatus` boolean), the freshness axis (the native P4 leaf the web component
//  has no equivalent of), the localization seam (the web `useTranslation` `t(key, fallback)`), the copy
//  builder (the web `t('pwa.offline.title', …)` / `t('pwa.offline.banner', …)` calls), and the
//  VoiceOver summary builder. No monitor, no bundle, no rendered view, so each piece is unit tested in
//  isolation.
//
//  Parity note: the web surface is a tiny presentational component driven by one boolean — `online`
//  from `useOnlineStatus`. When online it renders nothing; when offline it shows a warning-toned
//  `AlertBanner` with `role="status"` / `aria-live="polite"` carrying the "You're offline" title and
//  the "Showing cached data…" reassurance. This core reproduces those pure derivations as values and
//  functions; the SwiftUI chrome layers on top in the sibling view files, and the native surface adds
//  the explicit loading / connected / error / stale leaf states the P4 contract requires.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias OfflineBannerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Connectivity (web `useOnlineStatus` boolean)

/// The bound connectivity reading — the native mirror of the web `useOnlineStatus()` boolean
/// (`getConnectionStatus()` returns the binary `'online' | 'offline'` from `lib/resilience`). A `nil`
/// reading means connectivity has not been determined yet (the native loading leaf the web hook never
/// exposes because it reads `navigator.onLine` synchronously).
public enum OfflineConnectivity: String, Sendable, Equatable, CaseIterable {
    case online
    case offline
}

// MARK: - Freshness (P4 leaf — the orthogonal connectivity-reading axis)

/// How fresh the offline reading is — the native P4 leaf axis. `live` is a just-confirmed offline
/// reading; `stale` is an offline reading older than the freshness window, which surfaces the "Stale"
/// chip and triggers the one-shot auto re-probe. The web component has no equivalent (its boolean is
/// always current), so this exists only to satisfy the P4 stale/offline leaf contract.
public enum OfflineFreshness: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
}

// MARK: - Copy (web `t('pwa.offline.title' | 'pwa.offline.banner', …)`)

/// Builds the banner's title + body copy — the native port of the web render's two `t()` calls:
///
///     title={t('pwa.offline.title', "You're offline")}
///     {t('pwa.offline.banner', 'Showing cached data. New requests will retry when you reconnect.')}
///
/// Pure + public so the resolved strings are asserted directly, and the canonical web source keys are
/// exposed so a parity test can confirm the surface carries every key the web component reads.
public enum OfflineBannerCopy {
    /// The i18n keys the web `OfflineBanner.tsx` reads, in render order. The parity guard test asserts
    /// each resolves through the catalog so the surface never drifts from the web source.
    public static let webSourceKeys = ["pwa.offline.title", "pwa.offline.banner"]

    /// Web `t('pwa.offline.title', "You're offline")`.
    public static func title(_ strings: OfflineBannerResolve = OfflineBannerStrings.string) -> String {
        strings("pwa.offline.title", "You're offline")
    }

    /// Web `t('pwa.offline.banner', 'Showing cached data. New requests will retry when you reconnect.')`.
    public static func banner(_ strings: OfflineBannerResolve = OfflineBannerStrings.string) -> String {
        strings("pwa.offline.banner", "Showing cached data. New requests will retry when you reconnect.")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's VoiceOver summary from the already-localised title + body, so the spoken
/// content is asserted without rendering. Mirrors the web `AlertBanner` `role="status"` /
/// `aria-live="polite"` region being announced as one polite update: the title and reassurance are
/// read in a single pass, with an optional "still offline" note appended when the reading is stale.
public enum OfflineBannerAccessibility {
    /// Composes the spoken summary: "{title}. {body}" plus the optional stale note. Collapses internal
    /// whitespace runs and trims the ends so a wrapped sentence never reads a double space.
    public static func bannerSummary(
        title: String,
        body: String,
        freshness: OfflineFreshness = .live,
        strings: OfflineBannerResolve = OfflineBannerStrings.string
    ) -> String {
        var parts = [title, body]
        if freshness == .stale {
            parts.append(strings("pwa.offline.staleNote", "Rechecking your connection."))
        }
        return normalize(parts.joined(separator: " "))
    }

    /// Collapses internal runs of whitespace to single spaces and trims the ends.
    public static func normalize(_ text: String) -> String {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
