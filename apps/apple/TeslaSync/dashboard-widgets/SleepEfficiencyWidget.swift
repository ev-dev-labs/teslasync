//
//  SleepEfficiencyWidget.swift
//  TeslaSync — P4 dashboard widget · 0090 · SleepEfficiencyWidget (Apple)
//
//  The composable Sleep Efficiency dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/SleepEfficiencyWidget.tsx. Binds through `SleepEfficiencyModel` (no networking
//  in the view) and renders every state from the web source: loading / empty / error / content, with a live
//  / stale / offline freshness chip. Responsive: a single-column footprint collapses to the web's compact
//  gauge-only readout (`isCompact = size.cols <= 1`, the registry default); ≥ 2 columns show the titled
//  header, the radial efficiency gauge with its "Efficiency" caption, and the three supporting stats.
//

import SwiftUI

// MARK: - SleepEfficiencyWidget (the dashboard surface)

/// The composable Sleep Efficiency dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SleepEfficiencyWidget.tsx`. Renders how well the car sleeps (radial
/// efficiency gauge), the average daily idle drain, total sleep hours, and the wake-event count inside a
/// glass widget shell, binding through `SleepEfficiencyModel` (P1/S8). No networking lives here.
public struct SleepEfficiencyWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SleepEfficiencyWidget"

    /// Canonical registry metadata (registry/energy.ts → "sleep-efficiency").
    public static let registration = DashboardWidgetRegistration(
        id: "sleep-efficiency",
        nameKey: "widget.sleepEfficiency.title",
        descriptionKey: "widget.sleepEfficiency.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )

    @State private var model: SleepEfficiencyModel
    @State private var showHelp = false
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SleepEfficiencyModel,
        size: DashboardWidgetSize = SleepEfficiencyWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SleepEfficiencyWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// The web `isCompact = size.cols <= 1` branch (the registry default 1×2 is compact).
    private var isCompact: Bool {
        size.cols <= 1
    }

    public var body: some View {
        content
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

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .empty:
            readyContainer { emptyState }
        case .content:
            readyContainer { contentBody }
        }
    }
}

// MARK: - Chrome (header / compact overlay)

extension SleepEfficiencyWidget {
    /// Wraps a ready (non-loading, non-error) body in the correct chrome: the full titled header row at ≥ 2
    /// columns, or the web title-less compact layout with an overlaid freshness indicator.
    @ViewBuilder
    private func readyContainer(@ViewBuilder _ body: () -> some View) -> some View {
        if isCompact {
            ZStack(alignment: .topTrailing) {
                body()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                compactFreshnessOverlay
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                body()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "moon.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            SleepEfficiencyStrings.text("widget.sleepEfficiency.title", "Sleep Efficiency")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            helpButton
            Spacer(minLength: TSSpacing.sm)
            SleepFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
            SleepRefreshButton(isFetching: model.isFetching) { model.refresh() }
            if onOpen != nil { openButton }
        }
    }

    private var helpButton: some View {
        Button {
            showHelp.toggle()
        } label: {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            SleepEfficiencyStrings.text("widget.sleepEfficiency.helpA11y", "More info about Sleep Efficiency")
        )
        .popover(isPresented: $showHelp) {
            SleepEfficiencyStrings.text(
                "help.sleepEfficiency.body",
                """
                Share of parked time the car spent in true low-power sleep (vs. idle/online). Higher is \
                better — more sleep means less vampire drain and lower battery wear.
                """
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.leading)
            .padding(TSSpacing.md)
            .frame(maxWidth: 260)
            .presentationCompactAdaptation(.popover)
        }
    }

    private var compactFreshnessOverlay: some View {
        HStack(spacing: TSSpacing.xs) {
            SleepFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt,
                showsLabel: false
            )
            SleepRefreshButton(isFetching: model.isFetching) { model.refresh() }
        }
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SleepEfficiencyStrings.text("widget.sleepEfficiency.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            SleepEfficiencyStrings.text("widget.sleepEfficiency.openA11y", "Open sleep efficiency details")
        )
    }
}

// MARK: - Content bodies (compact + full)

extension SleepEfficiencyWidget {
    @ViewBuilder
    private var contentBody: some View {
        if isCompact {
            compactBody
        } else {
            fullBody
        }
    }

    /// The web compact branch: the efficiency gauge only (web `WidgetGaugeHero compact`, `label: ''`),
    /// vertically centered.
    private var compactBody: some View {
        let projection = model.projection
        return VStack(spacing: 0) {
            Spacer(minLength: 0)
            SleepGaugeRing(
                fraction: projection.gaugeFraction,
                valueText: projection.gaugeValueText,
                unitText: projection.gaugeUnit,
                captionText: nil,
                tint: projection.zone.color,
                diameter: 76
            )
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SleepEfficiencyAccessibility.summary(for: projection)))
    }

    /// The web full branch: the radial efficiency gauge (with its "Efficiency" caption) over the three
    /// supporting stats.
    private var fullBody: some View {
        let projection = model.projection
        return VStack(spacing: TSSpacing.md) {
            SleepGaugeRing(
                fraction: projection.gaugeFraction,
                valueText: projection.gaugeValueText,
                unitText: projection.gaugeUnit,
                captionText: efficiencyCaption,
                tint: projection.zone.color,
                diameter: 104
            )
            statsRow(projection)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func statsRow(_ projection: SleepProjection) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            ForEach(projection.stats) { stat in
                SleepStatTile(
                    label: SleepEfficiencyStrings.string(stat.labelKey, stat.labelFallback),
                    value: stat.value,
                    unit: stat.unit
                )
            }
        }
    }

    private var efficiencyCaption: String {
        SleepEfficiencyStrings.string("widget.sleepEfficiency.efficiency", "Efficiency")
    }
}

// MARK: - Non-ready states (loading / empty / error)

extension SleepEfficiencyWidget {
    /// The web `WidgetShell` loading branch: a skeleton standing in for the gauge (+ stats at ≥ 2 columns).
    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 120, height: 10)
                    Spacer(minLength: 0)
                    TSSkeleton(width: 44, height: 10)
                }
            }
            TSSkeleton(height: isCompact ? 76 : 104, cornerRadius: TSRadius.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if !isCompact {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(0 ..< 3, id: \.self) { _ in
                        TSSkeleton(height: 36, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(SleepEfficiencyStrings.text("widget.sleepEfficiency.loading", "Loading sleep data"))
    }

    /// The web `EmptyState` body (Moon icon + "No sleep efficiency data"), always shown — never a blank
    /// panel.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SleepEfficiencyStrings.text("widget.sleepEfficiency.noData", "No sleep efficiency data")
            } icon: {
                Image(systemName: "moon.fill")
            }
        } description: {
            SleepEfficiencyStrings.text(
                "widget.sleepEfficiency.emptyHint",
                "Sleep data will appear here once the vehicle reports parked time."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// The web `WidgetShell` error branch (`QueryError`) with a retry affordance.
    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
            SleepEfficiencyStrings.text("widget.sleepEfficiency.errorTitle", "Couldn't load sleep data")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            Button {
                model.refresh()
            } label: {
                SleepEfficiencyStrings.text("widget.sleepEfficiency.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SleepEfficiencyStrings.text("widget.sleepEfficiency.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
