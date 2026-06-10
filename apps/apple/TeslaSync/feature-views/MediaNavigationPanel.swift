//
//  MediaNavigationPanel.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  The Media & Navigation telemetry panel — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx. Renders the
//  web source's body (the Now-Playing card with its source chip + status badge, and
//  the Navigation block with its active-destination card + presence chips) inside a
//  glass panel, plus the P4 leaf contract states. Binds through `MediaNavigationModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — neither snapshot resolved → friendly empty state, never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the two-section body; each section shows its own web empty copy
//                 ("No media data" / "No location data") when its snapshot is absent.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - MediaNavigationPanel (the feature surface)

/// The Media & Navigation telemetry panel — the SwiftUI parity of
/// `features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx`. Renders
/// every state from the web source plus the P4 leaf freshness states, binding through
/// `MediaNavigationModel`.
public struct MediaNavigationPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MediaNavigationPanel"

    @State private var model: MediaNavigationModel

    public init(model: MediaNavigationModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
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
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: MediaNavStrings.string(
            "telemetry.mediaNav", "Media & Navigation"
        )))
    }
}

// MARK: - Header (web `<h3 class="section-title"><Headphones/> {title}</h3>`)

private extension MediaNavigationPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "headphones")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .accessibilityHidden(true)
            Text(verbatim: MediaNavStrings.string("telemetry.mediaNav", "Media & Navigation"))
                .font(Font.TS.panel)
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
            label = MediaNavStrings.string("mediaNav.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MediaNavStrings.string("mediaNav.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MediaNavStrings.string("mediaNav.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: MediaNavStrings.string("mediaNav.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? MediaNavStrings.string("mediaNav.offlineBanner", "Offline — showing last known data")
            : MediaNavStrings.string("mediaNav.staleBanner", "Reconnecting — data may be stale")
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

private extension MediaNavigationPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            MediaNavLoadingView()
        case .empty:
            MediaNavEmptyView()
        case let .error(message):
            MediaNavErrorView(message: message) { model.refresh() }
        case let .data(projection):
            MediaNavContent(projection: projection)
        }
    }
}
