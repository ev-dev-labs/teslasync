//
//  SkipToContent.Adapter.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  The testable, dependency-light core for the skip-navigation surface — the SwiftUI parity
//  of `components/feedback/SkipToContent.tsx`. Everything here is pure (Foundation only): the
//  i18n resolver seam, one skip-target value, the verbatim port of the web anchor contract
//  (`href="#main-content"` ⇄ the `main-content` landmark id), and the VoiceOver summary
//  builders. No store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web `SkipToContent` renders one visually-hidden anchor (WCAG 2.4.1 Bypass
//  Blocks, Level A) that, on activation, moves focus + scroll to the page's
//  `<main id="main-content">` landmark so keyboard / assistive-technology users do not have to
//  tab through the 50+ sidebar items to reach the body. This core reproduces that exact data:
//  the anchor↔landmark identity, the skippable-target value, and the destination summaries the
//  control voices.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web
/// `useTranslation` `t(key, fallback)` call. Kept as a plain closure so the pure core has no
/// dependency on a bundle: the production app passes the P1/S10 facade, while tests pass the
/// identity-fallback resolver.
public typealias SkipResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Skip target (web `#main-content` landmark)

/// One skippable landmark — the native mirror of the web skip-link destination. `id` is the
/// landmark anchor id (web element `id`, e.g. `main-content`); `label` is the already-localised
/// destination name read by VoiceOver and shown on secondary links; `isPrimary` marks the main
/// content landmark (the web `#main-content` the single anchor targets), rendered as the hero
/// "Skip to main content" link.
public struct SkipTarget: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let isPrimary: Bool

    public init(id: String, label: String, isPrimary: Bool = false) {
        self.id = id
        self.label = label
        self.isPrimary = isPrimary
    }
}

// MARK: - Anchor identity (verbatim port of the web `href="#id"` ⇄ `getElementById(id)`)

/// Reproduces the web anchor contract: the link's `href` is `#main-content` and activation
/// resolves the landmark via `document.getElementById('main-content')`. Pure + deterministic so
/// the fragment ↔ id round-trip is asserted directly.
public enum SkipAnchor {
    /// The landmark id for an href — the fragment with a single leading `#` stripped
    /// (web `href.slice(1)` / `getElementById`). Hrefs without a leading `#` pass through
    /// unchanged, and only the first `#` is removed so ids are never corrupted.
    public static func id(forHref href: String) -> String {
        guard href.hasPrefix("#") else { return href }
        return String(href.dropFirst())
    }

    /// The href for a landmark id — the id with a single leading `#` (web `href="#main-content"`).
    public static func href(forID id: String) -> String {
        id.hasPrefix("#") ? id : "#\(id)"
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The primary link reads the verbatim web "Skip to main
/// content"; secondary landmarks read a composed "Skip to {destination}".
public enum SkipToContentAccessibility {
    /// A secondary landmark's skip label — `format` applied to `destination`
    /// (web parity "Skip to {name}"). `format` is the localised `"Skip to %@"` template, so the
    /// wording stays translatable while the destination is data.
    public static func namedSkipLabel(format: String, destination: String) -> String {
        String(format: format, destination)
    }

    /// The skip-confirmation announcement posted to the assistive technology after activation —
    /// `format` applied to `destination` (the native parity of the page jumping focus to the
    /// landmark, then VoiceOver reading the new region). `format` is the localised
    /// `"Skipped to %@"` template.
    public static func skipConfirmation(format: String, destination: String) -> String {
        String(format: format, destination)
    }
}
