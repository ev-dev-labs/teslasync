//
//  RangeEstimateWidget.swift
//  TeslaSync — P4 dashboard widget · 0077 · RangeEstimateWidget (Apple)
//
//  The composable Range Estimate dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/RangeEstimateWidget.tsx. Binds through `RangeEstimateModel`
//  (no networking in the view); renders every state and both layouts (compact / standard).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension RangeEstimateStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - RangeEstimateWidget (the dashboard surface)

/// The composable Range Estimate dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/RangeEstimateWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) inside a glass widget shell,
/// binding through `RangeEstimateModel` (P1/S8). No networking lives here.
public struct RangeEstimateWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RangeEstimateSurface.slug

    /// Canonical registry metadata (registry/battery.ts → "range-estimate").
    public static let registration = RangeEstimateSurface.registration

    @State private var model: RangeEstimateModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: RangeEstimateModel,
        size: DashboardWidgetSize = RangeEstimateWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = RangeEstimateWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the 1×2 default sits in the compact branch.
    private var isCompact: Bool {
        size.cols <= 1
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

extension RangeEstimateWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "gauge.medium")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                RangeEstimateStrings.text("widget.rangeEstimate.title", "Range Estimate")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if !isCompact, let updatedAt = model.updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
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
            return RangeEstimateStrings.string("widget.rangeEstimate.updating", "Updating")
        }
        switch model.connection {
        case .live: return RangeEstimateStrings.string("widget.rangeEstimate.live", "Live")
        case .stale: return RangeEstimateStrings.string("widget.rangeEstimate.stale", "Stale")
        case .offline: return RangeEstimateStrings.string("widget.rangeEstimate.offline", "Offline")
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
        .accessibilityLabel(RangeEstimateStrings.text("widget.rangeEstimate.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                RangeEstimateStrings.text("widget.rangeEstimate.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(RangeEstimateStrings.text("widget.rangeEstimate.openA11y", "Open the Range page"))
    }
}

// MARK: - Content states

extension RangeEstimateWidget {
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
            if let projection = model.projection {
                loadedContent(projection)
            } else {
                emptyState
            }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 64, height: 8, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 96, height: 22, cornerRadius: TSRadius.sm)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(RangeEstimateStrings.text("widget.rangeEstimate.loading", "Loading range estimate"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                RangeEstimateStrings.text("widget.noRange", "No range data")
            } icon: {
                Image(systemName: "gauge.medium")
            }
        } description: {
            RangeEstimateStrings.text(
                "widget.rangeEstimate.emptyHint",
                "Range data will appear once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            RangeEstimateStrings.text("widget.rangeEstimate.errorTitle", "Couldn't load range estimate")
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
                RangeEstimateStrings.text("widget.rangeEstimate.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RangeEstimateStrings.text("widget.rangeEstimate.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func loadedContent(_ projection: RangeEstimateProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    RangeMetricView(metric: projection.rated)
                    RangeMetricView(metric: projection.ideal)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    RangeMetricTile(metric: projection.rated)
                    RangeMetricTile(metric: projection.ideal)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RangeEstimateAccessibility.summary(for: projection)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.rangeEstimate.offlineBanner" : "widget.rangeEstimate.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known range"
            : "Reconnecting — range may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            RangeEstimateStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Range metric (web rated / ideal `<div>` block)

/// One range metric: an uppercase muted label over a value with the unit suffix. The emphasized
/// variant (rated range) uses the accent color + a larger weight, the native parity of the web
/// `text-cyan-300` vs `text-[var(--text-primary)]` treatment.
private struct RangeMetricView: View {
    let metric: RangeMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: metric.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: metric.value)
                    .font(metric.emphasized ? Font.TS.title : Font.TS.section)
                    .fontWeight(metric.emphasized ? .bold : .semibold)
                    .monospacedDigit()
                    .foregroundStyle(metric.emphasized ? Color.TS.accent : Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: metric.unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(metric.label) \(metric.value) \(metric.unit)"))
    }
}

/// `RangeMetricView` wrapped in a glass tile, used for the standard (2-column) layout so each
/// metric reads as its own card. Reuses `RangeMetricView` to keep the rendering DRY.
private struct RangeMetricTile: View {
    let metric: RangeMetric

    var body: some View {
        RangeMetricView(metric: metric)
            .padding(TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
