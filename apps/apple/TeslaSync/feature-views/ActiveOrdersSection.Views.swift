//
//  ActiveOrdersSection.Views.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  The panel header chrome composed by `ActiveOrdersSection`: the cyan cart icon
//  box, the title + subtitle, the trailing "Synced …" stamp + freshness chip +
//  Refresh button, the status badge, and the stale/offline connectivity banner.
//  All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//  The order grid + cards live in `.Cards`; the load states in `.States`.
//

import SwiftUI

// MARK: - Status palette (web `Badge` variant → adaptive semantic tokens)

/// The status-tone → color mapping. The web uses `Badge` variant classes; native
/// uses the adaptive semantic tokens so light / dark / high-contrast all resolve.
enum OrdersPalette {
    static func color(for tone: OrderStatusTone) -> Color {
        switch tone {
        case .neutral: Color.TS.textMuted
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Badge (web `Badge`)

/// A compact tinted label — the native parity of the web `Badge`. The text is
/// caller-resolved (a formatted status or a localized "Upgradable") and rendered
/// verbatim so it flows through the P1/S10 facade, not the main string table.
struct OrdersBadge: View {
    let label: String
    let tone: OrderStatusTone

    var body: some View {
        let tint = OrdersPalette.color(for: tone)
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tint)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tint.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// A small live-state chip shown in the header when the bound source is not live
/// (ADR-013). Orders is not a streaming surface, so "Live" is implicit and only the
/// stale / offline states get a chip — the prompt's "stale chip" / "offline chip".
struct OrdersFreshnessChip: View {
    let connection: OrdersConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let symbol: String
    }

    var body: some View {
        if let descriptor = Self.descriptor(for: connection) {
            HStack(spacing: 4) {
                Image(systemName: descriptor.symbol)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(descriptor.tone)
                OrdersStrings.text(descriptor.key, descriptor.fallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(OrdersStrings.text(descriptor.key, descriptor.fallback))
        }
    }

    private static func descriptor(for connection: OrdersConnection) -> Descriptor? {
        switch connection {
        case .live:
            nil
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                key: "settings.orders.stale",
                fallback: "Stale",
                symbol: "clock.arrow.circlepath"
            )
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                key: "settings.orders.offline",
                fallback: "Offline",
                symbol: "wifi.slash"
            )
        }
    }
}

// MARK: - Synced stamp (web "Synced {formatDateTime(fetched_at)}")

/// The muted "Synced …" timestamp shown only when a sync has happened
/// (web `{ordersData?.fetched_at && <span>…}`).
struct OrdersSyncedStamp: View {
    let fetchedAt: Date?

    var body: some View {
        if let fetchedAt {
            let label = OrdersStrings.string("settings.orders.lastSynced", "Synced")
            Text(verbatim: "\(label) \(OrdersDateFormat.dateTime(fetchedAt))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
    }
}

// MARK: - Refresh button (web secondary `Button` with `RefreshCw`)

/// The header "Refresh" control (web `<Button variant="secondary" size="sm">`).
/// Shows the in-flight spinner via `TSButton`'s `isLoading` and disables while
/// refreshing, matching the web `disabled={ordersRefresh.isPending}`.
struct OrdersRefreshButton: View {
    let refreshing: Bool
    let action: () -> Void

    var body: some View {
        TSButton(variant: .secondary, size: .small, isLoading: refreshing, action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .semibold))
                OrdersStrings.text("settings.orders.refresh", "Refresh")
            }
        }
        .accessibilityLabel(OrdersStrings.text("settings.orders.refresh", "Refresh"))
    }
}

// MARK: - Header (icon box + titles + synced stamp + chip + refresh)

/// The panel header: the cyan cart `IconBox`, the title + subtitle, and the trailing
/// controls (the "Synced" stamp + freshness chip stacked above the Refresh button).
struct OrdersHeader: View {
    let fetchedAt: Date?
    let connection: OrdersConnection
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "cart.fill", tone: .accent)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                OrdersStrings.text("settings.orders.title", "Active Orders")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                OrdersStrings.text(
                    "settings.orders.subtitle",
                    "Vehicle orders and delivery tracking from Tesla"
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            VStack(alignment: .trailing, spacing: TSSpacing.sm) {
                OrdersSyncedStamp(fetchedAt: fetchedAt)
                OrdersFreshnessChip(connection: connection)
                OrdersRefreshButton(refreshing: refreshing, action: onRefresh)
            }
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the content when the bound source is not
/// live, so a cached order list is clearly labeled.
struct OrdersConnectivityBanner: View {
    let connection: OrdersConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "settings.orders.offlineBanner" : "settings.orders.staleBanner"
        let fallback = offline
            ? "Offline — showing last synced orders"
            : "Reconnecting — orders may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            OrdersStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
