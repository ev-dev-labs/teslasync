//
//  ProjectedRangeWidget.swift
//  TeslaSync — P4 dashboard widget · 0074 · ProjectedRangeWidget (Apple)
//
//  The composable Projected Range dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ProjectedRangeWidget.tsx. Binds through
//  `ProjectedRangeModel` (no networking in the view); renders every state (loading /
//  empty / error / stale / offline / content) and every responsive layout
//  (compact 1×2 / standard 2×2 / wide ≥3 cols).
//

import Foundation
import SwiftUI

// MARK: - ProjectedRangeWidget (the dashboard surface)

/// The composable Projected Range dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ProjectedRangeWidget.tsx`. Renders every state from
/// the web source inside a glass widget shell, binding through `ProjectedRangeModel`
/// (P1/S8). No networking lives here.
public struct ProjectedRangeWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ProjectedRangeWidget"

    /// Canonical registry metadata (registry/battery.ts → "projected-range").
    public static let registration = DashboardWidgetRegistration(
        id: "projected-range",
        nameKey: "widget.projectedRange",
        descriptionKey: "widget.projectedRange.description",
        category: "battery",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )

    @State private var model: ProjectedRangeModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ProjectedRangeModel,
        size: DashboardWidgetSize = ProjectedRangeWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ProjectedRangeWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1`.
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isWide = size.cols >= 3`.
    private var isWide: Bool {
        size.cols >= 3
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

extension ProjectedRangeWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "location.north.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                ProjectedRangeStrings.text("widget.projectedRange.title", "Projected Range")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
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
            label = ProjectedRangeStrings.string("widget.projectedRange.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ProjectedRangeStrings.string("widget.projectedRange.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ProjectedRangeStrings.string("widget.projectedRange.offline", "Offline")
        }
        return HStack(spacing: 4) {
            if model.isRefetching {
                ProgressView().controlSize(.mini)
            } else {
                Circle().fill(tone).frame(width: 6, height: 6)
            }
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
        .accessibilityLabel(ProjectedRangeStrings.text("widget.projectedRange.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ProjectedRangeStrings.text("widget.projectedRange.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(ProjectedRangeStrings.text(
            "widget.projectedRange.openA11y",
            "Open the Projected Range page"
        ))
    }

    // MARK: Content states

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
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                Spacer()
                TSSkeleton(width: 120, height: 30, cornerRadius: TSRadius.sm)
                Spacer()
            }
            TSSkeleton(height: 8, cornerRadius: TSRadius.pill)
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 44, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(ProjectedRangeStrings.text("widget.projectedRange.loading", "Loading projected range"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                ProjectedRangeStrings.text("widget.projectedRange.noData", "No projected range data")
            } icon: {
                Image(systemName: "location.north.fill")
            }
        } description: {
            ProjectedRangeStrings.text(
                "widget.projectedRange.emptyHint",
                "A projection appears once enough driving history is collected."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ProjectedRangeStrings.text("widget.projectedRange.errorTitle", "Couldn't load projected range")
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
                ProjectedRangeStrings.text("widget.projectedRange.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ProjectedRangeStrings.text("widget.projectedRange.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if let stats = model.stats {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live {
                    ProjectedRangeConnectivityBanner(connection: model.connection)
                }
                if isCompact {
                    ProjectedRangeBigNumber(stats: stats)
                } else {
                    standardOrWide(stats)
                }
            }
        } else {
            emptyState
        }
    }

    @ViewBuilder
    private func standardOrWide(_ stats: ProjectedRangeStats) -> some View {
        if isWide {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ProjectedRangePrimaryReadout(stats: stats)
                ProjectedRangeComparisonBar(stats: stats)
                ScrollView {
                    ProjectedRangeFactorsList(factors: stats.factors)
                }
                .frame(maxHeight: .infinity)
            }
        } else {
            VStack(spacing: TSSpacing.md) {
                ProjectedRangePrimaryReadout(stats: stats)
                ProjectedRangeComparisonBar(stats: stats)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
    }
}
