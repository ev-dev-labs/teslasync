//
//  FleetStatsWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0051 · FleetStatsWidget (Apple)
//
//  The pure, dependency-free projection layer for the widget chrome. The web
//  `WidgetShell` derives a `DataFreshness` chip from the query lifecycle
//  (isFetching / isStale / isError / dataUpdatedAt) and switches its body across the
//  loading / error / content envelope. This file ports that derivation:
//    • `FleetStatsWidgetFreshness` maps the bound (connection, refreshing) pair to the
//      chip's tone, glyph, and i18n label — the native `DataFreshness` projection.
//    • `FleetStatsWidgetProjector` folds a `FleetStatsUpdate` into the rendered shape
//      the widget needs (phase + five cards + freshness), composing the shared
//      FleetStatsBar projection rather than duplicating its card math.
//
//  Foundation only (no store, no bundle, no rendered view) so the chip math and the
//  cached → projection mapping are unit-tested without a host.
//

import Foundation

// MARK: - Freshness chip tone (web `DataFreshness` status)

/// The visual + semantic state of the widget freshness chip — the native mirror of the
/// web `DataFreshness` indicator the title-less `WidgetShell` overlays. A background
/// refetch outranks the connection state (web: the spinner shows while `isFetching`).
public enum FleetStatsWidgetFreshnessTone: String, Sendable, Equatable, CaseIterable {
    case live
    case fetching
    case stale
    case offline
}

/// Pure derivation of the freshness chip from the bound query state, ported from the
/// web `DataFreshness` props (`isFetching` wins, then the live-stream connection).
public enum FleetStatsWidgetFreshness {
    /// The chip tone for a `(connection, refreshing)` pair: a background refetch shows
    /// the spinner; otherwise the live-stream connection drives the dot.
    public static func tone(
        connection: FleetStatsConnection,
        refreshing: Bool
    ) -> FleetStatsWidgetFreshnessTone {
        if refreshing { return .fetching }
        switch connection {
        case .live: return .live
        case .stale: return .stale
        case .offline: return .offline
        }
    }

    /// The chip's i18n key + English fallback (web `DataFreshness` status label).
    public static func label(for tone: FleetStatsWidgetFreshnessTone) -> (key: String, fallback: String) {
        switch tone {
        case .live: ("widget.fleetStats.live", "Live")
        case .fetching: ("widget.fleetStats.updating", "Updating")
        case .stale: ("widget.fleetStats.stale", "Stale")
        case .offline: ("widget.fleetStats.offline", "Offline")
        }
    }

    /// The SF Symbol for a tone (web chip glyph): a spinner while fetching, the live /
    /// reconnecting / offline connectivity glyphs otherwise.
    public static func symbol(for tone: FleetStatsWidgetFreshnessTone) -> String {
        switch tone {
        case .live: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    /// Whether the chip should animate (spin) — only while a refetch is in flight.
    public static func isAnimating(_ tone: FleetStatsWidgetFreshnessTone) -> Bool {
        tone == .fetching
    }
}

// MARK: - Widget projection (web `WidgetShell` body envelope + freshness)

/// The fully-resolved shape the widget renders for one snapshot: the body phase + the
/// five projected cards (delegated to the shared FleetStatsBar projection) plus the
/// freshness chip inputs. Computed once per snapshot so the cached → projection mapping
/// is testable end-to-end for this surface.
public struct FleetStatsWidgetProjection: Equatable {
    public let phase: FleetStatsPhase
    public let cards: [FleetStatCard]
    public let freshnessTone: FleetStatsWidgetFreshnessTone
    public let connection: FleetStatsConnection
    public let updatedAt: Date?

    public init(
        phase: FleetStatsPhase,
        cards: [FleetStatCard],
        freshnessTone: FleetStatsWidgetFreshnessTone,
        connection: FleetStatsConnection,
        updatedAt: Date?
    ) {
        self.phase = phase
        self.cards = cards
        self.freshnessTone = freshnessTone
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// Pure projector: `FleetStatsUpdate` → `FleetStatsWidgetProjection`. Reuses the shared
/// `FleetStatsProjection` (the same card + phase math the embedded bar renders) so the
/// widget and the bar can never drift, and layers the widget-only freshness derivation
/// on top.
public enum FleetStatsWidgetProjector {
    public static func project(_ update: FleetStatsUpdate, locale: Locale = .current) -> FleetStatsWidgetProjection {
        let cards = FleetStatsProjection.cards(from: update.input, locale: locale)
        let phase = FleetStatsProjection.resolvePhase(
            update.status,
            isEmpty: FleetStatsProjection.isEmpty(update.input)
        )
        let tone = FleetStatsWidgetFreshness.tone(connection: update.connection, refreshing: update.refreshing)
        return FleetStatsWidgetProjection(
            phase: phase,
            cards: cards,
            freshnessTone: tone,
            connection: update.connection,
            updatedAt: update.updatedAt
        )
    }
}
