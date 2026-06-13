//
//  UsageCard.Projection.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The pure projection from the card's props to the view-ready model the SwiftUI body renders — the
//  native port of the web `UsageCard` render body, including the budget-bar math the web computes inline
//  (`widthPct = clamp(pct, 0, 100)`, `ariaPct = max(0, round(pct))`), the `hasAnything` empty guard, the
//  banner intent / glyph defaults, and the footer link URL resolution. Kept Foundation-only and view-free
//  so every branch is unit-tested without an `@Observable` model or a view.
//
//  This is the surface's data adapter in the "props → projection" sense the acceptance calls for:
//  ``UsageCardProjector/resolve(_:)`` takes the props a consumer already holds and derives the rendered
//  card — no networking, no clock. The two numeric responsibilities are split exactly as the web does:
//  the bar WIDTH clamps to 0…100 so it never overflows its track, while the accessibility VALUE keeps the
//  unclamped, rounded reading so an over-budget overflow (pct > 100) is still announced to VoiceOver.
//  Non-finite `pct` (NaN / ±Infinity) — which the web would render as an invalid CSS width — is hardened
//  to 0 here so the native bar degrades gracefully.
//

import Foundation

// MARK: - UsageCardBudgetProjection (view-ready budget bar)

/// The resolved budget bar — everything the SwiftUI body needs as a pure function of ``UsageCardBudget``.
/// `barWidthFraction` is the clamped 0…1 fill (web `widthPct / 100`); `accessibilityValuePercent` is the
/// unclamped, rounded reading announced to VoiceOver (web `ariaValueNow`); `rightLabelIsDanger` mirrors
/// the web's danger-colored right caption (`intent === 'danger'`).
public struct UsageCardBudgetProjection: Sendable, Equatable {
    /// Pre-formatted "spent of total" headline (web `headline`).
    public let headline: String
    /// Optional right-side caption (web `rightLabel`).
    public let rightLabel: String?
    /// Whether the right caption is danger-colored (web `intent === 'danger'`).
    public let rightLabelIsDanger: Bool
    /// Optional caption under the bar (web `caption`).
    public let caption: String?
    /// The clamped fill fraction 0…1 used for the bar width (web `widthPct`).
    public let barWidthFraction: Double
    /// The unclamped, rounded reading announced to VoiceOver (web `ariaValueNow`).
    public let accessibilityValuePercent: Int
    /// The bar intent driving its color (web `intent`).
    public let intent: UsageCardIntent
    /// The screen-reader label naming the budget (web `ariaLabel`).
    public let accessibilityLabel: String

    public init(
        headline: String,
        rightLabel: String?,
        rightLabelIsDanger: Bool,
        caption: String?,
        barWidthFraction: Double,
        accessibilityValuePercent: Int,
        intent: UsageCardIntent,
        accessibilityLabel: String
    ) {
        self.headline = headline
        self.rightLabel = rightLabel
        self.rightLabelIsDanger = rightLabelIsDanger
        self.caption = caption
        self.barWidthFraction = barWidthFraction
        self.accessibilityValuePercent = accessibilityValuePercent
        self.intent = intent
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - UsageCardBannerProjection (view-ready callout)

/// The resolved callout banner — the native port of the web banner's `intent ?? 'danger'` /
/// `icon ?? <AlertTriangle/>` defaults, so the view renders without re-deriving them.
public struct UsageCardBannerProjection: Sendable, Equatable {
    /// The bold banner title (web `title`).
    public let title: String
    /// The muted banner description (web `description`).
    public let description: String
    /// The resolved intent (web `intent ?? 'danger'`).
    public let intent: UsageCardIntent
    /// The resolved leading glyph (web `icon ?? AlertTriangle`).
    public let iconSystemName: String

    public init(title: String, description: String, intent: UsageCardIntent, iconSystemName: String) {
        self.title = title
        self.description = description
        self.intent = intent
        self.iconSystemName = iconSystemName
    }
}

// MARK: - UsageCardFooterLinkProjection (view-ready link)

/// The resolved footer link — the native port of the web `external ? <a href> : <Link to>` decision.
/// `externalURL` is the parsed destination for external links (web `href`), `nil` when the link is
/// internal or the string does not parse; internal links route through the host's `onNavigate` seam.
public struct UsageCardFooterLinkProjection: Sendable, Equatable, Identifiable {
    /// Stable identity (web `link.key`).
    public let id: String
    /// The link label (web `label`).
    public let label: String
    /// Whether to render the filled primary variant (web `primary`).
    public let primary: Bool
    /// Whether the link opens externally (web `external`).
    public let external: Bool
    /// The raw destination — a URL string (external) or in-app route (internal) (web `to`).
    public let destination: String
    /// The parsed URL for an external link (web `href`); `nil` for internal or unparseable.
    public let externalURL: URL?

    public init(
        id: String,
        label: String,
        primary: Bool,
        external: Bool,
        destination: String,
        externalURL: URL?
    ) {
        self.id = id
        self.label = label
        self.primary = primary
        self.external = external
        self.destination = destination
        self.externalURL = externalURL
    }
}

// MARK: - UsageCardProjection (the whole card render output)

/// The resolved, view-ready card — the native bundle of everything the web `UsageCard` render body
/// decides: the `hasAnything` empty guard, the resolved budget bar, the bands / details / top-lists
/// (forwarded as-is), the resolved banner, and the resolved footer links. The view is a pure function of
/// this value; every branch is unit tested.
public struct UsageCardProjection: Sendable, Equatable {
    /// Whether any section is present (web `hasAnything`); `false` renders the empty message.
    public let hasAnything: Bool
    /// The resolved budget bar (web `budget`), or `nil` when absent.
    public let budget: UsageCardBudgetProjection?
    /// The at-a-glance bands (web `bands`).
    public let bands: [UsageCardBand]
    /// The key/value details (web `details`).
    public let details: [UsageCardDetail]
    /// The top-list breakdown blocks (web `topLists`).
    public let topLists: [UsageCardTopList]
    /// The resolved callout banner (web `banner`), or `nil` when absent.
    public let banner: UsageCardBannerProjection?
    /// The resolved footer links (web `footer`).
    public let footer: [UsageCardFooterLinkProjection]

    public init(
        hasAnything: Bool,
        budget: UsageCardBudgetProjection?,
        bands: [UsageCardBand],
        details: [UsageCardDetail],
        topLists: [UsageCardTopList],
        banner: UsageCardBannerProjection?,
        footer: [UsageCardFooterLinkProjection]
    ) {
        self.hasAnything = hasAnything
        self.budget = budget
        self.bands = bands
        self.details = details
        self.topLists = topLists
        self.banner = banner
        self.footer = footer
    }
}

// MARK: - UsageCardProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter. It takes the
/// props a consumer already holds (no fetch, no clock) and derives the rendered card: the budget-bar math
/// (clamp / round), the `hasAnything` guard, the banner / footer defaults, and the link URL resolution.
/// Unit tested across the clamp boundaries, the over-budget overflow, the non-finite hardening, the empty
/// guard, and the external / internal link split.
public enum UsageCardProjector {
    /// The lower / upper bounds of the budget bar width (web `Math.max(0, Math.min(100, pct))`).
    public static let minPercent: Double = 0
    public static let maxPercent: Double = 100

    /// The clamped 0…1 bar fill fraction — the web `widthPct = max(0, min(100, pct)) / 100`. A non-finite
    /// `pct` (NaN / ±Infinity) hardens to 0 so the native bar never renders an invalid width.
    public static func barWidthFraction(pct: Double) -> Double {
        guard pct.isFinite else { return 0 }
        let clamped = min(max(pct, minPercent), maxPercent)
        return clamped / maxPercent
    }

    /// The unclamped, rounded accessibility reading — the web `ariaValueNow = max(0, round(pct))`. Kept
    /// unclamped at the top so an over-budget overflow (pct > 100) is still announced; a non-finite `pct`
    /// hardens to 0. Negative readings floor at 0 (web `Math.max(0, …)`).
    public static func accessibilityValuePercent(pct: Double) -> Int {
        guard pct.isFinite else { return 0 }
        return max(0, Int(pct.rounded()))
    }

    /// Whether any section is present — the verbatim port of the web `hasAnything`.
    public static func hasAnything(_ input: UsageCardInput) -> Bool {
        input.budget != nil
            || !input.bands.isEmpty
            || !input.details.isEmpty
            || !input.topLists.isEmpty
            || input.banner != nil
            || !input.footer.isEmpty
    }

    /// Resolves the budget bar — the clamped width, the unclamped rounded a11y value, and the
    /// danger-colored right caption flag (web `intent === 'danger'`).
    public static func resolveBudget(_ budget: UsageCardBudget) -> UsageCardBudgetProjection {
        UsageCardBudgetProjection(
            headline: budget.headline,
            rightLabel: budget.rightLabel,
            rightLabelIsDanger: budget.intent == .danger,
            caption: budget.caption,
            barWidthFraction: barWidthFraction(pct: budget.pct),
            accessibilityValuePercent: accessibilityValuePercent(pct: budget.pct),
            intent: budget.intent,
            accessibilityLabel: budget.accessibilityLabel
        )
    }

    /// Resolves the banner — applying the web `icon ?? AlertTriangle` glyph default (the intent default
    /// is already applied by ``UsageCardBanner``'s initializer, web `intent ?? 'danger'`).
    public static func resolveBanner(_ banner: UsageCardBanner) -> UsageCardBannerProjection {
        UsageCardBannerProjection(
            title: banner.title,
            description: banner.description,
            intent: banner.intent,
            iconSystemName: banner.iconSystemName ?? UsageCardBanner.defaultIconSystemName
        )
    }

    /// Resolves a footer link — parsing the destination into a `URL` for external links (web `href`) and
    /// leaving internal links to the host's `onNavigate` seam (web react-router `to`).
    public static func resolveFooterLink(_ link: UsageCardFooterLink) -> UsageCardFooterLinkProjection {
        UsageCardFooterLinkProjection(
            id: link.id,
            label: link.label,
            primary: link.primary,
            external: link.external,
            destination: link.destination,
            externalURL: link.external ? URL(string: link.destination) : nil
        )
    }

    /// Resolves the whole card from the props — the native peer of the web component's render decision.
    public static func resolve(_ input: UsageCardInput) -> UsageCardProjection {
        UsageCardProjection(
            hasAnything: hasAnything(input),
            budget: input.budget.map(resolveBudget),
            bands: input.bands,
            details: input.details,
            topLists: input.topLists,
            banner: input.banner.map(resolveBanner),
            footer: input.footer.map(resolveFooterLink)
        )
    }
}
