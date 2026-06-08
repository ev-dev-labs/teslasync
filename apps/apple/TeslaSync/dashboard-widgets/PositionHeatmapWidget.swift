//
//  PositionHeatmapWidget.swift
//  TeslaSync — P4 dashboard widget · 0072 · PositionHeatmapWidget (Apple)
//
//  The composable Position Heatmap dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/PositionHeatmapWidget.tsx. Binds through
//  PositionHeatmapModel (no networking in the view); renders every state and the
//  MapKit density heatmap. The dashboard-tier registry types are reused from the
//  first widget in this directory (DigitalTwinWidget).
//

import Foundation
import SwiftUI

// MARK: - PositionHeatmapWidget (the dashboard surface)

/// The composable Position Heatmap dashboard widget — the SwiftUI parity of
/// `PositionHeatmapWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget
/// shell, binding through `PositionHeatmapModel` (P1/S8). No networking lives here.
public struct PositionHeatmapWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "PositionHeatmapWidget"

    /// Canonical registry metadata (registry/maps.ts → "position-heatmap").
    public static let registration = DashboardWidgetRegistration(
        id: "position-heatmap",
        nameKey: "widget.positionHeatmap.title",
        descriptionKey: "widget.positionHeatmap.description",
        category: "maps",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: PositionHeatmapModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: PositionHeatmapModel,
        size: DashboardWidgetSize = PositionHeatmapWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = PositionHeatmapWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// The responsive tier for the current grid footprint (web `isCompact`/`isWide`).
    private var tier: PositionHeatmapTier {
        PositionHeatmapBuilder.tier(forColumns: size.cols)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if tier != .compact { header }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(tier == .compact ? TSSpacing.xs : TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension PositionHeatmapWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "map")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            PositionHeatmapStrings.text("widget.positionHeatmap.title", "Position Heatmap")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            if tier == .wide, model.totalPositions > 0 { countBadge }
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    /// The wide-layout position-count badge (web `Badge` → `{{count}} positions`).
    private var countBadge: some View {
        let label = PositionHeatmapStrings.count(
            "widget.positionHeatmap.count",
            "%lld positions",
            model.totalPositions
        )
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = PositionHeatmapStrings.string("widget.positionHeatmap.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = PositionHeatmapStrings.string("widget.positionHeatmap.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = PositionHeatmapStrings.string("widget.positionHeatmap.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(PositionHeatmapStrings.text("widget.positionHeatmap.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                PositionHeatmapStrings.text("widget.positionHeatmap.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(PositionHeatmapStrings.text(
            "widget.positionHeatmap.openA11y",
            "Open the position heatmap page"
        ))
    }
}

// MARK: - Content states

extension PositionHeatmapWidget {
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
            heatmapContent
        }
    }

    private var loadingChrome: some View {
        HeatmapSkeleton()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel(PositionHeatmapStrings.text("widget.positionHeatmap.loading", "Loading position data"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                PositionHeatmapStrings.text("widget.positionHeatmap.noData", "No position data")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            PositionHeatmapStrings.text("widget.positionHeatmap.errorTitle", "Couldn't load positions")
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
                PositionHeatmapStrings.text("widget.positionHeatmap.retry", "Retry")
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

    private var heatmapContent: some View {
        let clusters = PositionHeatmapBuilder.clusterPositions(
            model.positions,
            precision: PositionHeatmapBuilder.precision(for: tier)
        )
        let accessibilityValue = PositionHeatmapStrings.format(
            "widget.positionHeatmap.a11yValue",
            "%lld positions across %lld areas",
            model.totalPositions,
            clusters.count
        )
        return VStack(spacing: TSSpacing.sm) {
            if tier != .compact, model.connection != .live { connectivityBanner }
            if clusters.isEmpty {
                emptyState
            } else {
                PositionHeatmapMapView(
                    clusters: clusters,
                    tier: tier,
                    isInteractive: tier != .compact,
                    accessibilityLabelText: PositionHeatmapStrings.string(
                        "widget.positionHeatmap.a11yLabel",
                        "Position density heatmap"
                    ),
                    accessibilityValueText: accessibilityValue
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.positionHeatmap.offlineBanner" : "widget.positionHeatmap.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known positions"
            : "Reconnecting — positions may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            PositionHeatmapStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// A full-area redacted block for the loading state (web `<Skeleton h-full>`).
/// The shimmer honors Reduce Motion.
private struct HeatmapSkeleton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmer = false

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, Color.TS.surface.opacity(0.7), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 0.4)
                        .offset(x: shimmer ? geo.size.width : -geo.size.width * 0.4)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { shimmer = true }
            }
            .accessibilityHidden(true)
    }
}
