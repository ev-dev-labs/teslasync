//
//  FleetStatsWidget.swift
//  TeslaSync — P4 dashboard widget · 0051 · FleetStatsWidget (Apple)
//
//  The composable Fleet Stats dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/FleetStatsWidget.tsx, which renders
//  `<WidgetShell noPadding updatedAt isFetching isStale isError onRefresh>` wrapping the
//  `<FleetStatsBar>` leaf. The native widget reproduces that composition exactly: the
//  glass widget container + the title-less freshness/refresh control (web `WidgetShell`
//  `DataFreshness`), with the embedded `FleetStatsBar` rendering every state from the
//  source (loading / empty / error / stale / offline / content) and both sparklines.
//
//  Binds through `FleetStatsWidgetModel` (which composes `FleetStatsBarViewModel`, P1/S8);
//  no networking lives here.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension FleetStatsWidgetStrings {
    /// SwiftUI `Text` for a key with the English fallback. Kept here (not in the model
    /// file) so the model + adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - FleetStatsWidget (the dashboard surface)

/// The composable Fleet Stats dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/FleetStatsWidget.tsx`. Wraps the shared `FleetStatsBar`
/// in the widget chrome (glass container + freshness/refresh control), registers the
/// canonical `fleet-stats` grid metadata, and emits the widget's `view.opened`
/// diagnostics. The embedded bar owns the five-card body + the load/freshness states.
public struct FleetStatsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FleetStatsWidgetSurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "fleet-stats").
    public static let registration = FleetStatsWidgetSurface.registration

    @State private var model: FleetStatsWidgetModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: FleetStatsWidgetModel,
        size: DashboardWidgetSize = FleetStatsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = FleetStatsWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// The narrowest supported footprint (the `fleet-stats` min is 2 columns); used to
    /// trade the freshness chip's relative-time label for the short status word.
    private var isCompact: Bool {
        size.cols <= 2
    }

    private var freshnessTone: FleetStatsWidgetFreshnessTone {
        FleetStatsWidgetFreshness.tone(
            connection: model.bar.connection,
            refreshing: model.bar.refreshing
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            FleetStatsBar(model: model.bar)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `WidgetShell` title-less freshness overlay + optional open)

extension FleetStatsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            FleetStatsWidgetFreshnessChip(
                tone: freshnessTone,
                updatedAt: model.bar.updatedAt,
                showsRelativeTime: !isCompact,
                onRefresh: { model.refresh() }
            )
            if let onOpen {
                openButton(onOpen)
            }
        }
    }

    private func openButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 2) {
                FleetStatsWidgetStrings.text("widget.fleetStats.open", "Open")
                    .font(Font.TS.caption)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            FleetStatsWidgetStrings.text("widget.fleetStats.openA11y", "Open the analytics dashboard")
        )
    }
}

// MARK: - Freshness chip (web `WidgetShell` `DataFreshness` control)

/// The tappable freshness control: a status dot + connectivity glyph + relative-time /
/// status label. Tapping refetches (the web chip is the refresh control). The fetching
/// glyph spins unless Reduce Motion is on.
private struct FleetStatsWidgetFreshnessChip: View {
    let tone: FleetStatsWidgetFreshnessTone
    var updatedAt: Date?
    var showsRelativeTime: Bool
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: 4) {
                Circle()
                    .fill(tone.color)
                    .frame(width: 6, height: 6)
                Image(systemName: FleetStatsWidgetFreshness.symbol(for: tone))
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(.degrees(isSpinning ? 360 : 0))
                    .animation(spinAnimation, value: spin)
                label
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .onAppear { spin = FleetStatsWidgetFreshness.isAnimating(tone) }
        .onChange(of: tone) { _, newTone in spin = FleetStatsWidgetFreshness.isAnimating(newTone) }
        .accessibilityLabel(FleetStatsWidgetStrings.text("widget.fleetStats.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: statusText))
    }

    @ViewBuilder
    private var label: some View {
        if showsRelativeTime, let updatedAt, tone != .offline, tone != .fetching {
            Text(updatedAt, style: .relative)
                .font(Font.TS.caption)
                .monospacedDigit()
                .lineLimit(1)
        } else {
            Text(verbatim: statusText)
                .font(Font.TS.caption)
                .lineLimit(1)
        }
    }

    private var statusText: String {
        let descriptor = FleetStatsWidgetFreshness.label(for: tone)
        return FleetStatsWidgetStrings.string(descriptor.key, descriptor.fallback)
    }

    private var isSpinning: Bool {
        tone == .fetching && !reduceMotion && spin
    }

    private var spinAnimation: Animation? {
        reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false)
    }
}

// MARK: - Tone → design token

private extension FleetStatsWidgetFreshnessTone {
    /// The brand token color for the chip dot/glyph (web `DataFreshness` status color).
    var color: Color {
        switch self {
        case .live: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}
