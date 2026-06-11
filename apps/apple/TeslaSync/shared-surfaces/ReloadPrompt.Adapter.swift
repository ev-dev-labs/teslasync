//
//  ReloadPrompt.Adapter.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  The testable, dependency-light core for the new-version reload prompt — the SwiftUI parity of
//  `components/feedback/ReloadPrompt.tsx`. Everything here is pure (Foundation only): the web literals
//  (`COUNTDOWN_SECONDS`, `UPDATE_CHECK_INTERVAL_MS`), the one-second countdown reducer (the port of the
//  web `setCountdown(prev => prev <= 1 ? reload : prev - 1)`), the `{{seconds}}` interpolation (the port
//  of i18next `t('pwa.reloadingIn', { seconds })`), and the VoiceOver label builder. No store, no
//  bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface is a single banner driven by `useRegisterSW` (vite-plugin-pwa). When the
//  service worker reports a newer build (`needRefresh`), it counts down from three seconds then calls
//  `updateServiceWorker(true)` to activate the new build and reload; a "Later" control cancels the
//  countdown and hides the banner, a "Reload Now" control reloads immediately. The data owner is the
//  registration hook, which also re-checks for a new build every five minutes. This core reproduces the
//  countdown arithmetic + the prompt's pure derivations as values and functions; the SwiftUI chrome
//  layers on top in the sibling view files, and the registration seam lives in `ReloadPrompt.Seams`.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias ReloadPromptResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Constants (web literals)

/// The surface's pure constants, lifted from the web source so they are asserted in one place.
public enum ReloadPromptConstants {
    /// Web `const COUNTDOWN_SECONDS = 3` — the auto-reload countdown's starting value.
    public static let countdownSeconds = 3

    /// Web `const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000` expressed in seconds — the cadence the
    /// registration source re-checks for a newer build (web `registration.update()`).
    public static let updateCheckInterval: TimeInterval = 5 * 60

    /// The i18next interpolation token the countdown copy carries (web `{{seconds}}`).
    public static let secondsToken = "{{seconds}}"
}

// MARK: - Countdown (web `setCountdown` reducer)

/// The one-second countdown reducer — the port of the web interval callback
/// `setCountdown(prev => { if (prev <= 1) { reload(); return 0 } return prev - 1 })`. Pure so every
/// step (decrement, the reload threshold, and the already-elapsed guard) is asserted without a timer.
public enum ReloadCountdown {
    /// The outcome of advancing the countdown by one second.
    public enum Step: Sendable, Equatable {
        /// The countdown has reached the threshold — activate the new build and reload.
        case reload
        /// One second remains to be shown before the next step (the new displayed value).
        case tick(Int)
    }

    /// Web `prev <= 1 ? (reload, 0) : prev - 1`: at one (or already past it) the next tick reloads,
    /// otherwise it decrements the displayed value.
    public static func next(from current: Int) -> Step {
        current <= 1 ? .reload : .tick(current - 1)
    }
}

// MARK: - Copy (web `t('pwa.reloadingIn', { seconds })`)

/// Resolves the surface's interpolated copy without a bundle — the port of i18next's `{{seconds}}`
/// substitution. Pure so the formatting is asserted directly against a supplied template.
public enum ReloadPromptCopy {
    /// Web `t('pwa.reloadingIn', 'Reloading in {{seconds}}s...', { seconds })`: substitutes the live
    /// countdown into the localised template, replacing every `{{seconds}}` occurrence.
    public static func reloadingIn(template: String, seconds: Int) -> String {
        template.replacingOccurrences(of: ReloadPromptConstants.secondsToken, with: String(seconds))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's combined VoiceOver label from already-localised parts, so the spoken content is
/// asserted without rendering. Mirrors the web `role="alert"` / `aria-live="polite"` announcement: the
/// "New version available" title followed by the live "Reloading in Ns..." status, read in one pass.
public enum ReloadPromptAccessibility {
    /// "{title}. {status}" — joined so a terminal period is never doubled and empty parts are skipped.
    public static func bannerLabel(title: String, status: String) -> String {
        guard !title.isEmpty else { return status }
        guard !status.isEmpty else { return title }
        let endsWithTerminal = title.last.map { ".!?".contains($0) } ?? false
        return title + (endsWithTerminal ? " " : ". ") + status
    }
}
