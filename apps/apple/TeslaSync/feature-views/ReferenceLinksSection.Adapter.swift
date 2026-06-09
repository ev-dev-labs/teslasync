//
//  ReferenceLinksSection.Adapter.swift
//  TeslaSync — P4 feature view · 0007 · ReferenceLinksSection (Apple)
//
//  The testable projection core for the developer reference-links section — the
//  SwiftUI parity of features/admin/components/devtools/ReferenceLinksSection.tsx
//  and the `REFERENCE_LINKS` / `ICON_MAP` / `ICON_COLOR_MAP` constants it is fed by
//  (features/admin/components/devtools/constants.ts). Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the link catalog, the
//  lucide→SF-Symbol icon mapping, and the URL parsing are all unit tested in
//  isolation.
//
//  Parity note: the web component maps a static `REFERENCE_LINKS` array — each entry
//  carries an i18n `title` key, an external `url`, and an `icon` name resolved
//  through `ICON_MAP` (with a `BookOpen` fallback). Every icon box uses the single
//  `ICON_COLOR_MAP.cyan` tint. This core reproduces that catalog and the fallback
//  rule verbatim; the cyan tint is applied at the view layer through the P1/S9
//  accent token (the neon-cyan parity colour) so the adapter stays SwiftUI-free.
//

import Foundation

// MARK: - Icon (port of the web `ICON_MAP` lucide set + `BookOpen` fallback)

/// The reference-link glyphs the web `ICON_MAP` exposes (`BookOpen` / `Globe` /
/// `ExternalLink` / `Radio`), mapped to their HIG-native SF Symbol equivalents.
/// `init(web:)` mirrors the web `ICON_MAP[link.icon] ?? BookOpen` lookup — an
/// unknown identifier resolves to `.bookOpen`.
public enum ReferenceLinkIcon: String, Sendable, Equatable, CaseIterable {
    case bookOpen
    case globe
    case externalLink
    case radio

    /// Native port of `ICON_MAP[name] ?? BookOpen`: the web icon identifier resolves
    /// to its case, falling back to `.bookOpen` for any unrecognised value.
    public init(web name: String) {
        switch name {
        case "BookOpen": self = .bookOpen
        case "Globe": self = .globe
        case "ExternalLink": self = .externalLink
        case "Radio": self = .radio
        default: self = .bookOpen
        }
    }

    /// The SF Symbol that stands in for the web lucide glyph (HIG-native parity).
    public var systemImage: String {
        switch self {
        case .bookOpen: "book.fill"
        case .globe: "globe"
        case .externalLink: "arrow.up.right.square"
        case .radio: "antenna.radiowaves.left.and.right"
        }
    }
}

// MARK: - Reference link (port of one `REFERENCE_LINKS` entry)

/// One resolved reference link — the native mirror of a web `REFERENCE_LINKS` entry.
/// The display title is carried as an i18n key + English fallback (resolved in the
/// view); `urlString` is the raw href the card shows (web `link.url`), and `url` is
/// its parsed, openable form (`nil` when the string is not a valid URL).
public struct ReferenceLink: Identifiable, Equatable, Sendable {
    public let titleKey: String
    public let titleFallback: String
    public let urlString: String
    public let icon: ReferenceLinkIcon

    /// Web `key={link.url}` — the href doubles as the stable identity.
    public var id: String {
        urlString
    }

    /// The parsed, openable URL, or `nil` when `urlString` is not a valid URL.
    public var url: URL? {
        URL(string: urlString)
    }

    public init(titleKey: String, titleFallback: String, urlString: String, icon: ReferenceLinkIcon) {
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.urlString = urlString
        self.icon = icon
    }
}

// MARK: - Canonical catalog (port of the web `REFERENCE_LINKS` constant)

/// The reference-link catalog — the native port of `REFERENCE_LINKS`
/// (features/admin/components/devtools/constants.ts). The entries, their order, the
/// i18n keys, the URLs, and the icon mapping match the web source so the catalog,
/// the strings table, and the tests stay aligned. The default English fallbacks are
/// humanised from the (catalog-absent) web keys, matching the sibling
/// `ClientUtilitiesSection` precedent.
public enum ReferenceLinkCatalog {
    public static let defaultLinks: [ReferenceLink] = [
        ReferenceLink(
            titleKey: "devtools.ref.fleetOverview",
            titleFallback: "Fleet API Overview",
            urlString: "https://developer.tesla.com/docs/fleet-api",
            icon: .bookOpen
        ),
        ReferenceLink(
            titleKey: "devtools.ref.partnerEndpoints",
            titleFallback: "Partner Endpoints",
            urlString: "https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register",
            icon: .globe
        ),
        ReferenceLink(
            titleKey: "devtools.ref.devPortal",
            titleFallback: "Developer Portal",
            urlString: "https://developer.tesla.com",
            icon: .externalLink
        ),
        ReferenceLink(
            titleKey: "devtools.ref.telemetryGuide",
            titleFallback: "Fleet Telemetry Guide",
            urlString: "https://developer.tesla.com/docs/fleet-api/fleet-telemetry",
            icon: .radio
        )
    ]
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a link card from already-localised parts, so the
/// spoken content is asserted without rendering the view. The web anchor exposes its
/// title and href; the native label reads "{title}, link, {host}".
public enum ReferenceLinkAccessibility {
    /// The host component the spoken label reads instead of the full href, so
    /// VoiceOver announces a concise, human destination. Falls back to the raw
    /// string when no host can be parsed.
    public static func host(of urlString: String) -> String {
        URL(string: urlString)?.host() ?? urlString
    }

    /// The per-card spoken label: "{title}, link, {host}".
    public static func label(title: String, linkWord: String, host: String) -> String {
        "\(title), \(linkWord), \(host)"
    }
}
