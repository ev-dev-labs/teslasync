//
//  SolarProductionWidget.swift
//  TeslaSync — P4 dashboard widget · 0093 · SolarProductionWidget (Apple)
//
//  The composable Solar Production dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SolarProductionWidget.tsx. Binds through
//  SolarProductionModel (no networking in the view); renders every state inside a
//  glass widget shell.
//

import SwiftUI

// MARK: - SolarProductionWidget (the dashboard surface)

/// The composable Solar Production dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SolarProductionWidget.tsx`. Renders every state
/// from the web source (loading / no-site / empty / error / stale / offline /
/// content) across the compact and standard layouts inside a glass widget shell,
/// binding through `SolarProductionModel` (P1/S8). No networking lives here.
public struct SolarProductionWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SolarProductionWidget"

    /// Canonical registry metadata (registry/energy.ts → "solar-production").
    public static let registration = DashboardWidgetRegistration(
        id: "solar-production",
        nameKey: "widget.solarProduction.title",
        descriptionKey: "widget.solarProduction.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SolarProductionModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SolarProductionModel,
        size: DashboardWidgetSize = SolarProductionWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SolarProductionWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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

    private var isCompact: Bool {
        SolarProductionModel.isCompact(for: size)
    }

    private var isWide: Bool {
        SolarProductionModel.isWide(for: size)
    }

    /// Whether the title row is shown — the web renders a title only in the
    /// standard layout (the compact + no-site shells are title-less, with the
    /// freshness indicator overlaid as a dot).
    private var showsTitle: Bool {
        !isCompact && model.phase != .noSite
    }
}

// MARK: - Header

extension SolarProductionWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if showsTitle {
                Image(systemName: "sun.max.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesEnergy)
                    .accessibilityHidden(true)
                SolarProductionStrings.text("widget.solarProduction.title", "Solar Production")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityAddTraits(.isHeader)
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
        switch model.freshness {
        case .fresh:
            tone = Color.TS.statusSuccess
            label = SolarProductionStrings.string("widget.solarProduction.fresh", "Updated")
        case .stale:
            tone = Color.TS.statusWarning
            label = SolarProductionStrings.string("widget.solarProduction.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SolarProductionStrings.string("widget.solarProduction.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if showsTitle {
                Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
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
        .accessibilityLabel(SolarProductionStrings.text("widget.solarProduction.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SolarProductionStrings.text("widget.solarProduction.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SolarProductionStrings.text("widget.solarProduction.openA11y", "Open the Energy page"))
    }
}

// MARK: - Content states

extension SolarProductionWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .noSite:
            noSiteState
        case let .error(message):
            errorState(message)
        case .content:
            solarBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< (isCompact ? 2 : 3), id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(height: 8, cornerRadius: TSRadius.sm).frame(width: 44)
                        TSSkeleton(height: 14, cornerRadius: TSRadius.sm).frame(width: 60)
                    }
                }
                Spacer(minLength: 0)
            }
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SolarProductionStrings.text("widget.solarProduction.loading", "Loading solar production"))
    }

    private var noSiteState: some View {
        emptyState(
            title: SolarProductionStrings.string("widget.solarProduction.noSite", "No Tesla Energy site linked"),
            hint: SolarProductionStrings.string(
                "widget.solarProduction.noSiteHint",
                "Link a Tesla Energy site (Powerwall or solar) to see production."
            ),
            systemImage: "sun.max.trianglebadge.exclamationmark"
        )
    }

    private var noDataState: some View {
        emptyState(
            title: SolarProductionStrings.string("widget.solarProduction.noData", "No solar data"),
            hint: SolarProductionStrings.string(
                "widget.solarProduction.noDataHint",
                "Daily solar generation will appear here once the site reports."
            ),
            systemImage: "sun.max"
        )
    }

    private func emptyState(title: String, hint: String, systemImage: String) -> some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: title)
            } icon: {
                Image(systemName: systemImage)
            }
        } description: {
            Text(verbatim: hint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SolarProductionStrings.text("widget.solarProduction.errorTitle", "Couldn't load solar production")
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
                SolarProductionStrings.text("widget.solarProduction.retry", "Retry")
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

// MARK: - Content body (stats + chart)

extension SolarProductionWidget {
    @ViewBuilder
    private var solarBody: some View {
        if model.projection.hasData {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.freshness != .fresh { freshnessBanner }
                SolarStatRow(stats: stats)
                if !isCompact {
                    SolarProductionChart(projection: model.projection, wide: isWide)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        } else {
            noDataState
        }
    }

    /// The Today / 30-Day Total / Daily-Avg metrics. Compact drops the 30-day
    /// total (web: compact shows only Today + Daily Avg).
    private var stats: [SolarStat] {
        let projection = model.projection
        let unit = SolarProductionStrings.string("widget.solarProduction.unitKwh", "kWh")
        let today = SolarStat(
            id: "today",
            label: SolarProductionStrings.string("widget.solarProduction.today", "Today"),
            value: SolarProductionFormat.number(projection.todayKwh, fractionDigits: 1),
            unit: unit
        )
        let avg = SolarStat(
            id: "avg",
            label: SolarProductionStrings.string("widget.solarProduction.avg", "Daily Avg"),
            value: SolarProductionFormat.number(projection.avgKwh, fractionDigits: 1),
            unit: unit
        )
        if isCompact { return [today, avg] }
        let total = SolarStat(
            id: "total",
            label: SolarProductionStrings.string("widget.solarProduction.total30d", "30-Day Total"),
            value: SolarProductionFormat.integer(projection.totalKwh),
            unit: unit
        )
        return [today, total, avg]
    }

    private var freshnessBanner: some View {
        let isOffline = model.freshness == .offline
        let key = isOffline ? "widget.solarProduction.offlineBanner" : "widget.solarProduction.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known production"
            : "Data may be stale — refreshing"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SolarProductionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
