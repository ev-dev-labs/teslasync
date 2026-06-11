//
//  InstallPrompt.Adapter.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  The testable, dependency-light core for the install prompt — the SwiftUI parity of
//  `components/feedback/InstallPrompt.tsx`. The web piece is a Progressive-Web-App "Add to home
//  screen" prompt: it listens for the browser's `beforeinstallprompt`, and — unless the app is
//  already running standalone or the user dismissed it within the last 14 days — surfaces a bottom
//  card offering a one-tap install, persisting a dismissal timestamp + broadcasting the dismissal to
//  sibling tabs.
//
//  The native analogue is the platform's closest "make it feel native / one-tap access" affordance:
//  adding the TeslaSync Home-/Lock-Screen widget (iOS / iPadOS) or pinning the app (macOS). On a
//  runtime where that affordance is already taken (the widget is installed / the app runs installed)
//  the prompt stays hidden, exactly as the web prompt returns nothing in standalone mode. The
//  capability probe, the dismissal persistence, and the cross-scene broadcast live in the seams; this
//  file holds only pure, Foundation-only values: the verbatim web constants (the dismissal key + the
//  14-day window), the verbatim-keyed copy (web `installPrompt.*`), the dismissal-window predicate
//  (web `wasDismissedRecently`), and the VoiceOver label builder. No store, no bundle, no rendered
//  view — each piece is unit tested in isolation. Tint / colour is applied at the view boundary
//  (P1/S9 tokens), never here.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias InstallPromptResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Constants (verbatim web literals)

/// The surface's pure constants, lifted verbatim from the web source so they are asserted in one
/// place and stay identical across platforms.
public enum InstallPromptConstants {
    /// Web `DISMISS_KEY = 'teslasync-pwa-install-dismissed'` — the persisted dismissal key.
    public static let dismissKey = "teslasync-pwa-install-dismissed"

    /// Web `DISMISS_DAYS = 14` — the number of days a dismissal suppresses the prompt.
    public static let dismissDays = 14

    /// The dismissal window in seconds — the native parity of the web `DISMISS_DAYS * 86_400_000`
    /// milliseconds. A re-prompt is only offered once a dismissal is older than this.
    public static let dismissWindow: TimeInterval = .init(dismissDays) * 86400
}

// MARK: - Copy (web `installPrompt.*`)

/// The localized copy keys for the prompt — the verbatim port of the web `InstallPrompt` strings.
/// Every key + English fallback mirrors the web source one-for-one (`installPrompt.title` /
/// `.subtitle` / `.install` / `.dismiss`). Pure (key, fallback) values resolved through the P1/S10
/// facade at the view boundary, so the value itself carries no localized literal.
public enum InstallPromptCopy {
    public static let titleKey = "installPrompt.title"
    public static let titleFallback = "Install TeslaSync"

    public static let subtitleKey = "installPrompt.subtitle"
    public static let subtitleFallback = "Add to home screen for native experience"

    public static let installKey = "installPrompt.install"
    public static let installFallback = "Install"

    public static let dismissKey = "installPrompt.dismiss"
    public static let dismissFallback = "Dismiss install prompt"
}

// MARK: - Dismissal window (verbatim port of the web `wasDismissedRecently`)

/// The pure predicate behind the prompt's "don't re-ask for 14 days" rule — the faithful port of the
/// web `wasDismissedRecently()` (`Number.isFinite(ts) && Date.now() - ts < DISMISS_DAYS * 86_400_000`).
/// Pure (takes the persisted instant + `now` + the window) so every boundary is asserted without the
/// wall clock. A `nil` dismissal instant means "never dismissed" → not recent.
public enum InstallPromptDismissal {
    /// `true` when `dismissedAt` is within `window` seconds of `now` (web "dismissed recently").
    /// A dismissal exactly at the window edge is treated as expired (web strict `<`), so the prompt
    /// re-appears. A future-dated instant (clock skew) is treated as recent, suppressing the prompt.
    public static func isRecent(
        dismissedAt: Date?,
        now: Date,
        window: TimeInterval = InstallPromptConstants.dismissWindow
    ) -> Bool {
        guard let dismissedAt else { return false }
        let elapsed = now.timeIntervalSince(dismissedAt)
        if elapsed < 0 { return true }
        return elapsed < window
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from already-localized parts, so the spoken content is
/// asserted without rendering the view (web bottom card with a title + subtitle read as one notice).
public enum InstallPromptAccessibility {
    /// Joins the prompt's title + subtitle into one VoiceOver sentence, never doubling a terminal
    /// period when the title already ends in one, and skipping an empty part.
    public static func cardLabel(title: String, subtitle: String) -> String {
        guard !title.isEmpty else { return subtitle }
        guard !subtitle.isEmpty else { return title }
        let endsWithTerminal = title.last.map { ".!?".contains($0) } ?? false
        return title + (endsWithTerminal ? " " : ". ") + subtitle
    }
}
