//
//  RecentDrivesListWidget.swift
//  TeslaSync — P4 dashboard widget · 0078 · RecentDrivesListWidget (Apple)
//
//  The composable Recent Drives List dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/RecentDrivesListWidget.tsx. Binds through RDListModel
//  (no networking in the view); renders every state and the responsive narrow/wide list.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension RDListStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - RecentDrivesListWidget (the dashboard surface)

/// The composable Recent Drives List dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/RecentDrivesListWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) and the responsive narrow/wide
/// list inside a glass widget shell, binding through `RDListModel` (P1/S8). No networking
/// lives here; navigation is delegated to the injected `onViewAll` / `onOpenDrive` callbacks.
public struct RecentDrivesListWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RDListSurface.slug

    /// Canonical registry metadata (registry/driving.ts → "recent-drives-list").
    public static let registration = RDListSurface.registration

    @State private var model: RDListModel
    private let size: DashboardWidgetSize
    private let onViewAll: (() -> Void)?
    private let onOpenDrive: ((Int) -> Void)?

    public init(
        model: RDListModel,
        size: DashboardWidgetSize = RecentDrivesListWidget.registration.defaultSize,
        onViewAll: (() -> Void)? = nil,
        onOpenDrive: ((Int) -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = RecentDrivesListWidget.registration.clamp(size)
        self.onViewAll = onViewAll
        self.onOpenDrive = onOpenDrive
    }

    private var isWide: Bool {
        RecentDrivesLayout.isWide(cols: size.cols)
    }

    private var driveLimit: Int {
        RecentDrivesLayout.driveLimit(cols: size.cols, rows: size.rows)
    }

    /// The size-dependent projection, derived per render from the model's cached drives —
    /// the native parity of the web `useMemo(() => drives ?? [], [drives])` + row mapping.
    private var projection: RDListProjection {
        RecentDrivesProjector.project(
            drives: model.drives,
            units: model.units,
            limit: driveLimit,
            showsAddresses: isWide
        )
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

extension RecentDrivesListWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "road.lanes")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            RDListStrings.text("widget.recentDrivesList", "Recent Drives")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onViewAll != nil { viewAllButton }
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
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
            return RDListStrings.string("widget.recentDrivesList.updating", "Updating")
        }
        switch model.connection {
        case .live: return RDListStrings.string("widget.recentDrivesList.live", "Live")
        case .stale: return RDListStrings.string("widget.recentDrivesList.stale", "Stale")
        case .offline: return RDListStrings.string(
                "widget.recentDrivesList.offline",
                "Offline"
            )
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
        .accessibilityLabel(RDListStrings.text(
            "widget.recentDrivesList.refresh",
            "Refresh"
        ))
    }

    private var viewAllButton: some View {
        Button {
            onViewAll?()
        } label: {
            HStack(spacing: 2) {
                RDListStrings.text("widget.viewAll", "View all").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(RDListStrings.text(
            "widget.recentDrivesList.viewAllA11y",
            "View all drives"
        ))
    }
}

// MARK: - Content states

extension RecentDrivesListWidget {
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
            loadedContent
        }
    }

    private var loadingChrome: some View {
        TSTableSkeleton(rows: min(max(driveLimit, 3), 5))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .accessibilityElement()
            .accessibilityLabel(
                RDListStrings.text(
                    "widget.recentDrivesList.loading",
                    "Loading recent drives"
                )
            )
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                RDListStrings.text("widget.noDrivesList", "No recent drives recorded")
            } icon: {
                Image(systemName: "road.lanes")
            }
        } description: {
            RDListStrings.text(
                "widget.recentDrivesList.emptyHint",
                "Completed drives will appear here once your vehicle reports them."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            RDListStrings.text(
                "widget.recentDrivesList.errorTitle",
                "Couldn't load recent drives"
            )
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
                RDListStrings.text("widget.recentDrivesList.retry", "Retry")
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

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            driveList
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.recentDrivesList.offlineBanner" : "widget.recentDrivesList.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known drives"
            : "Reconnecting — drives may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            RDListStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var driveList: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: TSSpacing.xs) {
                ForEach(projection.rows) { row in
                    RecentDriveRowView(
                        row: row,
                        showsAddresses: projection.showsAddresses,
                        onOpen: onOpenDrive.map { handler in { handler(row.id) } }
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RDListAccessibility
                .listSummary(for: projection)))
    }
}
