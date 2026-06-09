//
//  SubscribeCard.Adapter.swift
//  TeslaSync — P4 feature view · 0255 · SubscribeCard (Apple)
//
//  The testable projection core for the system-status "Get notified about
//  incidents" surface — the faithful port of
//  features/system/components/status/SubscribeCard.tsx. Everything here is pure
//  and dependency-free (Foundation only) so the channel catalog, the view-ready
//  tile model, the responsive column math, the load/connection projection, and
//  the VoiceOver copy are all unit-tested without a store, a bundle, or a
//  rendered view.
//
//  Web parity notes:
//    • The web component is a purely presentational discoverability tile (no
//      query, no hook): a bell header, a self-hosted explainer line, and a
//      `grid-cols-1 sm:grid-cols-2` grid of five `<ChannelTile>` rows linking to
//      the channel setups. `SubscribeChannel` is the native mirror of that
//      fixed catalog, so this surface owns its channels exactly like the web
//      component owns its inline `<ChannelTile>` list.
//    • Each web tile carries an icon (lucide), a label, a description, and a
//      `to` route. The cases below reproduce that data verbatim, mapping each
//      lucide glyph to the closest HIG SF Symbol and preserving the original web
//      `to` path (for parity + diagnostics) alongside the canonical native route.
//    • The web grid is `grid-cols-1 sm:grid-cols-2`; `SubscribeCardLayout` ports
//      that breakpoint (1 column below the `sm` width, 2 at/above it).
//    • The web component never hides itself, so the loading / empty / error
//      envelope around the resolved grid is supplied by the bound source — every
//      P4 state still renders here.
//

import Foundation

// MARK: - Channel catalog (web inline `<ChannelTile>` list)

/// One alert-channel discoverability tile — the native port of a web
/// `<ChannelTile>`. Each case carries its i18n keys (so the catalog stays in
/// lock-step with the source), the English fallbacks promoted from the web
/// literals, the SF Symbol mapped from the lucide icon, the original web `to`
/// path, and the canonical native route the host navigates to.
public enum SubscribeChannel: String, CaseIterable, Sendable, Identifiable {
    case email
    case slack
    case discord
    case webhook
    case browserPush

    public var id: String {
        rawValue
    }

    /// Web `t(labelKey, label)` key (e.g. `subscribe.channel.email.label`).
    public var labelKey: String {
        "subscribe.channel.\(rawValue).label"
    }

    /// Web `t(descKey, desc)` key (e.g. `subscribe.channel.email.description`).
    public var descriptionKey: String {
        "subscribe.channel.\(rawValue).description"
    }

    /// English fallback for the label (web `<ChannelTile label>`).
    public var labelFallback: String {
        switch self {
        case .email: "Email"
        case .slack: "Slack"
        case .discord: "Discord"
        case .webhook: "Webhook"
        case .browserPush: "Browser push"
        }
    }

    /// English fallback for the description (web `<ChannelTile description>`).
    public var descriptionFallback: String {
        switch self {
        case .email: "SMTP-based delivery"
        case .slack: "Webhook channel"
        case .discord: "Webhook channel"
        case .webhook: "Custom HTTP endpoint"
        case .browserPush: "Opt-in PWA notifications"
        }
    }

    /// SF Symbol mapped from the web lucide icon (Mail / MessageSquare / Hash /
    /// Webhook / Smartphone), chosen for the closest HIG metaphor on iOS 18 /
    /// iPadOS 18 / macOS 15.
    public var systemImage: String {
        switch self {
        case .email: "envelope"
        case .slack: "message"
        case .discord: "number"
        case .webhook: "point.3.connected.trianglepath.dotted"
        case .browserPush: "iphone"
        }
    }

    /// The original web SPA path (web `<ChannelTile to>`), kept for parity +
    /// diagnostics. Email / Slack / Discord / Webhook all open the channels
    /// manager; Browser push opens the notification settings.
    public var webPath: String {
        switch self {
        case .email, .slack, .discord, .webhook: "/notifications/channels"
        case .browserPush: "/settings/notifications"
        }
    }

    /// The canonical native route the host navigates to (parity with
    /// `AppRouteParser`: the first path segment resolves the route, so
    /// `/notifications/channels` → `/notifications` and `/settings/notifications`
    /// → `/settings`).
    public var routePath: String {
        switch self {
        case .email, .slack, .discord, .webhook: "/notifications"
        case .browserPush: "/settings"
        }
    }

    /// The canonical catalog in the stable web order (Email, Slack, Discord,
    /// Webhook, Browser push) — the native analogue of the web inline list.
    public static let catalog: [SubscribeChannel] = SubscribeChannel.allCases
}

// MARK: - View-ready tile (web mapped `<ChannelTile>` row)

/// A fully-resolved, view-ready channel tile: the localized label/description,
/// the icon, the channel it routes to, and the pre-built VoiceOver label/hint —
/// so the view holds no formatting or localization logic.
public struct SubscribeChannelTileModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let channel: SubscribeChannel
    public let label: String
    public let detail: String
    public let systemImage: String
    public let accessibilityLabel: String
    public let accessibilityHint: String

    public init(
        channel: SubscribeChannel,
        label: String,
        detail: String,
        accessibilityLabel: String,
        accessibilityHint: String
    ) {
        id = channel.id
        self.channel = channel
        self.label = label
        self.detail = detail
        systemImage = channel.systemImage
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
    }
}

/// Projects channels into localized, view-ready tiles — the native mirror of the
/// web inline `<ChannelTile … />` render. Each label/description resolves through
/// the injected localizer (so it is bundle-free in tests) and the a11y copy is
/// pre-built.
public enum SubscribeChannelTileBuilder {
    public static func build(
        channels: [SubscribeChannel] = SubscribeChannel.catalog,
        localize: (String, String) -> String
    ) -> [SubscribeChannelTileModel] {
        channels.map { channel in
            let label = localize(channel.labelKey, channel.labelFallback)
            let detail = localize(channel.descriptionKey, channel.descriptionFallback)
            return SubscribeChannelTileModel(
                channel: channel,
                label: label,
                detail: detail,
                accessibilityLabel: SubscribeCardAccessibility.tileLabel(label: label, detail: detail),
                accessibilityHint: SubscribeCardAccessibility.tileHint(label: label, localize: localize)
            )
        }
    }
}

// MARK: - Responsive layout (web `grid-cols-1 sm:grid-cols-2`)

/// The responsive column math, ported from the web Tailwind grid so it is unit
/// testable and identical across iPhone / iPad / Mac widths. Tailwind `sm` is 640
/// CSS pixels: one column below it, two at/above it.
public enum SubscribeCardLayout {
    public static let smBreakpoint: CGFloat = 640

    /// Columns for an available width: 1 below `sm`, 2 at/above `sm`
    /// (web `grid-cols-1` / `sm:grid-cols-2`).
    public static func columns(forWidth width: CGFloat) -> Int {
        width >= smBreakpoint ? 2 : 1
    }
}

// MARK: - Render phase + connection (load envelope around the static grid)

/// What the surface should render. The web source is always a populated grid; the
/// loading / empty / error envelope (prompt P4 states) is supplied by the bound
/// source so no state is ever a blank box.
public enum SubscribeCardPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the channel catalog, projected into a phase
/// by `resolvePhase`.
public enum SubscribeCardChannelStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the connectivity chip so a cached grid
/// is clearly labeled while reconnecting / offline.
public enum SubscribeCardConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the bound load status + resolved channel
/// count to a render phase. A faithful port of the web component's "always a grid"
/// read, widened with the load envelope the prompt requires.
public enum SubscribeCardProjection {
    /// Resolves the render phase: a failure surfaces the error state, an in-flight
    /// load with no cached channels shows the loading grid, and a resolved catalog
    /// shows the grid when populated or the friendly empty state when it is not.
    public static func resolvePhase(_ status: SubscribeCardChannelStatus, count: Int) -> SubscribeCardPhase {
        switch status {
        case .loading:
            count > 0 ? .content : .loading
        case let .failed(message):
            count > 0 ? .content : .error(message)
        case .loaded:
            count > 0 ? .content : .empty
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum SubscribeCardSurface {
    public static let slug = "SubscribeCard"
}

// MARK: - Accessibility (VoiceOver copy, testable seam)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the spoken content is testable
/// without a bundle, exactly like the view's P1/S10 facade.
public enum SubscribeCardAccessibility {
    /// One tile's spoken label: "{label}. {detail}" (the web reads both lines),
    /// or just the label when there is no description.
    public static func tileLabel(label: String, detail: String) -> String {
        detail.isEmpty ? label : "\(label). \(detail)"
    }

    /// One tile's spoken hint: "Opens {label}" — the link affordance (web `<Link>`).
    public static func tileHint(label: String, localize: (String, String) -> String) -> String {
        String(format: localize("subscribe.openHint", "Opens %@"), label)
    }

    /// The card container's spoken label — the web header copy.
    public static func cardLabel(localize: (String, String) -> String) -> String {
        localize("subscribe.title", "Get notified about incidents")
    }

    /// The connectivity chip's spoken label for the given live-state.
    public static func connectionLabel(
        _ connection: SubscribeCardConnection,
        localize: (String, String) -> String
    ) -> String {
        switch connection {
        case .live: localize("subscribe.live", "Live")
        case .stale: localize("subscribe.stale", "Stale")
        case .offline: localize("subscribe.offline", "Offline")
        }
    }
}
