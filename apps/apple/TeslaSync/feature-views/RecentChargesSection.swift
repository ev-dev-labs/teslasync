//
//  RecentChargesSection.swift
//  TeslaSync — P4 feature view · 0296 · RecentChargesSection (Apple)
//
//  The Recent Charges section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/RecentChargesSection.tsx. Renders the web source's
//  body (the recent charging-sessions `DataTable`, or the EmptyState when there are none) inside a
//  glass panel under an always-visible green BatteryCharging "Recent Charges" header with a
//  "View all" affordance (web `<Link to="/charging">`), plus the P4 leaf contract states. Binds
//  through `RecentChargesSectionModel` (P1/S8); no networking here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — no rows (web `!(sessions && length > 0)`) → friendly empty state, never blank.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the five-column charge table (web `DataTable`, compact + sortable energy).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - RecentChargesSection (the feature surface)

/// The Recent Charges section — the SwiftUI parity of
/// `features/vehicles/components/vehicle-detail/RecentChargesSection.tsx`. Renders every state from
/// the web source plus the P4 leaf freshness states, binding through `RecentChargesSectionModel`.
/// `onViewAll` is the web `<Link to="/charging">` affordance, wired by the host to navigation.
public struct RecentChargesSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RecentChargesSection"

    @State private var model: RecentChargesSectionModel
    private let onViewAll: () -> Void

    public init(model: RecentChargesSectionModel, onViewAll: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onViewAll = onViewAll
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
        .accessibilityLabel(Text(verbatim: RecentChargesSectionStrings.string(
            "common.recentCharges", "Recent Charges"
        )))
    }
}

// MARK: - Header (web `<BatteryCharging/> {t('common.recentCharges')}` + the "View all" link)

private extension RecentChargesSection {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "battery.100.bolt")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: RecentChargesSectionStrings.string("common.recentCharges", "Recent Charges"))
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            viewAllButton
            refreshButton
        }
    }

    /// Web `<Link to="/charging">{t('common.viewAll')} <ChevronRight/></Link>` — a navigation
    /// affordance wired by the host. Muted, with the trailing chevron.
    var viewAllButton: some View {
        Button(action: onViewAll) {
            HStack(spacing: 2) {
                Text(verbatim: RecentChargesSectionStrings.string("common.viewAll", "View all"))
                    .font(Font.TS.caption)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: RecentChargesSectionStrings.string("common.viewAll", "View all")))
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = RecentChargesSectionStrings.string("recentCharges.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = RecentChargesSectionStrings.string("recentCharges.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = RecentChargesSectionStrings.string("recentCharges.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: RecentChargesSectionStrings.string("recentCharges.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? RecentChargesSectionStrings.string("recentCharges.offlineBanner", "Offline — showing last known data")
            : RecentChargesSectionStrings.string("recentCharges.staleBanner", "Reconnecting — data may be stale")
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

private extension RecentChargesSection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            RecentChargesSectionLoadingView()
        case .empty:
            RecentChargesSectionEmptyView()
        case let .error(message):
            RecentChargesSectionErrorView(message: message) { model.refresh() }
        case let .data(projection):
            RecentChargesSectionContent(projection: projection)
        }
    }
}
