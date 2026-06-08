//
//  CommandTile.Views.swift
//  TeslaSync — P4 feature view · 0226 · CommandTile (Apple)
//
//  The composed subviews for the CommandTile surface: the tappable glass tile (web
//  clickable `GlassPanel`), the favorite star (web ghost `Button` + `Star`), the
//  danger badge (web `AlertTriangle`), the icon box that swaps to a spinner while a
//  command is in flight (web `Loader2`), the label / sublabel block, the last-status
//  line (web green/red `lastStatus`), and the freshness chip. Every user-facing
//  string routes through the P1/S10 facade; every interactive element carries a
//  VoiceOver label.
//

import SwiftUI

// MARK: - Tile (web clickable `GlassPanel`)

/// The full command tile: a tappable glass panel with the favorite star and danger
/// badge layered in the corners (web absolute-positioned overlays). The whole panel
/// activates the command (web `onClick={handleClick}`); the star toggles the favorite
/// independently (web `e.stopPropagation()` via a sibling overlay button).
struct CommandTileButton: View {
    let model: CommandTileModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovering = false

    var body: some View {
        Button(action: { model.activate() }, label: {
            CommandTilePanel(model: model)
        })
        .buttonStyle(.plain)
        .disabled(!model.isInteractive)
        .background(
            TSMaterial.panel,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .opacity(model.isExecuting ? 0.5 : 1)
        .onHover { hovering in
            withAnimation(TSAnimation.fast(reduceMotion: reduceMotion)) { isHovering = hovering }
        }
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: accessibilityValue))
        .accessibilityHint(Text(verbatim: CommandTileAccessibility.activationHint(
            isDangerous: model.def.isDangerous,
            localize: CommandTileStrings.string
        )))
        .accessibilityIdentifier(CommandTileAccessibility.testID(commandID: model.def.id))
        .overlay(alignment: .topLeading) {
            CommandTileFavorite(model: model)
        }
        .overlay(alignment: .topTrailing) {
            if model.def.isDangerous {
                CommandTileDangerBadge()
            }
        }
    }

    /// Border tint: the variant tone on pointer hover (web `hover:border-neon-*`), the
    /// neutral glass border otherwise.
    private var borderColor: Color {
        isHovering ? model.def.variant.tone.color.opacity(0.5) : Color.TS.border
    }

    private var accessibilityLabel: String {
        CommandTileStrings.string(model.def.labelKey, model.def.labelFallback)
    }

    /// The spoken state suffix (executing / succeeded / failed / offline / stale).
    private var accessibilityValue: String {
        if model.isExecuting {
            return CommandTileStrings.string("commands.tile.state.running", "Running")
        }
        switch model.connection {
        case .offline:
            return CommandTileStrings.string("commands.tile.freshness.offline", "Offline")
        case .stale:
            return CommandTileStrings.string("commands.tile.freshness.stale", "Stale")
        case .live:
            break
        }
        switch model.outcome {
        case .succeeded:
            return CommandTileStrings.string("commands.tile.state.succeeded", "Succeeded")
        case .failed:
            return CommandTileStrings.string("commands.tile.state.failed", "Failed")
        case .none:
            return ""
        }
    }
}

// MARK: - Panel content (icon box + label block)

/// The centered tile content: the icon box (spinner while executing) above the label
/// block. Mirrors the web column layout (`flex flex-col items-center gap-2`).
struct CommandTilePanel: View {
    let model: CommandTileModel

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            CommandTileIconBox(systemImage: model.def.systemImage, isExecuting: model.isExecuting)
            CommandTileLabelBlock(model: model)
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(TSSpacing.lg)
        .multilineTextAlignment(.center)
    }
}

// MARK: - Icon box (web `Loader2` / `Icon` in a rounded surface)

/// The rounded icon container. Shows a spinner while a command is in flight (web
/// `loading ? <Loader2 animate-spin/> : <Icon/>`), otherwise the command's SF Symbol.
struct CommandTileIconBox: View {
    let systemImage: String
    let isExecuting: Bool

    var body: some View {
        ZStack {
            if isExecuting {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .regular))
            }
        }
        .frame(width: 24, height: 24)
        .padding(10)
        .foregroundStyle(Color.TS.textMuted)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityHidden(true)
    }
}

// MARK: - Label block (web label + sublabel + status line)

/// The label, optional sublabel, last-status line, and freshness chip stacked under
/// the icon. Always renders the label (never a blank tile).
struct CommandTileLabelBlock: View {
    let model: CommandTileModel

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: CommandTileStrings.string(model.def.labelKey, model.def.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            if model.def.hasSublabel {
                Text(verbatim: CommandTileStrings.string(
                    model.def.sublabelKey ?? "",
                    model.def.sublabelFallback ?? ""
                ))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }

            if case let .result(outcome) = model.phase {
                CommandTileStatusLine(outcome: outcome)
            }

            if let chip = CommandTileConnectionChip.project(model.connection) {
                CommandTileConnectionBadge(chip: chip)
            }
        }
    }
}

// MARK: - Status line (web green/red `lastStatus`)

/// The last-command-status line (web `lastStatus`): an outcome glyph + the message,
/// tinted success/danger.
struct CommandTileStatusLine: View {
    let outcome: CommandTileOutcome

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: outcome.systemImage)
                .font(.system(size: 9, weight: .bold))
                .accessibilityHidden(true)
            if let detail = outcome.detail {
                Text(verbatim: detail)
                    .font(.system(size: 9, weight: .medium))
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
            }
        }
        .foregroundStyle(outcome.tone.color)
        .padding(.top, 1)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (native live-state chrome: stale / offline)

/// The stale/offline freshness chip shown under the status line when the last outcome
/// is out of date or the tile is offline (native chrome over the controlled web prop).
struct CommandTileConnectionBadge: View {
    let chip: CommandTileConnectionChip

    var body: some View {
        let label = CommandTileStrings.string(chip.labelKey, chip.labelFallback)
        return HStack(spacing: 3) {
            Image(systemName: chip.systemImage)
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(.system(size: 9, weight: .medium))
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 1)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .padding(.top, 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Favorite star (web ghost `Button` + `Star`)

/// The favorite toggle in the tile's top-leading corner. A sibling overlay button so
/// its tap is independent of the tile activation (web `e.stopPropagation()`).
struct CommandTileFavorite: View {
    let model: CommandTileModel

    var body: some View {
        Button(action: { model.toggleFavorite() }, label: {
            Image(systemName: model.isFavorite ? "star.fill" : "star")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(model.isFavorite ? TSTone.warning.color : Color.TS.textMuted)
                .padding(TSSpacing.xs)
                .contentShape(Rectangle())
        })
        .buttonStyle(.plain)
        .padding(TSSpacing.xs)
        .accessibilityLabel(Text(verbatim: CommandTileAccessibility.favoriteLabel(
            localize: CommandTileStrings.string
        )))
        .accessibilityAddTraits(model.isFavorite ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(CommandTileAccessibility.favoriteTestID(commandID: model.def.id))
    }
}

// MARK: - Danger badge (web `AlertTriangle`)

/// The decorative danger marker in the tile's top-trailing corner for commands that
/// require confirmation (web `def.dangerous && <AlertTriangle/>`). Non-interactive;
/// the activation hint conveys the danger to VoiceOver.
struct CommandTileDangerBadge: View {
    var body: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(TSTone.danger.color.opacity(0.6))
            .padding(TSSpacing.sm)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
