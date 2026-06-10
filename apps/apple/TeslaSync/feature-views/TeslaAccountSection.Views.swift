//
//  TeslaAccountSection.Views.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The presentational subviews composed by `TeslaAccountSection`, reproducing the web body: the
//  `IconBox` + title + subtitle header, the status row (the connected / disconnected / not-connected
//  glyph + label, the amber "expires soon" pill, and the token-expiry / reconnect detail line), the
//  wrapping action row (Connect — or Refresh / Sync / Re-authorize / Disconnect), and the synced-count
//  success line. All consume pre-localized values from the projection + the P1/S10 facade + the shared
//  P1/S9 tokens and the design-system `TSButton` / `TSIconBox`; no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Header (web `IconBox` + title + subtitle)

/// The section header — the brand-tinted shield icon box plus the title + subtitle copy. Leading
/// aligned; the surface composes the trailing freshness chip + refresh control beside it.
struct TeslaAccountHeader: View {
    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            TSIconBox(systemName: "shield.fill", tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: TeslaAccountStrings.string("tesla.title", "Tesla Account"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: TeslaAccountStrings.string(
                    "tesla.subtitle",
                    "Connect your Tesla account to sync vehicles and data"
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Status row (web connected / disconnected / not-connected box)

/// The status row — the SwiftUI parity of the web status box: a tinted state glyph, the status label
/// (green when connected, red otherwise), the optional amber "expires soon" pill, and the optional
/// token-expiry line (connected) or reconnect body (disconnected). The whole row collapses into one
/// VoiceOver summary.
struct TeslaAccountStatusRow: View {
    let presentation: TeslaAccountPresentation

    private var connected: Bool {
        presentation.statusKind == .connected
    }

    private var tone: Color {
        connected ? Color.TS.statusSuccess : Color.TS.statusDanger
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            statusGlyph
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TeslaAccountFlowLayout(spacing: TSSpacing.sm) {
                    Text(verbatim: presentation.statusLabel)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(tone)
                    if let expiring = presentation.expiringSoonLabel {
                        TeslaAccountExpiringPill(label: expiring)
                    }
                }
                detailLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.border.opacity(0.25),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: presentation.accessibilitySummary))
        .accessibilityIdentifier("tesla-account-status")
    }

    private var statusGlyph: some View {
        Image(systemName: connected ? "checkmark.circle.fill" : "xmark.circle.fill")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(tone)
            .frame(width: 32, height: 32)
            .background(tone.opacity(0.1), in: Circle())
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var detailLine: some View {
        if let token = presentation.tokenExpiresLine {
            Text(verbatim: token)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        } else if let body = presentation.reconnectBody {
            Text(verbatim: body)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Expiring-soon pill (web amber `Expires in {{days}}d` chip)

/// The soft-warning chip shown beside "Connected" when the token expires within the 7-day window.
struct TeslaAccountExpiringPill: View {
    let label: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 9, weight: .bold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityIdentifier("tesla-account-expiring-pill")
    }
}

// MARK: - Action row (web `flex flex-wrap` button group)

/// The action group — the Connect button when signed out, or the Refresh / Sync / Re-authorize /
/// Disconnect set when signed in (web `auth?.authenticated`). The signed-in set wraps across lines on
/// narrow widths + large Dynamic Type via `TeslaAccountFlowLayout` (web `flex-wrap`).
struct TeslaAccountActionRow: View {
    let model: TeslaAccountModel
    let presentation: TeslaAccountPresentation

    var body: some View {
        if presentation.isAuthenticated {
            authenticatedActions
        } else {
            connectAction
        }
    }

    private var connectAction: some View {
        HStack(spacing: 0) {
            TeslaAccountActionButton(
                titleKey: "tesla.connect",
                titleFallback: "Connect Tesla Account",
                systemImage: "arrow.up.right",
                variant: .primary,
                isLoading: model.isConnecting,
                action: { Task { await model.connect() } }
            )
            .accessibilityIdentifier("tesla-account-connect")
            Spacer(minLength: 0)
        }
    }

    private var authenticatedActions: some View {
        TeslaAccountFlowLayout(spacing: TSSpacing.sm) {
            TeslaAccountActionButton(
                titleKey: "tesla.refreshToken",
                titleFallback: "Refresh Token",
                systemImage: "arrow.clockwise",
                variant: .secondary,
                isLoading: model.isRefreshing,
                action: { Task { await model.refreshToken() } }
            )
            .accessibilityIdentifier("tesla-account-refresh")
            TeslaAccountActionButton(
                titleKey: "tesla.syncVehicles",
                titleFallback: "Sync Vehicles",
                systemImage: "car.fill",
                variant: .secondary,
                isLoading: model.isSyncing,
                action: { Task { await model.syncVehicles() } }
            )
            .accessibilityIdentifier("tesla-account-sync")
            TeslaAccountActionButton(
                titleKey: "tesla.reauthorize",
                titleFallback: "Re-authorize",
                systemImage: "arrow.up.right",
                variant: .ghost,
                isDisabled: model.isConnecting,
                action: { Task { await model.connect() } }
            )
            .accessibilityIdentifier("tesla-account-reauthorize")
            TeslaAccountActionButton(
                titleKey: "tesla.disconnect",
                titleFallback: "Disconnect",
                systemImage: "xmark.circle",
                variant: .destructive,
                isDisabled: model.isDisconnecting,
                action: { model.requestDisconnect() }
            )
            .accessibilityIdentifier("tesla-account-disconnect")
        }
    }
}

// MARK: - Action button (web `Button` with leading icon)

/// One action button — a `TSButton` with a leading SF Symbol and a localized label. While loading the
/// `TSButton` swaps its label for a spinner (the native peer of the web spinning icon) and disables
/// itself.
struct TeslaAccountActionButton: View {
    let titleKey: String
    let titleFallback: String
    let systemImage: String
    var variant: TSButtonVariant = .secondary
    var isLoading: Bool = false
    var isDisabled: Bool = false
    let action: () -> Void

    private var title: String {
        TeslaAccountStrings.string(titleKey, titleFallback)
    }

    var body: some View {
        TSButton(variant: variant, size: .medium, isLoading: isLoading, action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: title)
            }
        }
        .disabled(isDisabled || isLoading)
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Synced message (web `Synced {{count}} vehicle(s).`)

/// The persistent success line shown after a vehicle sync resolves (web `syncMut.isSuccess`).
struct TeslaAccountSyncedMessage: View {
    let count: Int

    var body: some View {
        let text = String(
            format: TeslaAccountStrings.string("tesla.synced", "Synced %@ vehicle(s)."),
            TeslaAccountNumber.integer(count)
        )
        return Text(verbatim: text)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.statusSuccess)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("tesla-account-synced-message")
    }
}

// MARK: - Flow layout (web `flex-wrap`)

/// A minimal flowing layout — places its subviews left-to-right and wraps to a new line when the next
/// subview would overflow the proposed width. The Apple-native parity of the web `flex flex-wrap`,
/// adapting to narrow widths + large Dynamic Type without truncation.
struct TeslaAccountFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var widestRow: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                widestRow = max(widestRow, rowWidth)
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        widestRow = max(widestRow, rowWidth)
        let width = proposal.width ?? widestRow
        return CGSize(width: width, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        var positionX = bounds.minX
        var positionY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if positionX > bounds.minX, positionX + size.width > bounds.maxX {
                positionX = bounds.minX
                positionY += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(
                at: CGPoint(x: positionX, y: positionY),
                proposal: ProposedViewSize(width: size.width, height: size.height)
            )
            positionX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
