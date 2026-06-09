//
//  BackupMonitorWidget.swift
//  TeslaSync — P4 dashboard widget · 0009 · BackupMonitorWidget (Apple)
//
//  The composable Backup Monitor dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/BackupMonitorWidget.tsx. Binds through
//  `BackupMonitorModel` (no networking in the view); renders every state and
//  honors the same 1×2…4×40 grid envelope as the web registry. A 1-column
//  instance collapses to the compact "last backup" badge (web `size.cols <= 1`),
//  and a 4-column instance reveals the "Recent Runs" list (web `size.cols >= 4`).
//

import Foundation
import SwiftUI

// MARK: - BackupMonitorWidget (the dashboard surface)

/// The Backup Monitor dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/BackupMonitorWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `BackupMonitorModel` (P1/S8). No
/// networking lives here.
public struct BackupMonitorWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = BackupMonitorSurface.slug

    /// Canonical registry metadata (registry/system.ts → "backup-monitor").
    public static let registration = BackupMonitorSurface.registration

    @State private var model: BackupMonitorModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: BackupMonitorModel,
        size: DashboardWidgetSize = BackupMonitorWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = BackupMonitorWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// A single-column instance collapses to the compact badge — the web
    /// `size.cols <= 1` branch.
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// A four-column instance reveals the "Recent Runs" list — the web
    /// `size.cols >= 4` branch.
    private var isWide: Bool {
        size.cols >= 4
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

extension BackupMonitorWidget {
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
                Image(systemName: "externaldrive")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                BackupMonitorStrings.text("widget.backupMonitor.title", "Backup Monitor")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                if model.phase != .loading { freshnessChip }
                refreshButton
                if onOpen != nil { openButton }
            }
        }
    }

    private var freshnessChip: some View {
        BackupFreshnessChip(connection: model.connection)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(BackupMonitorStrings.text("widget.backupMonitor.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                BackupMonitorStrings.text("widget.backupMonitor.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            BackupMonitorStrings.text("widget.backupMonitor.openA11y", "Open the backup & restore page")
        )
    }
}

// MARK: - Content states

extension BackupMonitorWidget {
    @ViewBuilder
    private var content: some View {
        if isCompact {
            compactContent
        } else {
            fullContent
        }
    }

    @ViewBuilder
    private var compactContent: some View {
        switch model.phase {
        case .loading: compactLoading
        case .error: compactError
        case .empty: compactEmpty
        case .content: compactBadge
        }
    }

    @ViewBuilder
    private var fullContent: some View {
        switch model.phase {
        case .loading: loadingChrome
        case let .error(message): errorState(message)
        case .empty: emptyState
        case .content: loadedContent
        }
    }

    // MARK: Compact

    @ViewBuilder
    private var compactBadge: some View {
        if let latest = model.latest {
            BackupCompactRow(
                latest: latest,
                lastBackupLabel: BackupMonitorStrings.string("widget.backupMonitor.lastBackup", "Last backup")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            compactEmpty
        }
    }

    private var compactEmpty: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "externaldrive")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            BackupMonitorStrings.text("widget.backupMonitor.noData", "No backup data")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    private var compactLoading: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 90, height: 16, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 56, height: 12, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(BackupMonitorStrings.text("widget.backupMonitor.loading", "Loading backup status"))
    }

    private var compactError: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.statusDanger)
            Button {
                model.refresh()
            } label: {
                BackupMonitorStrings.text("widget.backupMonitor.retry", "Retry")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Full

    @ViewBuilder
    private var loadedContent: some View {
        if let latest = model.latest {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live { connectivityBanner }
                statGrid(latest)
                if isWide { recentRuns }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
            emptyState
        }
    }

    private func statGrid(_ latest: BackupLatest) -> some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .top), count: 2),
            spacing: TSSpacing.sm
        ) {
            BackupStatTile(
                label: BackupMonitorStrings.string("widget.backupMonitor.lastBackup", "Last backup"),
                value: latest.lastBackupRelative
            )
            BackupStatTile(
                label: BackupMonitorStrings.string("widget.backupMonitor.size", "Backup Size"),
                value: latest.sizeText
            )
            BackupStatTile(
                label: BackupMonitorStrings.string("widget.backupMonitor.type", "Type"),
                value: latest.typeText
            )
            BackupStatusTile(
                label: BackupMonitorStrings.string("widget.backupMonitor.status", "Status"),
                statusLabel: latest.statusLabel,
                tone: latest.statusTone,
                showsFailedBackground: latest.showsFailedBackground
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityHint(Text(verbatim: BackupMonitorAccessibility.gridSummary(latest)))
    }

    private var recentRuns: some View {
        BackupRecentRunsList(
            title: BackupMonitorStrings.string("widget.backupMonitor.recentRuns", "Recent Runs"),
            rows: model.recentRows
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                BackupMonitorStrings.text("widget.backupMonitor.noData", "No backup data")
            } icon: {
                Image(systemName: "externaldrive")
            }
        } description: {
            BackupMonitorStrings.text(
                "widget.backupMonitor.emptyHint",
                "Backup runs will appear here once a schedule has run."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingChrome: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2),
            spacing: TSSpacing.sm
        ) {
            ForEach(0 ..< 4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 60, height: 10, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 90, height: 18, cornerRadius: TSRadius.sm)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.sm)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(BackupMonitorStrings.text("widget.backupMonitor.loading", "Loading backup status"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            BackupMonitorStrings.text("widget.backupMonitor.errorTitle", "Couldn't load backups")
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
                BackupMonitorStrings.text("widget.backupMonitor.retry", "Retry")
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

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.backupMonitor.offlineBanner" : "widget.backupMonitor.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last synced backups"
            : "Reconnecting — backup status may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            BackupMonitorStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
