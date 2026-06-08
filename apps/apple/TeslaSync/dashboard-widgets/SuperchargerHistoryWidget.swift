//
//  SuperchargerHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0098 · SuperchargerHistoryWidget (Apple)
//
//  The composable Supercharger History dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/SuperchargerHistoryWidget.tsx. Binds through
//  SuperchargerHistoryModel (no networking in the view); renders every state and
//  honors the same 1×2…4×40 grid envelope as the web registry. A 1-column
//  instance collapses to the compact 30-day spend hero, exactly like the source.
//

import Foundation
import SwiftUI

// MARK: - SuperchargerHistoryWidget (the dashboard surface)

/// The Supercharger History dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/SuperchargerHistoryWidget.tsx`. Renders every
/// state from the web source (loading / empty / error / stale / offline /
/// content) inside a glass widget shell, binding through
/// `SuperchargerHistoryModel` (P1/S8). No networking lives here.
public struct SuperchargerHistoryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SuperchargerHistoryWidget"

    /// Canonical registry metadata (registry/charging.ts → "supercharger-history").
    public static let registration = DashboardWidgetRegistration(
        id: "supercharger-history",
        nameKey: "widget.superchargerHistory.title",
        descriptionKey: "widget.superchargerHistory.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SuperchargerHistoryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SuperchargerHistoryModel,
        size: DashboardWidgetSize = SuperchargerHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SuperchargerHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// A single-column instance collapses to the compact spend hero — the web
    /// `size.cols <= 1` branch.
    private var isCompact: Bool {
        SuperchargerHistoryModel.isCompact(for: size)
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

extension SuperchargerHistoryWidget {
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
                Image(systemName: "bolt.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesEnergy)
                    .accessibilityHidden(true)
                SuperchargerHistoryStrings.text("widget.superchargerHistory.title", "Supercharger History")
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
        SuperchargerFreshnessChip(connection: model.connection)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SuperchargerHistoryStrings.text("widget.superchargerHistory.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SuperchargerHistoryStrings.text("widget.superchargerHistory.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            SuperchargerHistoryStrings.text("widget.superchargerHistory.openA11y", "Open the Supercharger history page")
        )
    }
}

// MARK: - Content states

extension SuperchargerHistoryWidget {
    @ViewBuilder
    private var content: some View {
        if isCompact {
            compactContent
        } else {
            fullContent
        }
    }

    // MARK: Compact

    @ViewBuilder
    private var compactContent: some View {
        switch model.phase {
        case .loading:
            compactLoading
        case let .error(message):
            compactError(message)
        case .empty:
            compactEmpty
        case .content:
            SuperchargerSpendHero(
                unit: SuperchargerHistoryStrings.string("widget.superchargerHistory.currencyUnit", "$"),
                number: model.projection.compactSpendText,
                label: SuperchargerHistoryStrings.string(
                    "widget.superchargerHistory.compactLabel",
                    "30-day Supercharger"
                )
            )
        }
    }

    private var compactLoading: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 72, height: 30, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 64, height: 12, cornerRadius: TSRadius.pill)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            SuperchargerHistoryStrings.text("widget.superchargerHistory.loading", "Loading Supercharger history")
        )
    }

    private var compactEmpty: some View {
        emptyState(compact: true)
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
        case .empty:
            emptyState(compact: false)
        case .content:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                SuperchargerConnectivityBanner(connection: model.connection)
            }
            SuperchargerRankedList(items: model.projection.items, maxValue: model.projection.maxValue)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            SuperchargerTotalsRow(
                energyText: model.projection.totalEnergyText,
                spendText: model.projection.totalSpendText
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: fullAccessibilityLabel))
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 36, cornerRadius: TSRadius.md)
            }
            TSSkeleton(height: 18, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            SuperchargerHistoryStrings.text("widget.superchargerHistory.loading", "Loading Supercharger history")
        )
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SuperchargerHistoryStrings.text("widget.superchargerHistory.errorTitle", "Couldn't load sessions")
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

    private func emptyState(compact: Bool) -> some View {
        ContentUnavailableView {
            Label {
                SuperchargerHistoryStrings.text("widget.superchargerHistory.noData", "No Supercharger sessions")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            if !compact {
                SuperchargerHistoryStrings.text(
                    "widget.superchargerHistory.emptyHint",
                    "Supercharger sessions from your Tesla account will appear here."
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func retryButton(emphasized: Bool) -> some View {
        Button {
            model.refresh()
        } label: {
            if emphasized {
                SuperchargerHistoryStrings.text("widget.superchargerHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            } else {
                SuperchargerHistoryStrings.text("widget.superchargerHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
        }
        .buttonStyle(.plain)
    }

    private func errorAccessibilityLabel(_ message: String) -> String {
        let title = SuperchargerHistoryStrings.string("widget.superchargerHistory.errorTitle", "Couldn't load sessions")
        return message.isEmpty ? title : "\(title). \(message)"
    }

    private var fullAccessibilityLabel: String {
        SuperchargerHistoryAccessibility.summary(
            sessionCount: model.projection.items.count,
            totalEnergyText: model.projection.totalEnergyText,
            totalSpendText: model.projection.totalSpendText
        )
    }
}
