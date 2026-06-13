//
//  LiveStaleDataBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  The testable, dependency-light core for the live-stale-data banner — the SwiftUI parity of
//  `components/feedback/LiveStaleDataBanner.tsx`. Everything here is pure (Foundation only): the
//  live-pipeline status taxonomy (the web `useLiveConnection` `LiveConnectionStatus` union, which the
//  companion `LiveIndicator` surface also models), the freshness axis (the native P4 leaf the web
//  component has no equivalent of), the two-minute staleness window (the web
//  `STALE_BANNER_THRESHOLD_MS = 2 * 60_000`), the localization seam (the web `useTranslation`
//  `t(key, fallback)` call), the title / message copy builder (the web `t('live.staleBanner.title' |
//  'live.staleBanner.message', …)` calls), and the VoiceOver summary builder. No transport, no bundle,
//  no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface wraps `useLiveConnection()` and renders an `AlertBanner variant="warning"`
//  ONLY once the live pipe has reported `'disconnected'` continuously for longer than two minutes — a
//  sustained-outage guard that avoids flapping during transient reconnects. Below the threshold (and for
//  every non-disconnected status) the web component returns `null`. This core reproduces those pure
//  derivations as values and functions; the SwiftUI chrome layers on top in the sibling view files, and
//  the live status arrives through the P1/S8 source seam (never read directly by the view).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle: the
/// production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias LiveStaleResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Live-pipeline status (web `LiveConnectionStatus`)

/// The overall live-data pipeline health the banner observes — the native parity of the web
/// `useLiveConnection` `LiveConnectionStatus` union (`'connected' | 'reconnecting' | 'disconnected' |
/// 'unknown'`), the same four-state taxonomy the companion `LiveIndicator` surface models. The web
/// banner only ever compares `status === 'disconnected'`; the other three are folded into the "no
/// banner" path. Surface-local (not the shared `LiveConnectionStatus`) so this prompt stays
/// self-contained and the isolated build needs no sibling files.
public enum LiveStaleStatus: String, Sendable, Equatable, CaseIterable {
    case connected
    case reconnecting
    case disconnected
    case unknown
}

// MARK: - Freshness (P4 leaf — the orthogonal status-reading axis)

/// How fresh our knowledge of the live status is — the native P4 leaf axis. `live` is a just-received
/// status reading; `stale` is a reading the host has not been able to re-confirm within the freshness
/// window (the live pipe is so dead it is not even delivering status updates), which surfaces the
/// "Stale" chip and triggers the one-shot auto re-subscribe. The web component has no equivalent (its
/// `status` is always the latest render), so this exists only to satisfy the P4 stale/offline leaf
/// contract.
public enum LiveStaleFreshness: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
}

// MARK: - Staleness window (web `STALE_BANNER_THRESHOLD_MS`)

/// The sustained-outage window and the pure staleness decision — the native port of the web banner's
/// timing rule:
///
///     const STALE_BANNER_THRESHOLD_MS = 2 * 60_000
///     if (status === 'disconnected') { … show once elapsed >= STALE_BANNER_THRESHOLD_MS }
///
/// The web component tracks `disconnectedSinceRef` itself; the native surface instead carries when the
/// current status was entered on the input (`statusSince`, the peer of the hook's `stateEnteredAtRef`),
/// so the decision is a pure function of `(status, statusSince, now, threshold)` with no mutable ref —
/// trivially testable and previewable. Pure + public so the boundary is asserted directly.
public enum LiveStaleWindow {
    /// The sustained-disconnect threshold in seconds — the web `STALE_BANNER_THRESHOLD_MS = 2 * 60_000`.
    public static let threshold: TimeInterval = 120

    /// The view-side re-evaluation cadence (seconds). The web schedules a single `setTimeout` at the
    /// threshold boundary; the native surface ticks a main-run-loop timer so the banner appears shortly
    /// after the outage crosses two minutes without inventing a per-instance timer.
    public static let tickIntervalSeconds: TimeInterval = 5

    /// How long the current status has persisted (only meaningful for `disconnected`), clamped at zero
    /// so a future-dated `statusSince` never reads negative.
    public static func elapsed(since: Date, now: Date) -> TimeInterval {
        max(0, now.timeIntervalSince(since))
    }

    /// Whether the banner should show — a `disconnected` status that has persisted at least `threshold`
    /// seconds (the web `status === 'disconnected' && elapsed >= STALE_BANNER_THRESHOLD_MS`).
    public static func isStale(
        status: LiveStaleStatus,
        since: Date,
        now: Date,
        threshold: TimeInterval = threshold
    ) -> Bool {
        status == .disconnected && elapsed(since: since, now: now) >= threshold
    }
}

// MARK: - Copy (web `t('live.staleBanner.title' | 'live.staleBanner.message', …)`)

/// Builds the banner's title + message copy — the native port of the web render's two `t()` calls:
///
///     title={t('live.staleBanner.title', 'Live data unavailable')}
///     {t('live.staleBanner.message', 'The live data connection has been offline for more than 2
///        minutes. Values on this page may be stale until the connection is restored.')}
///
/// Pure + public so the resolved strings are asserted directly, and the canonical web source keys are
/// exposed so a parity test can confirm the surface carries every key the web component reads.
public enum LiveStaleMessage {
    /// The i18n keys the web `LiveStaleDataBanner.tsx` reads, in render order. The parity guard test
    /// asserts each resolves through the catalog so the surface never drifts from the web source.
    public static let webSourceKeys = ["live.staleBanner.title", "live.staleBanner.message"]

    /// Web `t('live.staleBanner.title', 'Live data unavailable')`.
    public static func title(_ strings: LiveStaleResolve = LiveStaleDataBannerStrings.string) -> String {
        strings("live.staleBanner.title", "Live data unavailable")
    }

    /// Web `t('live.staleBanner.message', 'The live data connection has been offline for more than 2
    /// minutes. …')`.
    public static func message(_ strings: LiveStaleResolve = LiveStaleDataBannerStrings.string) -> String {
        strings(
            "live.staleBanner.message",
            "The live data connection has been offline for more than 2 minutes. "
                + "Values on this page may be stale until the connection is restored."
        )
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's VoiceOver summary from the already-localised title + message, so the spoken
/// content is asserted without rendering. Mirrors the web `AlertBanner` (`role="status"`,
/// `aria-live="polite"`) announcing its title + body in one polite pass, with an optional "reconnecting"
/// note appended when the status reading is stale.
public enum LiveStaleAccessibility {
    /// Composes the spoken summary: "{title}. {body}" plus the optional stale note, collapsing internal
    /// whitespace runs and trimming the ends so a wrapped sentence never reads a double space.
    public static func bannerSummary(
        title: String,
        body: String,
        freshness: LiveStaleFreshness = .live,
        strings: LiveStaleResolve = LiveStaleDataBannerStrings.string
    ) -> String {
        var parts = [title, body]
        if freshness == .stale {
            parts.append(strings("live.staleBanner.staleNote", "Reconnecting to live data."))
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
