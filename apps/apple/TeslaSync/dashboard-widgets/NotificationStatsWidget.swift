//
//  NotificationStatsWidget.swift
//  TeslaSync — P4 dashboard widget · 0069 · NotificationStatsWidget (Apple)
//
//  The composable Notification Stats dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/NotificationStatsWidget.tsx. Binds through
//  NotificationStatsModel (P1/S8); renders every state (loading / empty / error /
//  stale / offline / content) with the compact big-number and wide log-table
//  branches from the web source. No networking lives in the view.
//

import SwiftUI

// MARK: - NotificationStatsWidget (the dashboard surface)

/// Native, Apple-idiomatic parity of the web `NotificationStatsWidget`: the
/// delivery-rate stat grid (total sent / delivery rate / failed / active
/// channels), a compact single-number layout, and a recent-delivery log table
/// when wide. Registers with the dashboard grid system as `notification-stats`
/// (category `alerts`, 2×2 default, 1×2 min, 4×40 max).
public struct NotificationStatsWidget: View, DashboardWidgetSurface {
    /// Canonical registry metadata (registry/alerts.ts → "notification-stats").
    public nonisolated static let descriptor = DashboardWidgetDescriptor(
        id: "notification-stats",
        titleKey: "widget.notificationStats.title",
        category: .alerts,
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "NotificationStatsWidget"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    /// Clamps a requested grid size into the surface's `min…max` envelope, so the
    /// native grid honors the same constraints as the web registry.
    public nonisolated static func clampedSize(_ size: DashboardWidgetSize) -> DashboardWidgetSize {
        DashboardWidgetSize(
            cols: min(max(size.cols, descriptor.minSize.cols), descriptor.maxSize.cols),
            rows: min(max(size.rows, descriptor.minSize.rows), descriptor.maxSize.rows)
        )
    }

    private let props: DashboardWidgetProps
    private let telemetry: (any DashboardWidgetTelemetrySink)?
    @Bindable private var model: NotificationStatsModel

    public init(
        props: DashboardWidgetProps,
        model: NotificationStatsModel,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.props = props
        self.telemetry = telemetry
        self.model = model
    }

    private var size: DashboardWidgetSize {
        NotificationStatsWidget.clampedSize(props.size)
    }

    private var isCompact: Bool {
        size.cols <= 1
    }

    private var isWide: Bool {
        size.cols >= 3
    }

    public var body: some View {
        let presentation = NotificationStatsPresentation.resolve(state: model.state, size: size)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact {
                header(for: presentation)
            }
            content(for: presentation)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .task {
            telemetry?.record(NotificationStatsWidget.viewOpenedEvent)
            model.start()
        }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension NotificationStatsWidget {
    private func header(for presentation: NotificationStatsPresentation) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bell.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            NotificationStatsStrings.text("widget.notificationStats.title", "Notification Stats")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            headerAccessory(for: presentation)
            refreshButton
        }
    }

    @ViewBuilder
    private func headerAccessory(for presentation: NotificationStatsPresentation) -> some View {
        switch presentation {
        case let .content(_, freshness, refreshing):
            HStack(spacing: TSSpacing.xs) {
                NotificationStatsFreshnessChip(freshness: freshness)
                if refreshing {
                    ProgressView().controlSize(.mini)
                }
            }
        case .offlineNoData:
            NotificationStatsFreshnessChip(freshness: .offline)
        case .error:
            NotificationStatsFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
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
        .accessibilityLabel(NotificationStatsStrings.text("widget.notificationStats.refresh", "Refresh"))
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            NotificationStatsStrings.text("widget.notificationStats.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(NotificationStatsStrings.text("widget.notificationStats.retry", "Retry"))
    }
}

// MARK: - Content states

extension NotificationStatsWidget {
    @ViewBuilder
    private func content(for presentation: NotificationStatsPresentation) -> some View {
        switch presentation {
        case .loading:
            if isCompact {
                compactLoading
            } else {
                NotificationStatsLoadingView(columns: isWide ? 4 : 2, showsTable: isWide)
            }
        case .empty:
            emptyState
        case .offlineNoData:
            offlineState
        case let .error(retryable):
            errorState(retryable: retryable)
        case let .content(projection, _, _):
            loadedContent(projection)
        }
    }

    @ViewBuilder
    private func loadedContent(_ projection: NotificationStatsProjection) -> some View {
        if isCompact {
            NotificationStatsBigNumber(projection: projection)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: NotificationStatsAccessibility.summary(for: projection)))
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                NotificationStatGrid(stats: projection.stats, columns: isWide ? 4 : 2)
                if isWide, !projection.recentLogs.isEmpty {
                    NotificationLogTable(rows: projection.recentLogs)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }

    private var compactLoading: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 72, height: 26, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 96, height: 10, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(NotificationStatsStrings.text(
            "widget.notificationStats.loading",
            "Loading notification stats"
        ))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                NotificationStatsStrings.text("widget.notificationStats.noData", "No notification data")
            } icon: {
                Image(systemName: "bell")
            }
        } description: {
            NotificationStatsStrings.text(
                "widget.notificationStats.emptyHint",
                "Notifications will appear here once delivered."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var offlineState: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            NotificationStatsStrings.text("widget.notificationStats.noData", "No notification data")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            NotificationStatsStrings.text(
                "widget.notificationStats.offlineMessage",
                "Offline — showing last known stats"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            retryButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func errorState(retryable: Bool) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            NotificationStatsStrings.text(
                "widget.notificationStats.errorTitle",
                "Couldn't load notification stats"
            )
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if retryable {
                retryButton
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
