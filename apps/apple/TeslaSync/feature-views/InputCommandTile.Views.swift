//
//  InputCommandTile.Views.swift
//  TeslaSync — P4 feature view · 0232 · InputCommandTile (Apple)
//
//  The presentational subviews composed by `InputCommandTile`: the data tile (the
//  favorite star, the icon box with its in-flight spinner, the label / sublabel /
//  ✓-or-✗ status stack, and the freshness chip) plus the loading / empty / error
//  chrome. All consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `hover:border-neon-{tone}`
//  affordance has no hover on touch, so the variant accent is mapped to a token
//  border that is faint at rest and intensifies on press — `default → accent`,
//  `danger → statusDanger`, `success → statusSuccess`. The ✓/✗ status line maps the
//  web `neon-green/60` / `neon-red/60` to the toned `statusSuccess` / `statusDanger`.
//

import SwiftUI

// MARK: - Data tile (web non-empty render: star + icon + labels + status)

/// The resolved command tile — the icon box (spinner while a command is in flight),
/// the label/sublabel/status stack, the corner favorite star, and the freshness
/// chip, wrapped in the shared fade-in (web `FadeIn`).
struct InputCommandDataTile: View {
    let def: CommandTileDef
    let state: InputCommandTileResolved
    let connection: InputCommandConnection
    let onActivate: () -> Void
    let onToggleFavorite: () -> Void

    var body: some View {
        TSFadeIn {
            ZStack(alignment: .topLeading) {
                Button(action: onActivate) { tileBody }
                    .buttonStyle(InputCommandTileButtonStyle(accent: state.accent, dimmed: state.isExecuting))
                    .disabled(!state.isInteractive)
                    .accessibilityLabel(Text(verbatim: accessibilityLabel))
                    .accessibilityHint(Text(verbatim: accessibilityHint))

                favoriteStar
                    .padding(TSSpacing.sm)
            }
            .overlay(alignment: .topTrailing) {
                if connection != .live {
                    InputCommandFreshnessChip(connection: connection)
                        .padding(TSSpacing.sm)
                }
            }
        }
    }

    private var tileBody: some View {
        VStack(spacing: TSSpacing.sm) {
            iconBox
            labelStack
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
    }

    private var iconBox: some View {
        ZStack {
            if state.isExecuting {
                ProgressView().controlSize(.regular)
            } else {
                Image(systemName: def.systemImage)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(width: 44, height: 44)
        .background(
            Color.TS.textMuted.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityHidden(true)
    }

    private var labelStack: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.bodySm.weight(.medium))
                .foregroundStyle(Color.TS.textPrimary)

            if let sublabel {
                Text(verbatim: sublabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }

            if let status = state.status {
                Text(verbatim: status.displayText)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(status.outcome == .success ? Color.TS.statusSuccess : Color.TS.statusDanger)
                    .accessibilityLabel(Text(verbatim: statusAccessibilityLabel(status)))
            }
        }
    }

    private var favoriteStar: some View {
        Button(action: onToggleFavorite) {
            Image(systemName: state.isFavorite ? "star.fill" : "star")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(state.isFavorite ? Color.TS.statusWarning : Color.TS.textMuted)
                .padding(TSSpacing.xs)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: InputCommandStrings.string("commands.toggleFavorite", "Toggle favorite")))
        .accessibilityAddTraits(state.isFavorite ? [.isButton, .isSelected] : .isButton)
    }

    private var label: String {
        InputCommandStrings.string(def.labelKey, def.labelFallback)
    }

    private var sublabel: String? {
        guard def.hasSublabel else { return nil }
        return InputCommandStrings.string(def.sublabelKey ?? "", def.sublabelFallback ?? "")
    }

    private var accessibilityLabel: String {
        CommandTileAccessibility.tileLabel(label: label, sublabel: sublabel)
    }

    private var accessibilityHint: String {
        if connection == .offline {
            return InputCommandStrings.string("inputCommand.offlineHint", "Offline — connect to send commands")
        }
        if state.isExecuting {
            return InputCommandStrings.string("inputCommand.executingHint", "Sending command")
        }
        return InputCommandStrings.string("inputCommand.openHint", "Opens command options")
    }

    private func statusAccessibilityLabel(_ status: CommandTileStatus) -> String {
        let wording = status.outcome == .success
            ? InputCommandStrings.string("inputCommand.statusSuccessA11y", "Last result succeeded")
            : InputCommandStrings.string("inputCommand.statusFailureA11y", "Last result failed")
        return CommandTileAccessibility.statusLabel(outcomeWording: wording, detail: status.detail)
    }
}

// MARK: - Tile button style (glass surface + variant accent + press feedback)

/// The tappable tile chrome: the shared glass panel clipped to the tile radius, the
/// variant accent border (faint at rest, brighter on press — the hover-free mapping
/// of the web `hover:border-neon-{tone}`), the in-flight dim (web `opacity-50`), and
/// a subtle press scale.
struct InputCommandTileButtonStyle: ButtonStyle {
    let accent: CommandTileAccent
    let dimmed: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, minHeight: 100)
            .padding(TSSpacing.lg)
            .tsGlassPanel(cornerRadius: TSRadius.lg)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(accentColor.opacity(borderOpacity(pressed: configuration.isPressed)), lineWidth: 1)
            )
            .opacity(dimmed ? 0.5 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: TSMotion.fastDuration), value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
    }

    private var accentColor: Color {
        switch accent {
        case .neutral: Color.TS.accent
        case .danger: Color.TS.statusDanger
        case .success: Color.TS.statusSuccess
        }
    }

    private func borderOpacity(pressed: Bool) -> Double {
        if accent == .neutral {
            return pressed ? 0.35 : 0
        }
        return pressed ? 0.6 : 0.3
    }
}

// MARK: - Freshness chip (P4 leaf connectivity axis)

/// The corner freshness chip — a tinted dot + label shown when the bound data is
/// stale or offline (hidden when live).
struct InputCommandFreshnessChip: View {
    let connection: InputCommandConnection

    var body: some View {
        HStack(spacing: 3) {
            Circle().fill(tone).frame(width: 5, height: 5)
            Text(verbatim: label)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .background(tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var label: String {
        connection == .offline
            ? InputCommandStrings.string("inputCommand.offline", "Offline")
            : InputCommandStrings.string("inputCommand.stale", "Stale")
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a skeleton icon box over skeleton label lines, so the
/// tile keeps its shape while the parent query resolves.
struct InputCommandLoadingTile: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 44, height: 44, cornerRadius: TSRadius.md)
            TSSkeleton(width: 64, height: 10)
            TSSkeleton(width: 40, height: 8)
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(TSSpacing.lg)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: InputCommandStrings.string("inputCommand.loadingA11y", "Loading command")))
    }
}

/// The empty render: a friendly "command unavailable" tile, never a blank box, shown
/// when no command is bound (e.g. unsupported for the selected vehicle).
struct InputCommandUnavailableTile: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "slash.circle")
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 44, height: 44)
                .background(
                    Color.TS.textMuted.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            Text(verbatim: InputCommandStrings.string("inputCommand.unavailableTitle", "Command unavailable"))
                .font(Font.TS.bodySm.weight(.medium))
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: InputCommandStrings.string(
                "inputCommand.unavailableMessage",
                "This command isn't available for this vehicle."
            ))
            .font(.system(size: 9))
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(TSSpacing.lg)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: InputCommandStrings.string(
            "inputCommand.unavailableTitle", "Command unavailable"
        )))
    }
}

/// The fetch-failure tile (web `QueryError` peer) with a retry affordance.
struct InputCommandErrorTile: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: InputCommandStrings.string("inputCommand.errorTitle", "Couldn't load command"))
                .font(Font.TS.bodySm.weight(.medium))
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: InputCommandStrings.string("inputCommand.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: InputCommandStrings.string("inputCommand.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(TSSpacing.lg)
        .tsGlassPanel(cornerRadius: TSRadius.lg)
        .accessibilityElement(children: .combine)
    }
}
