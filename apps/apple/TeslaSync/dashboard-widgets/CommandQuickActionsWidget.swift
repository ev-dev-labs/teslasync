//
//  CommandQuickActionsWidget.swift
//  TeslaSync — P4 dashboard widget · 0030 · CommandQuickActionsWidget (Apple)
//
//  The composable Quick Actions dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/CommandQuickActionsWidget.tsx. A grid of vehicle
//  command buttons (Lock / Unlock / Climate / Frunk / Horn / Flash / Trunk) with
//  per-command running state and a "No vehicle selected" empty state. Binds through
//  `CommandQuickActionsModel` (no networking in the view); renders every state and
//  every layout (compact / standard / wide).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension CommandQuickActionsStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the
    /// model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Tone → Color (web per-command palette)

extension Color {
    /// Resolves a command tone to its exact web hex (`CommandQuickActionsTone.rgb`).
    /// A dynamic, per-item palette value, which is why it is built from components
    /// here rather than a static semantic token.
    init(commandTone tone: CommandQuickActionsTone) {
        let rgb = tone.rgb
        self = Color(.sRGB, red: rgb.red, green: rgb.green, blue: rgb.blue, opacity: 1)
    }
}

// MARK: - CommandQuickActionsWidget (the dashboard surface)

/// The composable Quick Actions dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/CommandQuickActionsWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / content, with stale + offline
/// freshness) and all three layouts inside a glass widget shell, binding through
/// `CommandQuickActionsModel` (P1/S8). Command dispatch is delegated to the model's
/// command seam (web `useVehicleCommand`); no networking lives here.
public struct CommandQuickActionsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CommandQuickActionsSurface.slug

    /// Canonical registry metadata (registry/commands.ts → "command-quick-actions").
    public static let registration = CommandQuickActionsSurface.registration

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model: CommandQuickActionsModel
    private let size: DashboardWidgetSize

    public init(
        model: CommandQuickActionsModel,
        size: DashboardWidgetSize = CommandQuickActionsWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = CommandQuickActionsWidget.registration.clamp(size)
    }

    private var layout: CommandQuickActionsLayout {
        CommandQuickActionsLayout.resolve(size)
    }

    /// The localized, view-ready commands for the current layout (web
    /// `visibleCommands.map(...)`). Pure projection from the catalog.
    private var items: [CommandQuickActionItem] {
        CommandQuickActionItemBuilder.build(
            actions: CommandQuickActionsCatalog.visible(for: layout),
            localize: CommandQuickActionsStrings.string
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if layout.showsHeader { header }
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

    /// Dispatches a command through the model's command seam (web `handleCommand`).
    private func dispatch(_ command: String) {
        Task { await model.dispatch(command) }
    }
}

// MARK: - Header (web `WidgetShell` chrome)

extension CommandQuickActionsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            CommandQuickActionsStrings.text("widget.quickActions.title", "Quick Actions")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt = model.updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
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
            return CommandQuickActionsStrings.string("widget.quickActions.updating", "Updating")
        }
        switch model.connection {
        case .live: return CommandQuickActionsStrings.string("widget.quickActions.live", "Live")
        case .stale: return CommandQuickActionsStrings.string("widget.quickActions.stale", "Stale")
        case .offline: return CommandQuickActionsStrings.string("widget.quickActions.offline", "Offline")
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
        .accessibilityLabel(CommandQuickActionsStrings.text("widget.quickActions.refresh", "Refresh"))
    }
}

// MARK: - Content states (web body)

extension CommandQuickActionsWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            CommandQuickActionsSkeletonGrid(layout: layout)
        case .empty:
            CommandQuickActionsEmptyState()
        case let .error(message):
            CommandQuickActionsErrorState(message: message) { model.refresh() }
        case .content:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            CommandQuickActionsGrid(
                items: items,
                layout: layout,
                runningCommand: model.activeCommand,
                isDispatching: model.isDispatching,
                reduceMotion: reduceMotion,
                onDispatch: dispatch
            )
            if let outcome = model.lastOutcome { resultLine(outcome) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.quickActions.offlineBanner" : "widget.quickActions.staleBanner"
        let fallback = isOffline
            ? "Offline — commands may not be delivered"
            : "Reconnecting — vehicle state may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            CommandQuickActionsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    /// The inline confirmation of the most recent dispatch — the native parity of the
    /// web `useVehicleCommand` success/error toast. Also announced to VoiceOver.
    private func resultLine(_ outcome: CommandDispatchOutcome) -> some View {
        let tone = outcome.success ? Color.TS.statusSuccess : Color.TS.statusDanger
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: outcome.success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: outcome.message)
                .font(Font.TS.caption)
                .lineLimit(2)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: CommandQuickActionsAccessibility.outcomeAnnouncement(outcome)))
        .accessibilityAddTraits(.updatesFrequently)
    }
}
