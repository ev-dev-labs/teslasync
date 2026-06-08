//
//  VampireDrainWidget.swift
//  TeslaSync — P4 dashboard widget · 0105 · VampireDrainWidget (Apple)
//
//  The composable Vampire Drain dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/VampireDrainWidget.tsx. Binds through
//  VampireDrainModel (no networking in the view); renders every state inside a
//  glass widget shell. The body composition (stat card / sparkline / feed /
//  compact stat / empty) lives in VampireDrainWidget.Views.swift.
//

import SwiftUI

// MARK: - VampireDrainWidget (the dashboard surface)

/// The composable Vampire Drain dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/VampireDrainWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `VampireDrainModel` (P1/S8). No networking
/// lives here.
public struct VampireDrainWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VampireDrainWidget"

    /// Canonical registry metadata (registry/energy.ts → "vampire-drain"). Reuses
    /// the shared dashboard registry types declared by the DigitalTwin sibling.
    public static let registration = DashboardWidgetRegistration(
        id: "vampire-drain",
        nameKey: "widget.vampireDrain.title",
        descriptionKey: "widget.vampireDrain.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: VampireDrainModel
    @State private var showHelp = false
    private let size: DashboardWidgetSize

    public init(
        model: VampireDrainModel,
        size: DashboardWidgetSize = VampireDrainWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = VampireDrainWidget.registration.clamp(size)
    }

    /// The web `size.cols <= 1` single-stat compact layout.
    var isCompact: Bool {
        size.cols <= 1
    }

    /// The web `size.cols >= 3` wide layout (adds the sparkline).
    var isWide: Bool {
        size.cols >= 3
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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

extension VampireDrainWidget {
    // MARK: Header (web WidgetShell title row)

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "battery.25")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                VampireDrainStrings.text("widget.vampireDrain.title", "Vampire Drain")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                helpButton
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
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
        .accessibilityLabel(VampireDrainStrings.text("widget.vampireDrain.helpA11y", "More info about Vampire Drain"))
        .popover(isPresented: $showHelp) {
            VampireDrainStrings.text(
                "help.vampireDrain.body",
                """
                Idle energy lost while the car is parked and not charging. We compute it as the % of \
                battery used per hour while the vehicle reports gear=Park and is not in motion.
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

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = VampireDrainStrings.string("widget.vampireDrain.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = VampireDrainStrings.string("widget.vampireDrain.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = VampireDrainStrings.string("widget.vampireDrain.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if !isCompact {
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
        .accessibilityLabel(VampireDrainStrings.text("widget.vampireDrain.refresh", "Refresh"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            DrainEmptyState()
        case let .error(message):
            errorState(message)
        case .content:
            contentBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: isCompact ? 90 : 150, height: isCompact ? 28 : 20)
            if !isCompact {
                ForEach(0 ..< 3, id: \.self) { _ in
                    HStack(spacing: TSSpacing.sm) {
                        TSSkeleton(width: 20, height: 20, cornerRadius: TSRadius.pill)
                        VStack(alignment: .leading, spacing: 4) {
                            TSSkeleton(height: 10)
                            TSSkeleton(width: 80, height: 8)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: isCompact ? .center : .leading)
        .accessibilityElement()
        .accessibilityLabel(VampireDrainStrings.text("widget.vampireDrain.loading", "Loading vampire drain"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            VampireDrainStrings.text("widget.vampireDrain.errorTitle", "Couldn't load vampire drain")
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
                VampireDrainStrings.text("widget.vampireDrain.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.statusWarning.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.statusWarning)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var contentBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live { connectivityBanner }
            if isCompact {
                DrainCompactStat(avgPerDay: model.avgDrainPerDay)
            } else {
                DrainStatCard(avgPerDay: model.avgDrainPerDay, stats: model.stats)
                if isWide, model.sparkline.count > 1 {
                    DrainSparkline(
                        values: model.sparkline,
                        tone: VampireDrainBuilder.drainTone(perDay: model.avgDrainPerDay)
                    )
                }
                DrainFeed(items: model.feedItems)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.vampireDrain.offlineBanner" : "widget.vampireDrain.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known drain"
            : "Reconnecting — drain may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            VampireDrainStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
