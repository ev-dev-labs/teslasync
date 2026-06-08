//
//  MonthlyMileageWidget.swift
//  TeslaSync — P4 dashboard widget · 0065 · MonthlyMileageWidget (Apple)
//
//  The composable Monthly Mileage dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MonthlyMileageWidget.tsx. Binds through
//  `MonthlyMileageModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - MonthlyMileageWidget (the dashboard surface)

/// The composable Monthly Mileage dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/MonthlyMileageWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `MonthlyMileageModel` (P1/S8).
/// No networking lives here.
public struct MonthlyMileageWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MonthlyMileageWidget"

    /// Canonical registry metadata (registry/analytics.ts → "monthly-mileage").
    public static let registration = DashboardWidgetRegistration(
        id: "monthly-mileage",
        nameKey: "widget.monthlyMileage.title",
        descriptionKey: "widget.monthlyMileage.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: MonthlyMileageModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: MonthlyMileageModel,
        size: DashboardWidgetSize = MonthlyMileageWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = MonthlyMileageWidget.registration.clamp(size)
        self.onOpen = onOpen
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
        .task(id: staleRefreshToken) { await autoRefreshWhenStale() }
        .accessibilityElement(children: .contain)
    }

    /// Restarts whenever connection/freshness changes so the stale auto-refresh
    /// re-arms exactly once per stale window.
    private var staleRefreshToken: String {
        "\(model.connection)-\(model.updatedAt?.timeIntervalSince1970 ?? 0)"
    }

    /// Stale state → auto-refresh after a short grace period (web
    /// `DataFreshnessAuto`). Cancelled automatically when a fresher snapshot
    /// arrives or the view disappears.
    private func autoRefreshWhenStale() async {
        guard model.connection == .stale else { return }
        try? await Task.sleep(for: .seconds(30))
        guard !Task.isCancelled, model.connection == .stale else { return }
        model.refresh()
    }
}

// MARK: - Header

extension MonthlyMileageWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "chart.bar.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            MonthlyMileageStrings.text("widget.monthlyMileage.title", "Monthly Mileage")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
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
            label = MonthlyMileageStrings.string("widget.monthlyMileage.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MonthlyMileageStrings.string("widget.monthlyMileage.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MonthlyMileageStrings.string("widget.monthlyMileage.offline", "Offline")
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
        .accessibilityLabel(MonthlyMileageStrings.text("widget.monthlyMileage.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                MonthlyMileageStrings.text("widget.monthlyMileage.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            MonthlyMileageStrings.text("widget.monthlyMileage.openA11y", "Open the mileage analytics page")
        )
    }
}

// MARK: - Content states

extension MonthlyMileageWidget {
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
            mileageContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< 2, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 52, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 70, height: 14, cornerRadius: TSRadius.sm)
                    }
                }
            }
            if !MonthlyMileageModel.isCompact(size) {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(MonthlyMileageStrings.text("widget.monthlyMileage.loading", "Loading monthly mileage"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                MonthlyMileageStrings.text("widget.monthlyMileage.noData", "No mileage data")
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        } description: {
            MonthlyMileageStrings.text(
                "widget.monthlyMileage.emptyHint",
                "Drive history will appear here once trips are recorded."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            MonthlyMileageStrings.text("widget.monthlyMileage.errorTitle", "Couldn't load monthly mileage")
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
                MonthlyMileageStrings.text("widget.monthlyMileage.retry", "Retry")
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

// MARK: - Loaded content (stat header + bar chart)

extension MonthlyMileageWidget {
    private var mileageContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statRow
            if !MonthlyMileageModel.isCompact(size) {
                MonthlyMileageChart(
                    bars: model.projection.bars,
                    unit: model.projection.distanceUnit,
                    isWide: MonthlyMileageModel.isWide(size)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var statRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            statCell(
                labelKey: "widget.monthlyMileage.thisMonth",
                labelFallback: "This Month",
                value: model.projection.currentMonthDistance
            )
            statCell(
                labelKey: "widget.monthlyMileage.total12m",
                labelFallback: "12-Mo Total",
                value: model.projection.total12mDistance
            )
            Spacer(minLength: 0)
        }
    }

    private func statCell(labelKey: String, labelFallback: String, value: Double) -> some View {
        let unit = model.projection.distanceUnit
        return VStack(alignment: .leading, spacing: 2) {
            MonthlyMileageStrings.text(labelKey, labelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: MonthlyMileageFormat.int(value))
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(MonthlyMileageStrings.string(labelKey, labelFallback)) "
                + "\(MonthlyMileageFormat.int(value)) \(unit)")
        )
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.monthlyMileage.offlineBanner" : "widget.monthlyMileage.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved mileage"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            MonthlyMileageStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
