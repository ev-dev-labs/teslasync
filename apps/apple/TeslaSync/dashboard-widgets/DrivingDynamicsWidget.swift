//
//  DrivingDynamicsWidget.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  The composable Driving Dynamics dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/DrivingDynamicsWidget.tsx. Binds through
//  `DrivingDynamicsModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - DrivingDynamicsWidget (the dashboard surface)

/// The composable Driving Dynamics dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DrivingDynamicsWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `DrivingDynamicsModel` (P1/S8).
/// No networking lives here.
public struct DrivingDynamicsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DrivingDynamicsWidget"

    /// Canonical registry metadata (registry/driving.ts → "driving-dynamics").
    public static let registration = DashboardWidgetRegistration(
        id: "driving-dynamics",
        nameKey: "widget.drivingDynamics.title",
        descriptionKey: "widget.drivingDynamics.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: DrivingDynamicsModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DrivingDynamicsModel,
        size: DashboardWidgetSize = DrivingDynamicsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DrivingDynamicsWidget.registration.clamp(size)
        self.onOpen = onOpen
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
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .task(id: staleRefreshToken) { await autoRefreshWhenStale() }
        .accessibilityElement(children: .contain)
    }

    /// `true` when the widget is a single column (web `isCompact`).
    private var isCompact: Bool {
        DrivingDynamicsModel.isCompact(size)
    }

    /// `true` at 3+ columns — renders the acceleration histogram (web `isWide`).
    private var isWide: Bool {
        DrivingDynamicsModel.isWide(size)
    }

    /// Restarts whenever connection/freshness changes so the stale auto-refresh
    /// re-arms exactly once per stale window.
    private var staleRefreshToken: String {
        "\(model.connection)-\(model.updatedAt?.timeIntervalSince1970 ?? 0)"
    }

    /// Stale state → auto-refresh after a short grace period (web
    /// `DataFreshnessAuto`). Cancelled automatically when a fresher snapshot
    /// arrives or the view disappears.
    private func autoRefreshWhenStale() async {
        guard model.connection == .stale else { return }
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled, model.connection == .stale else { return }
        model.refresh()
    }
}

// MARK: - Header

extension DrivingDynamicsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "gauge.medium")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                DrivingDynamicsStrings.text("widget.drivingDynamics.title", "Driving Dynamics")
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
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = DrivingDynamicsStrings.string("widget.drivingDynamics.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DrivingDynamicsStrings.string("widget.drivingDynamics.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DrivingDynamicsStrings.string("widget.drivingDynamics.offline", "Offline")
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
        .accessibilityLabel(DrivingDynamicsStrings.text("widget.drivingDynamics.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                DrivingDynamicsStrings.text("widget.drivingDynamics.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            DrivingDynamicsStrings.text("widget.drivingDynamics.openA11y", "Open the driving dynamics page")
        )
    }
}

// MARK: - Content states

extension DrivingDynamicsWidget {
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
            if isCompact {
                compactContent
            } else {
                standardContent
            }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if isCompact {
                TSSkeleton(width: 72, height: 30, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 48, height: 10, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 88, height: 28, cornerRadius: TSRadius.pill)
            } else {
                HStack(spacing: TSSpacing.lg) {
                    ForEach(0 ..< 3, id: \.self) { _ in
                        VStack(spacing: 6) {
                            TSSkeleton(width: 64, height: 64, cornerRadius: TSRadius.pill)
                            TSSkeleton(width: 40, height: 8, cornerRadius: TSRadius.sm)
                        }
                    }
                }
                if isWide {
                    TSSkeleton(height: 96, cornerRadius: TSRadius.md)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(DrivingDynamicsStrings.text("widget.drivingDynamics.loading", "Loading driving dynamics"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                DrivingDynamicsStrings.text("widget.drivingDynamics.noData", "No dynamics data")
            } icon: {
                Image(systemName: "gauge.medium")
            }
        } description: {
            DrivingDynamicsStrings.text(
                "widget.drivingDynamics.emptyHint",
                "Acceleration and cornering g-forces will appear here once your vehicle drives."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            DrivingDynamicsStrings.text("widget.drivingDynamics.errorTitle", "Couldn't load driving dynamics")
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
                DrivingDynamicsStrings.text("widget.drivingDynamics.retry", "Retry")
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

// MARK: - Loaded content (compact + standard/wide)

extension DrivingDynamicsWidget {
    /// Compact (single column): the peak g number + label + smoothness badge
    /// (web `isCompact` branch).
    private var compactContent: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            Spacer(minLength: 0)
            Text(verbatim: model.projection.maxGText)
                .font(Font.TS.display)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            DrivingDynamicsStrings.text("widget.drivingDynamics.maxG", "Max g")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(Color.TS.textMuted)
            smoothnessBadge
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: DrivingDynamicsAccessibility.summary(for: model.projection)))
    }

    /// Standard / wide: three radial gauges, the driving-style chip, and (wide
    /// only) the acceleration histogram (web non-compact branch).
    private var standardContent: some View {
        VStack(spacing: TSSpacing.md) {
            if model.connection != .live { connectivityBanner }
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                ForEach(model.projection.gauges) { gauge in
                    DrivingDynamicsGaugeView(gauge: gauge)
                        .frame(maxWidth: .infinity)
                }
            }
            severityChip
            if isWide, model.projection.hasDistribution {
                distributionSection
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var distributionSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            DrivingDynamicsStrings.text("widget.drivingDynamics.distribution", "G-Force Distribution")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            DrivingDynamicsDistributionChart(bars: model.projection.bars, isWide: isWide)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// The compact smoothness badge — web `Badge` variant success "Smooth" /
    /// warning "Aggressive" keyed off `isSmooth(maxG)`.
    private var smoothnessBadge: some View {
        let smooth = model.projection.smooth
        let tone = smooth ? Color.TS.statusSuccess : Color.TS.statusWarning
        let key = smooth ? "widget.drivingDynamics.smooth" : "widget.drivingDynamics.aggressive"
        let fallback = smooth ? "Smooth" : "Aggressive"
        return DrivingDynamicsStrings.text(key, fallback)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.md)
            .frame(minWidth: 44, minHeight: 44)
            .background(tone.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: DrivingDynamicsStrings.string(key, fallback)))
    }

    /// The driving-style chip — web `Badge` variant success (calm/normal) /
    /// warning (sporty/aggressive) with the severity-colored label.
    private var severityChip: some View {
        let severity = model.projection.severity
        let variantTone = severity.isCalmCategory ? Color.TS.statusSuccess : Color.TS.statusWarning
        return DrivingDynamicsStrings.text(severity.labelKey, severity.labelFallback)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(severity.tone.color)
            .padding(.horizontal, TSSpacing.md)
            .frame(minWidth: 44, minHeight: 44)
            .background(variantTone.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(variantTone.opacity(0.3), lineWidth: 1))
            .frame(maxWidth: .infinity)
            .accessibilityLabel(
                Text(verbatim: DrivingDynamicsStrings.string(severity.labelKey, severity.labelFallback))
            )
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.drivingDynamics.offlineBanner"
            : "widget.drivingDynamics.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved dynamics"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            DrivingDynamicsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
