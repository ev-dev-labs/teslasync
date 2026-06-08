//
//  WeeklySummaryCardWidget.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  The composable Weekly Summary dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/WeeklySummaryCardWidget.tsx. Binds through
//  WeeklySummaryModel (no networking in the view) and renders every state
//  (loading / empty / error / stale / offline / content) across every layout the
//  web source has: compact (1×1 big number), standard (2-col grid + inline
//  footer), wide (4-col grid) and tall (2-col grid incl. cost + efficiency).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension WeeklySummaryStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in
    /// the model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - WeeklySummaryCardWidget (the dashboard surface)

/// The composable Weekly Summary dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/WeeklySummaryCardWidget.tsx`. Compares this week
/// to last week (distance, energy, cost, efficiency) with trend chips, inside a
/// glass widget shell, binding through `WeeklySummaryModel` (P1/S8). No
/// networking lives here.
public struct WeeklySummaryCardWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WeeklySummarySurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "weekly-summary-card").
    public static let registration = WeeklySummarySurface.registration

    @State private var model: WeeklySummaryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    /// - Parameters:
    ///   - size: the grid footprint the dashboard host placed this surface at.
    ///     The host clamps to `registration` before placement; the view lays out
    ///     responsively to whatever size it is handed, mirroring the web
    ///     component's raw `size` prop (so every web layout branch is reachable).
    public init(
        model: WeeklySummaryModel,
        size: DashboardWidgetSize = WeeklySummaryCardWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = size
        self.onOpen = onOpen
    }

    /// Web: `isCompact = size.cols <= 1 && size.rows <= 1`.
    private var isCompact: Bool {
        size.cols <= 1 && size.rows <= 1
    }

    /// Web: `isWide = size.cols >= 3`.
    private var isWide: Bool {
        size.cols >= 3
    }

    /// Web: `isTall = size.rows >= 2`.
    private var isTall: Bool {
        size.rows >= 2
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact { header }
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

extension WeeklySummaryCardWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            WeeklySummaryStrings.text("widget.weeklySummary.title", "Weekly Summary")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
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
            if let updatedAt = model.updatedAt {
                Text(verbatim: "·").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
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
            return WeeklySummaryStrings.string("widget.weeklySummary.updating", "Updating")
        }
        switch model.connection {
        case .live: return WeeklySummaryStrings.string("widget.weeklySummary.live", "Live")
        case .stale: return WeeklySummaryStrings.string("widget.weeklySummary.stale", "Stale")
        case .offline: return WeeklySummaryStrings.string("widget.weeklySummary.offline", "Offline")
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
        .accessibilityLabel(WeeklySummaryStrings.text("widget.weeklySummary.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                WeeklySummaryStrings.text("widget.weeklySummary.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(WeeklySummaryStrings.text("widget.weeklySummary.openA11y", "Open the analytics page"))
    }
}

// MARK: - Content states

extension WeeklySummaryCardWidget {
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
                if isCompact {
                    WeeklyCompactContent(projection: projection)
                } else {
                    WeeklyStatGrid(
                        projection: projection,
                        connection: model.connection,
                        isWide: isWide,
                        isTall: isTall
                    )
                }
            } else {
                emptyState
            }
        }
    }

    private var loadingChrome: some View {
        Group {
            if isCompact {
                TSSkeleton(height: 36, cornerRadius: TSRadius.md)
                    .frame(maxWidth: 120, maxHeight: .infinity, alignment: .center)
            } else {
                LazyVGrid(columns: WeeklyGridLayout.columns(isWide: isWide), spacing: TSSpacing.sm) {
                    ForEach(0 ..< WeeklyGridLayout.tileCount(isWide: isWide, isTall: isTall), id: \.self) { _ in
                        TSSkeleton(height: 64, cornerRadius: TSRadius.md)
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(WeeklySummaryStrings.text("widget.weeklySummary.loading", "Loading weekly summary"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                WeeklySummaryStrings.text("widget.weeklySummary.noData", "No weekly data")
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        } description: {
            WeeklySummaryStrings.text(
                "widget.weeklySummary.emptyHint",
                "Drive this week to compare against last week."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            WeeklySummaryStrings.text("widget.weeklySummary.errorTitle", "Couldn't load weekly summary")
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
                WeeklySummaryStrings.text("widget.weeklySummary.retry", "Retry")
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
