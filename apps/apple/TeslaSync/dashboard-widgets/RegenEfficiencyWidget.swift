//
//  RegenEfficiencyWidget.swift
//  TeslaSync — P4 dashboard widget · 0081 · RegenEfficiencyWidget (Apple)
//
//  The composable Regen Braking dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/RegenEfficiencyWidget.tsx. Binds through `RegenEfficiencyModel` (no networking
//  in the view) and renders every state from the web source: loading / empty / error / content, with a live
//  / stale / offline freshness chip. Responsive: a single-column footprint collapses to the web's compact
//  gauge-only readout (`isCompact = size.cols <= 1`, the registry default); ≥ 2 columns show the titled
//  header, the radial recovery gauge, and the three supporting stats.
//

import SwiftUI

// MARK: - RegenEfficiencyWidget (the dashboard surface)

/// The composable Regen Braking dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/RegenEfficiencyWidget.tsx`. Renders the regenerative-braking recovery rate
/// (radial gauge), total energy recovered, monthly-average regen power, and equivalent free charges inside a
/// glass widget shell, binding through `RegenEfficiencyModel` (P1/S8). No networking lives here.
public struct RegenEfficiencyWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RegenEfficiencyWidget"

    /// Canonical registry metadata (registry/driving.ts → "regen-efficiency").
    public static let registration = DashboardWidgetRegistration(
        id: "regen-efficiency",
        nameKey: "widget.regenEfficiency.title",
        descriptionKey: "widget.regenEfficiency.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )

    @State private var model: RegenEfficiencyModel
    @State private var showHelp = false
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: RegenEfficiencyModel,
        size: DashboardWidgetSize = RegenEfficiencyWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = RegenEfficiencyWidget.registration.clamp(size)
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

extension RegenEfficiencyWidget {
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
            Image(systemName: "arrow.counterclockwise")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            RegenEfficiencyStrings.text("widget.regenEfficiency.title", "Regen Braking")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            helpButton
            Spacer(minLength: TSSpacing.sm)
            RegenFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
            RegenRefreshButton(isFetching: model.isFetching) { model.refresh() }
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
            RegenEfficiencyStrings.text("widget.regenEfficiency.helpA11y", "More info about Regen Braking")
        )
        .popover(isPresented: $showHelp) {
            RegenEfficiencyStrings.text(
                "help.regenEfficiency.body",
                """
                Energy recovered through regenerative braking divided by total energy used during driving. \
                Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving.
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
            RegenFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt,
                showsLabel: false
            )
            RegenRefreshButton(isFetching: model.isFetching) { model.refresh() }
        }
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                RegenEfficiencyStrings.text("widget.regenEfficiency.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            RegenEfficiencyStrings.text("widget.regenEfficiency.openA11y", "Open regen braking details")
        )
    }
}

// MARK: - Content bodies (compact + full)

extension RegenEfficiencyWidget {
    @ViewBuilder
    private var contentBody: some View {
        if isCompact {
            compactBody
        } else {
            fullBody
        }
    }

    /// The web compact branch: the recovery gauge only (web `WidgetGaugeHero compact`), vertically centered.
    private var compactBody: some View {
        let projection = model.projection
        return VStack(spacing: 0) {
            Spacer(minLength: 0)
            RegenGaugeRing(
                fraction: projection.gaugeFraction,
                percentText: projection.gaugePercentText,
                captionText: recoveryCaption,
                tint: projection.zone.color,
                diameter: 76
            )
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: RegenEfficiencyAccessibility.summary(for: projection)))
    }

    /// The web full branch: the radial recovery gauge over the three supporting stats.
    private var fullBody: some View {
        let projection = model.projection
        return VStack(spacing: TSSpacing.md) {
            RegenGaugeRing(
                fraction: projection.gaugeFraction,
                percentText: projection.gaugePercentText,
                captionText: recoveryCaption,
                tint: projection.zone.color,
                diameter: 104
            )
            statsRow(projection)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func statsRow(_ projection: RegenProjection) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            ForEach(projection.stats) { stat in
                RegenStatTile(
                    label: RegenEfficiencyStrings.string(stat.labelKey, stat.labelFallback),
                    value: stat.value
                )
            }
        }
    }

    private var recoveryCaption: String {
        RegenEfficiencyStrings.string("widget.regenEfficiency.recovery", "recovery")
    }
}

// MARK: - Non-ready states (loading / empty / error)

extension RegenEfficiencyWidget {
    /// The web `WidgetShell` loading branch: a skeleton standing in for the gauge (+ stats at ≥ 2 columns).
    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 110, height: 10)
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
        .accessibilityLabel(RegenEfficiencyStrings.text("widget.regenEfficiency.loading", "Loading regen data"))
    }

    /// The web `EmptyState` body (RotateCcw icon + "No regen data"), always shown — never a blank panel.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                RegenEfficiencyStrings.text("widget.regenEfficiency.noData", "No regen data")
            } icon: {
                Image(systemName: "arrow.counterclockwise")
            }
        } description: {
            RegenEfficiencyStrings.text(
                "widget.regenEfficiency.emptyHint",
                "Regen data will appear here once the vehicle reports drives."
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
            RegenEfficiencyStrings.text("widget.regenEfficiency.errorTitle", "Couldn't load regen data")
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
                RegenEfficiencyStrings.text("widget.regenEfficiency.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RegenEfficiencyStrings.text("widget.regenEfficiency.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
