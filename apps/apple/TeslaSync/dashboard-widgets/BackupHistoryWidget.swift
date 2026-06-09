//
//  BackupHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0008 · BackupHistoryWidget (Apple)
//
//  The composable Backup History dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/BackupHistoryWidget.tsx. Binds through
//  BackupHistoryModel (no networking in the view); renders every state and
//  honors the same 1×2…4×40 grid envelope as the web registry. A 1-column
//  instance collapses to the compact outage-count + list layout, exactly like
//  the source.
//

import Foundation
import SwiftUI

// MARK: - BackupHistoryWidget (the dashboard surface)

/// The Backup History dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/BackupHistoryWidget.tsx`. Renders every state
/// (loading / no-site / empty / error / content, plus stale + offline freshness)
/// inside a glass widget shell, binding through `BackupHistoryModel` (P1/S8). No
/// networking lives here.
public struct BackupHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "BackupHistoryWidget"

    /// Canonical registry metadata (registry/energy.ts → "backup-history").
    public static let registration = DashboardWidgetRegistration(
        id: "backup-history",
        nameKey: "widget.backupHistory.title",
        descriptionKey: "widget.backupHistory.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: BackupHistoryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: BackupHistoryModel,
        size: DashboardWidgetSize = BackupHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = BackupHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// A single-column instance collapses to the compact layout — the web
    /// `size.cols <= 1` branch.
    private var isCompact: Bool {
        BackupHistoryModel.isCompact(for: size)
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
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension BackupHistoryWidget {
    @ViewBuilder
    private var header: some View {
        if isCompact {
            HStack(spacing: TSSpacing.xs) {
                Spacer(minLength: 0)
                if model.phase != .loading { freshnessChip }
                refreshButton
            }
        } else {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "battery.100")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesBattery)
                    .accessibilityHidden(true)
                BackupHistoryStrings.text("widget.backupHistory.title", "Backup History")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                if model.phase != .loading { freshnessChip }
                refreshButton
                if onOpen != nil { openButton }
            }
        }
    }

    private var freshnessChip: some View {
        BackupHistoryFreshnessChip(connection: model.connection)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(BackupHistoryStrings.text("widget.backupHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                BackupHistoryStrings.text("widget.backupHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            BackupHistoryStrings.text("widget.backupHistory.openA11y", "Open the backup history page")
        )
    }
}

// MARK: - Content states

extension BackupHistoryWidget {
    @ViewBuilder
    private var content: some View {
        if isCompact {
            compactContent
        } else {
            fullContent
        }
    }

    private var displayedRows: [BackupHistoryRow] {
        model.projection.displayedRows(
            max: isCompact ? BackupHistoryAdapter.compactMaxEvents : BackupHistoryAdapter.standardMaxEvents
        )
    }

    // MARK: Compact

    @ViewBuilder
    private var compactContent: some View {
        switch model.phase {
        case .loading:
            compactLoading
        case let .error(message):
            compactError(message)
        case .noSite:
            noSiteState
        case .empty:
            noEventsState
        case .content:
            compactLoaded
        }
    }

    private var compactLoaded: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                BackupHistoryConnectivityBanner(connection: model.connection)
            }
            BackupHistoryStatTile(
                label: BackupHistoryStrings.string("widget.backupHistory.outages30d", "Outages (30d)"),
                value: model.projection.totalOutagesText
            )
            BackupHistoryEventList(rows: displayedRows, showSubtitle: false, durationLabel: durationLabel)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: BackupHistoryAccessibility
                .compactSummary(outages: model.projection.totalOutages)))
    }

    private var compactLoading: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            BackupHistorySkeletonBar(height: 48, cornerRadius: TSRadius.md)
            ForEach(0 ..< 3, id: \.self) { _ in
                BackupHistorySkeletonBar(height: 36, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(BackupHistoryStrings.text("widget.backupHistory.loading", "Loading backup history"))
    }

    private func compactError(_ message: String) -> some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.statusDanger)
            retryButton(emphasized: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: errorAccessibilityLabel(message)))
    }

    // MARK: Full

    @ViewBuilder
    private var fullContent: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .noSite:
            noSiteState
        case .empty:
            noEventsState
        case .content:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                BackupHistoryConnectivityBanner(connection: model.connection)
            }
            HStack(spacing: TSSpacing.md) {
                BackupHistoryStatTile(
                    label: BackupHistoryStrings.string("widget.backupHistory.outages30d", "Outages (30d)"),
                    value: model.projection.totalOutagesText
                )
                BackupHistoryStatTile(
                    label: BackupHistoryStrings.string("widget.backupHistory.avgDuration", "Avg Duration"),
                    value: model.projection.avgDurationText
                )
            }
            BackupHistoryEventList(rows: displayedRows, showSubtitle: true, durationLabel: durationLabel)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: fullAccessibilityLabel))
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                BackupHistorySkeletonBar(height: 52, cornerRadius: TSRadius.md)
                BackupHistorySkeletonBar(height: 52, cornerRadius: TSRadius.md)
            }
            ForEach(0 ..< 4, id: \.self) { _ in
                BackupHistorySkeletonBar(height: 44, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(BackupHistoryStrings.text("widget.backupHistory.loading", "Loading backup history"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            BackupHistoryStrings.text("widget.backupHistory.errorTitle", "Couldn't load backup history")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton(emphasized: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: errorAccessibilityLabel(message)))
    }

    // MARK: Shared empty states

    /// The web `!hasSites` empty state — "No Tesla Energy site linked".
    private var noSiteState: some View {
        ContentUnavailableView {
            Label {
                BackupHistoryStrings.text("widget.backupHistory.noSite", "No Tesla Energy site linked")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// The web `items.length === 0` empty state — "No backup events in the last
    /// 30 days".
    private var noEventsState: some View {
        ContentUnavailableView {
            Label {
                BackupHistoryStrings.text(
                    "widget.backupHistory.noEvents",
                    "No backup events in the last 30 days"
                )
            } icon: {
                Image(systemName: "battery.100")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func retryButton(emphasized: Bool) -> some View {
        Button {
            model.refresh()
        } label: {
            if emphasized {
                BackupHistoryStrings.text("widget.backupHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            } else {
                BackupHistoryStrings.text("widget.backupHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
        }
        .buttonStyle(.plain)
    }

    private var durationLabel: String {
        BackupHistoryStrings.string("widget.backupHistory.duration", "Duration")
    }

    private func errorAccessibilityLabel(_ message: String) -> String {
        let title = BackupHistoryStrings.string("widget.backupHistory.errorTitle", "Couldn't load backup history")
        return message.isEmpty ? title : "\(title). \(message)"
    }

    private var fullAccessibilityLabel: String {
        BackupHistoryAccessibility.summary(
            siteLinked: model.projection.siteLinked,
            outages: model.projection.totalOutages,
            avgDurationText: model.projection.avgDurationText
        )
    }
}
