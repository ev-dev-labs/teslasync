//
//  RecentDrivesWidget.swift
//  TeslaSync — P4 dashboard widget · 0079 · RecentDrivesWidget (Apple)
//
//  The composable Recent Drives dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/RecentDrivesWidget.tsx. Binds through `RecentDrivesWidgetModel`
//  (no networking in the view) and renders every state from the web source.
//

import SwiftUI

// MARK: - RecentDrivesWidget (the dashboard surface)

/// The composable Recent Drives dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/RecentDrivesWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding
/// through `RecentDrivesWidgetModel` (P1/S8). No networking lives here.
public struct RecentDrivesWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RecentDrivesWidgetSurface.slug

    /// Canonical registry metadata (registry/driving.ts → "recent-drives").
    public static let registration = RecentDrivesWidgetSurface.registration

    @State private var model: RecentDrivesWidgetModel
    private let size: DashboardWidgetSize
    private let onOpenAll: (() -> Void)?
    private let onOpenDrive: ((Int64) -> Void)?

    public init(
        model: RecentDrivesWidgetModel,
        size: DashboardWidgetSize = RecentDrivesWidget.registration.defaultSize,
        onOpenAll: (() -> Void)? = nil,
        onOpenDrive: ((Int64) -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = RecentDrivesWidget.registration.clamp(size)
        self.onOpenAll = onOpenAll
        self.onOpenDrive = onOpenDrive
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
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }

    /// SwiftUI `Text` from the P1/S10 catalog (the view holds no English literals).
    private func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: RecentDrivesWidgetStrings.string(key, fallback))
    }
}

extension RecentDrivesWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "road.lanes")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            text("widget.recentDrives", "Recent Drives")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            if model.phase != .loading {
                freshnessChip
            }
            refreshButton
            if onOpenAll != nil {
                viewAllButton
            }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = RecentDrivesWidgetStrings.string("widget.recentDrives.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = RecentDrivesWidgetStrings.string("widget.recentDrives.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = RecentDrivesWidgetStrings.string("widget.recentDrives.offline", "Offline")
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
        .accessibilityLabel(text("widget.recentDrives.refresh", "Refresh"))
    }

    /// Web header action: `Link to /drives` — "View all" + ↗.
    private var viewAllButton: some View {
        Button {
            onOpenAll?()
        } label: {
            HStack(spacing: 2) {
                text("widget.viewAll", "View all").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(text("widget.recentDrives.viewAllA11y", "View all drives"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            RecentDrivesLoadingRows()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            loadedList
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                text("widget.noDrives", "No recent drives")
            } icon: {
                Image(systemName: "road.lanes")
            }
        } description: {
            text("widget.recentDrives.emptyHint", "Drives will appear here once your vehicle logs a trip.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            text("widget.recentDrives.errorTitle", "Couldn't load recent drives")
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
                text("widget.recentDrives.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(text("widget.recentDrives.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                RecentDrivesWidgetRecentDrivesConnectivityBanner(connection: model.connection)
            }
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ForEach(model.projection.rows) { row in
                        RecentDrivesWidgetDriveRowView(row: row, onOpen: rowAction(for: row.id))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private func rowAction(for driveID: Int64) -> (() -> Void)? {
        guard let onOpenDrive else { return nil }
        return { onOpenDrive(driveID) }
    }
}
