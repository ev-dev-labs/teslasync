//
//  TripSummaryWidget.swift
//  TeslaSync — P4 dashboard widget · 0103 · TripSummaryWidget (Apple)
//
//  The composable Trip Summary dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/TripSummaryWidget.tsx. Binds through TripSummaryModel (no
//  networking in the view); renders every state and the responsive compact/wide layout.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension TripSummaryStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - TripSummaryWidget (the dashboard surface)

/// The composable Trip Summary dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/TripSummaryWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) and the responsive compact/wide layout
/// inside a glass widget shell, binding through `TripSummaryModel` (P1/S8). No networking lives
/// here.
public struct TripSummaryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TripSummarySurface.slug

    /// Canonical registry metadata (registry/driving.ts → "trip-summary").
    public static let registration = TripSummarySurface.registration

    @State private var model: TripSummaryModel
    private let size: DashboardWidgetSize

    public init(
        model: TripSummaryModel,
        size: DashboardWidgetSize = TripSummaryWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = TripSummaryWidget.registration.clamp(size)
    }

    private var isCompact: Bool {
        TripSummaryLayout.isCompact(cols: size.cols)
    }

    /// The projection, derived per render from the model's cached trips — the native parity of the
    /// web `useMemo(() => data ?? [], [data])` + last-trip / recent-row mapping.
    private var projection: TripSummaryProjection {
        TripSummaryProjector.project(trips: model.trips, units: model.units, isCompact: isCompact)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension TripSummaryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "location.north.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TripSummaryStrings.text("widget.tripSummary", "Trip Summary")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    private var freshnessTone: Color {
        if model.isFetching { return Color.TS.accent }
        switch model.connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var freshnessLabel: String {
        if model.isFetching {
            return TripSummaryStrings.string("widget.tripSummary.updating", "Updating")
        }
        switch model.connection {
        case .live: return TripSummaryStrings.string("widget.tripSummary.live", "Live")
        case .stale: return TripSummaryStrings.string("widget.tripSummary.stale", "Stale")
        case .offline: return TripSummaryStrings.string("widget.tripSummary.offline", "Offline")
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(TripSummaryStrings.text("widget.tripSummary.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension TripSummaryWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSStatGridSkeleton(count: 4)
            TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            TSSkeleton(height: 44, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(TripSummaryStrings.text("widget.tripSummary.loading", "Loading trips"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                TripSummaryStrings.text("widget.noTrips", "No trips recorded yet")
            } icon: {
                Image(systemName: "location.north.fill")
            }
        } description: {
            TripSummaryStrings.text(
                "widget.tripSummary.emptyHint",
                "Trips are grouped from your drives and charges — they'll appear here once recorded."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            TripSummaryStrings.text("widget.tripSummary.errorTitle", "Couldn't load trips")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                TripSummaryStrings.text("widget.tripSummary.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded content

extension TripSummaryWidget {
    private var loadedContent: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live { connectivityBanner }
                if let lastTrip = projection.lastTrip {
                    TripSummaryLastTripCard(block: lastTrip, isCompact: projection.isCompact)
                }
                if !projection.recentRows.isEmpty { recentList }
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var recentList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TripSummaryStrings.text("widget.recentTrips", "Recent Trips")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ForEach(projection.recentRows) { row in
                TripSummaryRowView(row: row, isCompact: projection.isCompact)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: TripSummaryAccessibility.recentSummary(for: projection)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.tripSummary.offlineBanner" : "widget.tripSummary.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known trips"
            : "Reconnecting — trips may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            TripSummaryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
