//
//  FSMDistributionWidget.swift
//  TeslaSync — P4 dashboard widget · 0052 · FSMDistributionWidget (Apple)
//
//  The composable State Distribution dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/FSMDistributionWidget.tsx. Binds through
//  `FSMDistributionModel` (no networking in the view); renders every state
//  (loading / empty / error / stale / offline / content) and both the compact
//  (current state) and standard (donut + legend + transitions) layouts.
//

import Foundation
import SwiftUI

// MARK: - FSMDistributionWidget (the dashboard surface)

/// The composable State Distribution dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/FSMDistributionWidget.tsx`. Renders every state
/// from the web source inside a glass widget shell, binding through
/// `FSMDistributionModel` (P1/S8). No networking lives here.
public struct FSMDistributionWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FSMDistributionWidget"

    /// Canonical registry metadata (registry/analytics.ts → "fsm-distribution").
    public static let registration = DashboardWidgetRegistration(
        id: "fsm-distribution",
        nameKey: "widget.fsmDistribution.title",
        descriptionKey: "widget.fsmDistribution.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: FSMDistributionModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: FSMDistributionModel,
        size: DashboardWidgetSize = FSMDistributionWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = FSMDistributionWidget.registration.clamp(size)
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

    /// `true` when the widget is a single column (web `isCompact = size.cols <= 1`).
    private var isCompact: Bool {
        FSMDistributionModel.isCompact(size)
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

extension FSMDistributionWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusInfo)
                    .accessibilityHidden(true)
                FSMDistributionStrings.text("widget.fsmDistribution.title", "State Distribution")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
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
            label = FSMDistributionStrings.string("widget.fsmDistribution.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = FSMDistributionStrings.string("widget.fsmDistribution.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = FSMDistributionStrings.string("widget.fsmDistribution.offline", "Offline")
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
        .accessibilityLabel(FSMDistributionStrings.text("widget.fsmDistribution.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                FSMDistributionStrings.text("widget.fsmDistribution.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            FSMDistributionStrings.text("widget.fsmDistribution.openA11y", "Open the system page")
        )
    }
}

// MARK: - Content states

extension FSMDistributionWidget {
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
            distributionContent
        }
    }

    private var loadingChrome: some View {
        VStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 120, height: 120, cornerRadius: TSRadius.pill)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if !isCompact {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(0 ..< 3, id: \.self) { _ in
                        TSSkeleton(width: 56, height: 10, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(FSMDistributionStrings.text("widget.fsmDistribution.loading", "Loading state distribution"))
    }

    private var emptyState: some View {
        let message = isCompact
            ? FSMDistributionStrings.string("widget.fsmDistribution.noData", "No state data")
            : FSMDistributionStrings.string("widget.fsmDistribution.noDataLong", "No state data available")
        return ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "arrow.triangle.branch")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            FSMDistributionStrings.text("widget.fsmDistribution.errorTitle", "Couldn't load state distribution")
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
                FSMDistributionStrings.text("widget.fsmDistribution.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.statusInfo.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.statusInfo)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded content (compact current-state · standard donut + legend + feed)

extension FSMDistributionWidget {
    @ViewBuilder
    private var distributionContent: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// Compact (1-col) view: the dominant state's color dot + label + duration
    /// (web `isCompact` branch).
    private var compactContent: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            Spacer(minLength: 0)
            if let dominant = model.projection.dominant {
                Circle()
                    .fill(FSMDistributionStateColor.color(for: dominant.kind))
                    .frame(width: 12, height: 12)
                Text(verbatim: FSMDistributionStrings.stateLabel(dominant.state))
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: compactDuration(dominant))
                    .font(Font.TS.body)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    /// Standard (≥2-col) view: donut + legend + the recent-transitions feed
    /// (web standard branch).
    private var standardContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            FSMDonutChart(segments: model.projection.segments)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            FSMStateLegend(segments: model.projection.segments)
            if !model.projection.transitions.isEmpty {
                FSMTransitionsFeed(transitions: model.projection.transitions)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private func compactDuration(_ segment: FSMDonutSegment) -> String {
        FSMDistributionFormat.duration(
            milliseconds: segment.milliseconds,
            hourUnit: FSMDistributionStrings.string("widget.fsmDistribution.hr", "h"),
            minuteUnit: FSMDistributionStrings.string("widget.fsmDistribution.min", "m")
        )
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.fsmDistribution.offlineBanner"
            : "widget.fsmDistribution.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved states"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            FSMDistributionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
