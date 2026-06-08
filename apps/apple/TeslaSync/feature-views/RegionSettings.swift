//
//  RegionSettings.swift
//  TeslaSync — P4 feature view · 0211 · RegionSettings (Apple)
//
//  The Region & API settings panel — the SwiftUI parity of
//  features/settings/components/RegionSettings.tsx. Renders the web source's regions
//  (the globe header with title + subtitle, the "Synced …" timestamp + Refresh
//  button, and the region / Fleet-API-URL grid) inside a glass panel, plus the P4
//  leaf contract states. Binds through `RegionSettingsModel` (P1/S8); no networking
//  lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome.
//    • empty    — query resolved with no region → web `EmptyState`, never a blank box.
//    • error    — query failure → retry affordance (web `QueryError` peer).
//    • data     — the region code + Fleet API base URL cells.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - RegionSettings (the feature surface)

/// The Region & API settings panel — the SwiftUI parity of
/// `features/settings/components/RegionSettings.tsx`. Renders every state from the
/// web source plus the P4 leaf freshness states, binding through
/// `RegionSettingsModel`.
public struct RegionSettings: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RegionSettings"

    @State private var model: RegionSettingsModel

    public init(model: RegionSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.04) {
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
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RegionStrings.string("region.title", "Region & API")))
    }
}

// MARK: - Header (web icon + title/subtitle, "Synced …" + Refresh, freshness chip)

private extension RegionSettings {
    var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "globe", tone: .success)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: RegionStrings.string("region.title", "Region & API"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: RegionStrings.string(
                    "region.subtitle",
                    "Tesla account region and Fleet API endpoint"
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            trailing
        }
    }

    var trailing: some View {
        VStack(alignment: .trailing, spacing: TSSpacing.xs) {
            if let synced = model.resolved.fetchedAtLabel {
                let prefix = RegionStrings.string("region.lastSynced", "Synced")
                Text(verbatim: "\(prefix) \(synced)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityLabel(Text(verbatim: RegionAccessibility.syncedLabel(
                        prefix: prefix,
                        timestamp: synced
                    )))
            }
            HStack(spacing: TSSpacing.sm) {
                freshnessChip
                refreshButton
            }
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = RegionStrings.string("region.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = RegionStrings.string("region.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = RegionStrings.string("region.offline", "Offline")
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
        TSButton(
            variant: .secondary,
            size: .small,
            isLoading: model.isRefreshing,
            action: { model.refresh() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                    Text(verbatim: RegionStrings.string("region.refresh", "Refresh"))
                }
            }
        )
        .accessibilityLabel(Text(verbatim: RegionStrings.string("region.refreshA11y", "Refresh region info")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? RegionStrings.string("region.offlineBanner", "Offline — showing last known data")
            : RegionStrings.string("region.staleBanner", "Reconnecting — data may be stale")
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

// MARK: - Content states (web shell + the P4 leaf contract)

private extension RegionSettings {
    @ViewBuilder
    var content: some View {
        switch model.resolved.phase {
        case .loading:
            RegionLoadingView()
        case .empty:
            RegionEmptyView()
        case let .error(message):
            RegionErrorView(message: message) { model.refresh() }
        case .data:
            RegionDataView(
                region: model.resolved.region,
                fleetAPIBaseURL: model.resolved.fleetAPIBaseURL
            )
        }
    }
}
