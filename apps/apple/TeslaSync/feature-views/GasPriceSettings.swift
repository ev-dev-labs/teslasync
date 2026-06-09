//
//  GasPriceSettings.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  The Gas Price Auto-Poll settings surface — the SwiftUI parity of
//  features/settings/components/GasPriceSettings.tsx. Renders the web source's regions
//  (the fuel-pump header with title + subtitle, the auto-poll toggle + poll-interval
//  select, the current-price + last-polled cells, and the "Poll Now" action with the
//  EIA source caption) inside a glass panel, plus the P4 leaf contract states. Binds
//  through `GasPriceSettingsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial status fetch → skeleton chrome.
//    • empty    — status resolved with no payload → friendly empty state, never blank.
//    • error    — status query failure → retry affordance (web `QueryError` peer).
//    • data     — the full panel (toggle + interval + price/last-polled + poll action).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - GasPriceSettings (the feature surface)

/// The Gas Price Auto-Poll settings surface — the SwiftUI parity of
/// `features/settings/components/GasPriceSettings.tsx`. Renders every state from the
/// web source plus the P4 leaf freshness states, binding through
/// `GasPriceSettingsModel`.
public struct GasPriceSettings: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "GasPriceSettings"

    @State private var model: GasPriceSettingsModel

    public init(model: GasPriceSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.12) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.xl) {
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
        .accessibilityLabel(Text(verbatim: GasPriceStrings.string("gas.title", "Gas Price Auto-Poll")))
    }
}

// MARK: - Header (web IconBox + title/subtitle, plus the P4 freshness chip + refresh)

private extension GasPriceSettings {
    var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "fuelpump.fill", tone: .warning)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: GasPriceStrings.string("gas.title", "Gas Price Auto-Poll"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: GasPriceStrings.string(
                    "gas.subtitle",
                    "Automatically fetch US average gas prices from EIA"
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: TSSpacing.xs) {
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
            label = GasPriceStrings.string("gas.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = GasPriceStrings.string("gas.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = GasPriceStrings.string("gas.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: GasPriceStrings.string("gas.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? GasPriceStrings.string("gas.offlineBanner", "Offline — showing last known prices")
            : GasPriceStrings.string("gas.staleBanner", "Reconnecting — prices may be stale")
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

// MARK: - Content states (web panel body + the P4 leaf contract)

private extension GasPriceSettings {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            GasPriceLoadingView()
        case .empty:
            GasPriceEmptyView()
        case let .error(message):
            GasPriceErrorView(message: message) { model.refresh() }
        case .data:
            GasPriceForm(model: model)
        }
    }
}
