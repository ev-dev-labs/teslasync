//
//  WeeklyDigestWidget.swift
//  TeslaSync — P4 dashboard widget · 0116 · WeeklyDigestWidget (Apple)
//
//  The composable Weekly Digest dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/WeeklyDigestWidget.tsx. Binds through `WeeklyDigestModel`
//  (no networking in the view) and renders every state from the web source.
//

import SwiftUI

// MARK: - WeeklyDigestWidget (the dashboard surface)

/// The composable Weekly Digest dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/WeeklyDigestWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding
/// through `WeeklyDigestModel` (P1/S8). The body is the "this week vs last week" comparison card —
/// distance, drives, energy, and efficiency with per-metric percent deltas. No networking lives here.
public struct WeeklyDigestWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WeeklyDigestSurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "weekly-digest").
    public static let registration = WeeklyDigestSurface.registration

    @State private var model: WeeklyDigestModel
    private let size: DashboardWidgetSize

    public init(
        model: WeeklyDigestModel,
        size: DashboardWidgetSize = WeeklyDigestWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = WeeklyDigestWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols <= 1` — hides the title/icon and shows only the first two metrics.
    private var isCompact: Bool {
        size.cols <= 1
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }

    /// SwiftUI `Text` from the P1/S10 catalog (the view holds no English literals).
    private func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: WeeklyDigestStrings.string(key, fallback))
    }
}

extension WeeklyDigestWidget {
    // MARK: Header

    /// The web `WidgetShell` header: the calendar glyph + "This Week" title + freshness chip +
    /// refresh. In compact mode (web `isCompact`) the title/icon are dropped and only the freshness
    /// chip + refresh remain (mirroring the title-less shell's overlay indicator).
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "calendar")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                text("widget.weeklyDigest.title", "This Week")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            if model.phase != .loading {
                freshnessChip
            }
            refreshButton
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = WeeklyDigestStrings.string("widget.weeklyDigest.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = WeeklyDigestStrings.string("widget.weeklyDigest.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = WeeklyDigestStrings.string("widget.weeklyDigest.offline", "Offline")
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
        .accessibilityLabel(text("widget.weeklyDigest.refresh", "Refresh"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            WeeklyDigestLoadingRows(rowCount: isCompact ? 2 : 4)
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            loadedCard
        }
    }

    /// Web `EmptyState` — "No weekly data yet" with the calendar glyph (shown when `!data`).
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                text("widget.weeklyDigest.noData", "No weekly data yet")
            } icon: {
                Image(systemName: "calendar")
            }
        } description: {
            text("widget.weeklyDigest.emptyHint", "Drive this week to compare against last week.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Web `WidgetShell` error branch (`QueryError`) with a retry affordance.
    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            text("widget.weeklyDigest.errorTitle", "Couldn't load weekly digest")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            Button {
                model.refresh()
            } label: {
                text("widget.weeklyDigest.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(text("widget.weeklyDigest.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    /// The web `WidgetComparisonCard` body: a connectivity banner when not live, then the metric
    /// rows (sliced to the first two in compact mode) separated by hairline dividers.
    private var loadedCard: some View {
        let rows = model.projection.visibleMetrics(compact: isCompact)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                WeeklyDigestConnectivityBanner(connection: model.connection)
            }
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    WeeklyDigestMetricRowView(row: row)
                    if index < rows.count - 1 {
                        Divider().overlay(Color.TS.border)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
    }
}
