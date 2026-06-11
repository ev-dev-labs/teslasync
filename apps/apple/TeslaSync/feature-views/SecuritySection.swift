//
//  SecuritySection.swift
//  TeslaSync — P4 feature view · 0298 · SecuritySection (Apple)
//
//  The Security section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/SecuritySection.tsx. Renders the web
//  source's body (the four security `MetricCard` tiles — locked, sentry mode, doors, and
//  windows) inside a glass panel under an always-visible "Security" header, plus the P4
//  leaf contract states. Binds through `SecuritySectionModel` (P1/S8); no networking here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — no security reading resolved → friendly empty state (web `EmptyState`),
//                 never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the four-tile grid (web `grid grid-cols-2 sm:3 lg:4`).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - SecuritySection (the feature surface)

/// The Security section — the SwiftUI parity of
/// `features/vehicles/components/vehicle-detail/SecuritySection.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through
/// `SecuritySectionModel`.
public struct SecuritySection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SecuritySection"

    @State private var model: SecuritySectionModel

    public init(model: SecuritySectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SecuritySectionStrings.string("vehicles.detail.security", "Security")))
    }
}

// MARK: - Header (web `<Shield/> {t('vehicles.detail.security')}` title row)

private extension SecuritySection {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "shield.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: SecuritySectionStrings.string("vehicles.detail.security", "Security"))
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SecuritySectionStrings.string("security.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SecuritySectionStrings.string("security.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SecuritySectionStrings.string("security.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: SecuritySectionStrings.string("security.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? SecuritySectionStrings.string("security.offlineBanner", "Offline — showing last known data")
            : SecuritySectionStrings.string("security.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension SecuritySection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            SecuritySectionLoadingView()
        case .empty:
            SecuritySectionEmptyView()
        case let .error(message):
            SecuritySectionErrorView(message: message) { model.refresh() }
        case let .data(projection):
            SecuritySectionContent(projection: projection)
        }
    }
}
