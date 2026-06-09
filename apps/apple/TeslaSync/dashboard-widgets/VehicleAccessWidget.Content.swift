//
//  VehicleAccessWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0106 · VehicleAccessWidget (Apple)
//
//  The loaded-content sub-views for VehicleAccessWidget, split out of the surface file so each stays
//  focused. `VehicleAccessCompactView` is the parity of the web `CompactView` (driver count + a
//  mobile-access status dot); `VehicleAccessStandardView` is the parity of the web `StandardView`
//  (mobile-access badge + the authorized-driver and pending-invitation detail cards).
//  `VehicleAccessDetailCard` is the parity of the web `WidgetDetailCard`.
//

import SwiftUI

// MARK: - Badge tone → color (web `Badge` variant palette)

extension VehicleAccessBadgeTone {
    /// The shared status-tone color for this badge variant. Kept here (SwiftUI) so the adapter's
    /// tone enum stays renderer-free.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .neutral: Color.TS.textMuted
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Compact layout (web `CompactView`, 1×2)

/// The single-line compact summary (web `CompactView`): the driver count on the left and a
/// mobile-access status dot on the right (green = enabled, red = disabled, muted = unknown).
struct VehicleAccessCompactView: View {
    let projection: VehicleAccessProjection

    private var driversLabel: String {
        let suffix = VehicleAccessStrings.string("widget.vehicleAccessDrivers", "Drivers")
        return "\(projection.driverCount) \(suffix)"
    }

    private var dotColor: Color {
        switch projection.mobileEnabled {
        case .some(true): Color.TS.statusSuccess
        case .some(false): Color.TS.statusDanger
        case .none: Color.TS.textMuted
        }
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityHidden(true)
                Text(verbatim: driversLabel)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: TSSpacing.sm)
            Circle()
                .fill(dotColor)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VehicleAccessAccessibility.compactSummary(for: projection)))
    }
}

// MARK: - Standard layout (web `StandardView`)

/// The full card (web `StandardView`): a mobile-access status badge, the authorized-driver detail
/// card, and the pending-invitation detail card (rendered only when there are invitations, matching
/// the web `invitationEntries.length > 0 &&`). A connectivity banner is shown above when the data is
/// stale or served from cache offline.
struct VehicleAccessStandardView: View {
    let projection: VehicleAccessProjection
    let connection: VehicleAccessConnection

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if connection != .live {
                    VehicleAccessConnectivityBanner(connection: connection)
                }
                mobileRow
                driversSection
                if !projection.invitationEntries.isEmpty {
                    invitationsSection
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: VehicleAccessAccessibility.standardSummary(for: projection)))
    }

    /// Web: the "Mobile Access" label + the Enabled / Disabled / Unknown badge.
    private var mobileRow: some View {
        HStack(spacing: TSSpacing.sm) {
            VehicleAccessStrings.text("widget.vehicleAccessMobile", "Mobile Access")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            VehicleAccessBadgeChip(badge: projection.mobileBadge)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var driversSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            VehicleAccessStrings.text("widget.vehicleAccessAuthorized", "Authorized Drivers")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            VehicleAccessDetailCard(
                entries: projection.driverEntries,
                emptyMessage: VehicleAccessStrings.string("widget.vehicleAccessNoDrivers", "No authorized drivers"),
                emptyIcon: "person.2"
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var invitationsSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .accessibilityHidden(true)
            VehicleAccessStrings.text("widget.vehicleAccessPending", "Pending Invitations")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.top, TSSpacing.xs)
            VehicleAccessDetailCard(
                entries: projection.invitationEntries,
                emptyMessage: VehicleAccessStrings.string(
                    "widget.vehicleAccessNoInvitations",
                    "No pending invitations"
                ),
                emptyIcon: "envelope"
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Detail card (web `WidgetDetailCard`)

/// A list of label / value / badge rows, the native parity of the web `WidgetDetailCard`. Rows are
/// separated by hairline dividers (web `border-b border-white/[0.06]`) and a friendly empty state is
/// rendered when there are no entries (web `entries.length === 0`).
struct VehicleAccessDetailCard: View {
    let entries: [VehicleAccessDetailEntry]
    let emptyMessage: String
    let emptyIcon: String

    var body: some View {
        if entries.isEmpty {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: emptyIcon)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: emptyMessage)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.sm)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: emptyMessage))
        } else {
            VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    VehicleAccessDetailRow(entry: entry)
                    if index < entries.count - 1 {
                        Rectangle()
                            .fill(Color.TS.border.opacity(0.6))
                            .frame(height: 1)
                            .accessibilityHidden(true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Detail row (web `WidgetDetailCard` row)

/// One label / value / badge row. The label (driver name/email or invitation creator) is uppercased
/// + muted (web `text-[10px] uppercase text-[var(--text-muted)]`); the value (short date) is
/// primary-colored; the status badge sits at the trailing edge.
struct VehicleAccessDetailRow: View {
    let entry: VehicleAccessDetailEntry

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: entry.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: entry.value)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            VehicleAccessBadgeChip(badge: entry.badge)
        }
        .padding(.vertical, TSSpacing.sm)
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(entry.label) \(entry.value) \(entry.badge.label)"))
    }
}

// MARK: - Badge chip (web `<Badge variant size="sm">`)

/// A compact tinted status chip (web `Badge`, no dot) styled with the shared tone tokens. Resolves
/// its localized label through the P1/S10 facade.
struct VehicleAccessBadgeChip: View {
    let badge: VehicleAccessBadge

    var body: some View {
        let tone = badge.tone.color
        return Text(verbatim: badge.label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .lineLimit(1)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: badge.label))
    }
}

// MARK: - Connectivity banner (web stale/offline freshness surfacing)

/// A thin banner shown above the standard card when the data is stale or served from cache while
/// offline, the native parity of the web `DataFreshness` stale/error surfacing.
struct VehicleAccessConnectivityBanner: View {
    let connection: VehicleAccessConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var key: String {
        isOffline ? "widget.vehicleAccess.offlineBanner" : "widget.vehicleAccess.staleBanner"
    }

    private var fallback: String {
        isOffline ? "Offline — showing last known access" : "Reconnecting — access may be stale"
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            VehicleAccessStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
