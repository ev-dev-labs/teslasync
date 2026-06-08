//
//  SoftwareUpdateHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0091 · SoftwareUpdateHistoryWidget (Apple)
//
//  The composable Update History dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx. Binds through
//  `SoftwareUpdateHistoryModel` (no networking in the view); renders every state
//  and honors the same 1×4…4×40 grid envelope as the web registry. A 1-column
//  instance collapses to the compact latest-version badge, exactly like the
//  source's `size.cols <= 1` branch.
//

import Foundation
import SwiftUI

// MARK: - SoftwareUpdateHistoryWidget (the dashboard surface)

/// The Update History dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx`. Renders every
/// state from the web source (loading / empty / error / stale / offline /
/// content) inside a glass widget shell, binding through
/// `SoftwareUpdateHistoryModel` (P1/S8). No networking lives here.
public struct SoftwareUpdateHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SoftwareUpdateHistorySurface.slug

    /// Canonical registry metadata (registry/vehicle.ts → "software-update-history").
    public static let registration = SoftwareUpdateHistorySurface.registration

    @State private var model: SoftwareUpdateHistoryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SoftwareUpdateHistoryModel,
        size: DashboardWidgetSize = SoftwareUpdateHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SoftwareUpdateHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// A single-column instance collapses to the compact badge — the web
    /// `size.cols <= 1` branch.
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
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension SoftwareUpdateHistoryWidget {
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
                Image(systemName: "square.and.arrow.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesRegen)
                    .accessibilityHidden(true)
                SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory", "Update History")
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
        SoftwareUpdateFreshnessChip(connection: model.connection)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.openA11y", "Open the software updates page")
        )
    }
}

// MARK: - Content states

extension SoftwareUpdateHistoryWidget {
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
        case .loading:
            compactLoading
        case .error:
            compactError
        case .empty:
            compactEmpty
        case .content:
            compactBadge
        }
    }

    @ViewBuilder
    private var fullContent: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .empty:
            emptyState
        case .content:
            loadedContent
        }
    }

    // MARK: Compact

    @ViewBuilder
    private var compactBadge: some View {
        if let latest = model.latest {
            SoftwareUpdateCompactRow(latest: latest)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            compactEmpty
        }
    }

    private var compactEmpty: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            SoftwareUpdateHistoryStrings.text("widget.noUpdates", "No update history")
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
            TSSkeleton(width: 56, height: 16, cornerRadius: TSRadius.pill)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.loading", "Loading update history")
        )
    }

    private var compactError: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.statusDanger)
            Button {
                model.refresh()
            } label: {
                SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Full

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            SoftwareUpdateFeedList(items: model.feedItems)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityHint(Text(verbatim: SoftwareUpdateHistoryAccessibility
                        .feedSummary(count: model.feedItems.count)))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SoftwareUpdateHistoryStrings.text("widget.noUpdates", "No update history")
            } icon: {
                Image(systemName: "square.and.arrow.down")
            }
        } description: {
            SoftwareUpdateHistoryStrings.text(
                "widget.softwareUpdateHistory.emptyHint",
                "Installed firmware versions will appear here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 32, height: 32, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 120, height: 14, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 72, height: 12, cornerRadius: TSRadius.sm)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.loading", "Loading update history")
        )
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.errorTitle", "Couldn't load updates")
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
                SoftwareUpdateHistoryStrings.text("widget.softwareUpdateHistory.retry", "Retry")
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
        let key = isOffline
            ? "widget.softwareUpdateHistory.offlineBanner"
            : "widget.softwareUpdateHistory.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last synced updates"
            : "Reconnecting — updates may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SoftwareUpdateHistoryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
