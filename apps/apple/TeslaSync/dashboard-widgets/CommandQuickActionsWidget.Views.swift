//
//  CommandQuickActionsWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0030 · CommandQuickActionsWidget (Apple)
//
//  The presentational subviews composed by `CommandQuickActionsWidget`: the
//  responsive command-button grid, the individual command button (icon / spinner /
//  label with running + disabled states — web ghost `Button`), the redacted loading
//  grid, the "No vehicle selected" empty state, and the error state. All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Command grid (web `grid grid-cols-2 @xs:grid-cols-3/4`)

/// The responsive grid of command buttons. `layout.columns` mirrors the web
/// breakpoints (2 compact / 3 standard / 4 wide), and the visible commands are the
/// web size-based slice (4 / 6 / 8).
struct CommandQuickActionsGrid: View {
    let items: [CommandQuickActionItem]
    let layout: CommandQuickActionsLayout
    let runningCommand: String?
    let isDispatching: Bool
    let reduceMotion: Bool
    let onDispatch: (String) -> Void

    var body: some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(items) { item in
                CommandQuickActionButton(
                    item: item,
                    showsLabel: layout.showsLabels,
                    isRunning: runningCommand == item.command,
                    isDisabled: isDispatching,
                    reduceMotion: reduceMotion
                ) {
                    onDispatch(item.command)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: max(1, layout.columns))
    }
}

// MARK: - Command button (web ghost `<Button>` tile)

/// One command button: a tinted icon (or a spinner while running) above an optional
/// label, inside a glass tile — the native port of the web ghost `Button`. Disabled
/// while any command is in flight (web `disabled={!!activeCommand}`); the in-flight
/// command shows the spinner (web `isRunning`).
struct CommandQuickActionButton: View {
    let item: CommandQuickActionItem
    let showsLabel: Bool
    let isRunning: Bool
    let isDisabled: Bool
    let reduceMotion: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: showsLabel ? 6 : 0) {
                glyph
                if showsLabel {
                    Text(verbatim: item.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.vertical, showsLabel ? TSSpacing.sm : TSSpacing.xs)
            .padding(.horizontal, TSSpacing.xs)
            .frame(maxWidth: .infinity, minHeight: showsLabel ? 56 : 44)
            .background(Color.TS.surfaceGlass, in: tileShape)
            .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(tileShape)
        }
        .buttonStyle(CommandQuickActionButtonStyle(reduceMotion: reduceMotion))
        .disabled(isDisabled)
        // Dim the idle buttons while another command runs; keep the in-flight one lit.
        .opacity(isDisabled && !isRunning ? 0.45 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityHint(Text(verbatim: item.accessibilityHint))
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder
    private var glyph: some View {
        if isRunning {
            ProgressView()
                .controlSize(.small)
                .tint(Color.TS.accent)
                .frame(width: 20, height: 20)
        } else {
            Image(systemName: item.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(commandTone: item.tone))
                .frame(width: 20, height: 20)
        }
    }

    private var accessibilityLabel: String {
        isRunning
            ? CommandQuickActionsAccessibility.runningLabel(
                label: item.label,
                localize: CommandQuickActionsStrings.string
            )
            : item.accessibilityLabel
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }
}

/// Press feedback for a command button: a subtle scale-down on press that mirrors the
/// web `hover:bg-white/[0.08]` affordance, suppressed under Reduce Motion.
struct CommandQuickActionButtonStyle: ButtonStyle {
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Loading grid (web shell `Skeleton`)

/// The redacted loading grid: skeleton tiles in the same responsive layout as the
/// content grid, so the surface never flashes a blank box on first mount.
struct CommandQuickActionsSkeletonGrid: View {
    let layout: CommandQuickActionsLayout

    var body: some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< layout.visibleCount, id: \.self) { _ in
                VStack(spacing: layout.showsLabels ? 6 : 0) {
                    TSSkeleton(width: 20, height: 20, cornerRadius: TSRadius.sm)
                    if layout.showsLabels {
                        TSSkeleton(width: 36, height: 8)
                    }
                }
                .padding(.vertical, layout.showsLabels ? TSSpacing.sm : TSSpacing.xs)
                .padding(.horizontal, TSSpacing.xs)
                .frame(maxWidth: .infinity, minHeight: layout.showsLabels ? 56 : 44)
                .background(Color.TS.surfaceGlass, in: tileShape)
                .overlay(tileShape.strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: CommandQuickActionsStrings.string(
            "widget.quickActions.loading",
            "Loading quick actions"
        )))
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: max(1, layout.columns))
    }

    private var tileShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }
}

// MARK: - Empty state (web `EmptyState` — no vehicle selected)

/// The friendly empty state shown when no vehicle is resolved (web `id ? grid :
/// EmptyState`). Always rendered in place of a blank panel — never a hidden surface.
struct CommandQuickActionsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                CommandQuickActionsStrings.text("widget.quickActions.noVehicle", "No vehicle selected")
            } icon: {
                Image(systemName: "bolt.fill")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error state (web `QueryError`)

/// The error state with a retry affordance, shown when the vehicles query fails and
/// there is no cached vehicle to fall back to (web `QueryError` intent).
struct CommandQuickActionsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CommandQuickActionsStrings.text("widget.quickActions.errorTitle", "Couldn't load vehicle")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                CommandQuickActionsStrings.text("widget.quickActions.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CommandQuickActionsStrings.text("widget.quickActions.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
