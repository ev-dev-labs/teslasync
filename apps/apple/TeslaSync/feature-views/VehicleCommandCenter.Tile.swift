//
//  VehicleCommandCenter.Tile.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The individual command tile composed by the command grids — the native parity of the
//  web `CommandTile` / `ToggleCommandTile` / `InputCommandTile` as rendered inside
//  VehicleCommandCenter.tsx. A tappable glass tile with a favorite star, an optional
//  danger affordance, an icon that swaps to a spinner while a command is in flight, a
//  label/sublabel, the bound on/off state for toggles, and the last-status line. It is
//  fully controlled by `VehicleCommandCenterModel` (P1/S8) — activation + favorite
//  toggles call back to the bound model; no networking lives here.
//

import SwiftUI

/// One command tile. Renders the action / toggle / input variants and every per-tile
/// state (idle / executing / on / off / last-status / favorite) from the controlled
/// inputs the model supplies.
struct VCCCommandTileView: View {
    let command: VehicleCommand
    let isFavorite: Bool
    let isOn: Bool
    let isExecuting: Bool
    let isDisabled: Bool
    let statusLine: String?
    let onActivate: () -> Void
    let onToggleFavorite: () -> Void

    private var tone: TSTone {
        command.variant.tone
    }

    /// A toggle that is currently on lights up with its variant tone (web on-state wash).
    private var isActive: Bool {
        command.kind == .toggle && isOn
    }

    var body: some View {
        Button(action: onActivate) { tileSurface }
            .buttonStyle(.plain)
            .disabled(isExecuting || isDisabled)
            .opacity(isDisabled ? 0.55 : 1)
            .accessibilityLabel(
                Text(verbatim: VehicleCommandCenterStrings.string(command.labelKey, command.labelFallback))
            )
            .accessibilityValue(Text(verbatim: accessibilityValue))
            .accessibilityHint(Text(verbatim: accessibilityHint))
            .accessibilityIdentifier("command-tile-\(command.id)")
            .overlay(alignment: .topTrailing) { favoriteButton }
            .accessibilityElement(children: .contain)
    }

    /// The tile's tappable surface (icon row + label + status), inside the glass card.
    private var tileSurface: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            topRow
            labelBlock
            if let statusLine {
                statusView(statusLine)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .padding(TSSpacing.md)
        .background(background)
        .overlay(border)
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }

    // MARK: Rows

    /// The icon (or in-flight spinner) plus the danger affordance.
    private var topRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            iconView
            Spacer(minLength: 0)
            if command.isDangerous {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                    .padding(.trailing, 22)
            }
        }
    }

    @ViewBuilder
    private var iconView: some View {
        if isExecuting {
            ProgressView()
                .controlSize(.small)
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
        } else {
            Image(systemName: displaySymbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(isActive ? tone.color : Color.TS.textSecondary)
                .frame(width: 32, height: 32)
                .background(
                    (isActive ? tone.color : Color.TS.textMuted).opacity(isActive ? 0.16 : 0.08),
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .accessibilityHidden(true)
        }
    }

    /// The toggle off-symbol when bound off (web `iconOff`), else the primary symbol.
    private var displaySymbol: String {
        if command.kind == .toggle, !isOn, let off = command.systemImageOff {
            return off
        }
        return command.systemImage
    }

    private var labelBlock: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: VehicleCommandCenterStrings.string(command.labelKey, command.labelFallback))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if command.kind == .toggle {
                    Text(verbatim: onOffLabel)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(isOn ? tone.color : Color.TS.textMuted)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(
                            (isOn ? tone.color : Color.TS.textMuted).opacity(0.15),
                            in: Capsule()
                        )
                }
            }
            if command.hasSublabel, let key = command.sublabelKey, let fallback = command.sublabelFallback {
                Text(verbatim: VehicleCommandCenterStrings.string(key, fallback))
                    .font(.system(size: 10))
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
    }

    private var onOffLabel: String {
        isOn
            ? VehicleCommandCenterStrings.string("commands.on", "ON")
            : VehicleCommandCenterStrings.string("commands.off", "OFF")
    }

    /// The last-status line, green for a `✓` outcome, red otherwise (web `lastStatus`).
    private func statusView(_ line: String) -> some View {
        let success = line.hasPrefix("✓")
        return Text(verbatim: line)
            .font(.system(size: 10))
            .foregroundStyle(success ? Color.TS.statusSuccess : Color.TS.statusDanger)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }

    private var favoriteButton: some View {
        Button(action: onToggleFavorite) {
            Image(systemName: isFavorite ? "star.fill" : "star")
                .font(.system(size: 12))
                .foregroundStyle(isFavorite ? Color.TS.statusWarning : Color.TS.textMuted)
                .padding(TSSpacing.sm)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(VehicleCommandCenterStrings.text("commands.toggleFavorite", "Toggle favorite"))
        .accessibilityAddTraits(isFavorite ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("command-tile-favorite-\(command.id)")
    }

    // MARK: Surfaces

    private var background: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(isActive ? tone.color.opacity(0.06) : Color.TS.surfaceGlass)
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(
                isActive ? tone.color.opacity(0.4) : Color.TS.border,
                lineWidth: 1
            )
    }

    // MARK: Accessibility

    private var accessibilityValue: String {
        var parts: [String] = []
        if command.kind == .toggle {
            parts.append(onOffLabel)
        }
        if isExecuting {
            parts.append(VehicleCommandCenterStrings.string("commands.tile.running", "Running"))
        }
        if let statusLine {
            parts.append(statusLine)
        }
        return parts.joined(separator: ", ")
    }

    private var accessibilityHint: String {
        if command.dialog != nil {
            return VehicleCommandCenterStrings.string("commands.tile.hint.configure", "Opens options before running")
        }
        if command.isDangerous {
            return VehicleCommandCenterStrings.string(
                "commands.tile.hint.confirm",
                "Asks for confirmation before running"
            )
        }
        return VehicleCommandCenterStrings.string("commands.tile.hint.run", "Runs the command")
    }
}
