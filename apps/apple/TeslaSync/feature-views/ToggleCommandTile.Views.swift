//
//  ToggleCommandTile.Views.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  The composed subviews for the ToggleCommandTile surface: the tappable glass tile (web
//  clickable `GlassPanel`, tinted with the variant tone while on), the favorite star (web
//  ghost `Button` + `Star`), the status dot (web top-right rounded dot), the icon box
//  that swaps to the off symbol when off and to a spinner while a command is in flight
//  (web `Loader2` / `Icon` / `iconOff`), the label + ON / OFF power line (web
//  `commands.on` / `commands.off`), the last-status line (web green/red `lastStatus`), and
//  the freshness chip. Every user-facing string routes through the P1/S10 facade; every
//  interactive element carries a VoiceOver label.
//

import SwiftUI

// MARK: - Tile (web clickable `GlassPanel`)

/// The full toggle tile: a tappable glass panel that takes the variant tone (border +
/// wash) while on, with the favorite star and status dot layered in the corners (web
/// absolute-positioned overlays). The whole panel activates the toggle (web
/// `onClick={handleClick}`); the star toggles the favorite independently (web
/// `e.stopPropagation()` via a sibling overlay button).
struct ToggleCommandTileButton: View {
    let model: ToggleCommandTileModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovering = false

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    var body: some View {
        Button(action: { model.activate() }, label: {
            ToggleCommandTilePanel(model: model)
        })
        .buttonStyle(.plain)
        .disabled(!model.isInteractive)
        .background(ToggleCommandTileSurfaceFill(tone: model.activeTone, shape: shape))
        .overlay(shape.strokeBorder(borderColor, lineWidth: 1))
        .contentShape(shape)
        .opacity(model.isExecuting ? 0.5 : 1)
        .onHover { hovering in
            withAnimation(TSAnimation.fast(reduceMotion: reduceMotion)) { isHovering = hovering }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: accessibilityValue))
        .accessibilityHint(Text(verbatim: ToggleCommandTileAccessibility.activationHint(
            isOn: model.isOn,
            requiresInput: model.def.requiresInput,
            localize: ToggleCommandTileStrings.string
        )))
        .accessibilityIdentifier(ToggleCommandTileAccessibility.testID(commandID: model.def.id))
        .overlay(alignment: .topLeading) {
            ToggleCommandTileFavorite(model: model)
        }
        .overlay(alignment: .topTrailing) {
            ToggleCommandTileStatusDot(tone: model.activeTone)
        }
    }

    /// Border tint: the active tone while on (web `styles.panel` border), a brighter
    /// neutral on pointer hover (web off-state `hover:border-[var(--border-subtle)]`),
    /// the neutral glass border otherwise.
    private var borderColor: Color {
        if let tone = model.activeTone {
            return tone.color.opacity(0.45)
        }
        return isHovering ? Color.TS.textMuted.opacity(0.4) : Color.TS.border
    }

    private var accessibilityLabel: String {
        ToggleCommandTileStrings.string(model.def.labelKey, model.def.labelFallback)
    }

    /// The spoken state suffix (running / on / off, then succeeded / failed / freshness).
    private var accessibilityValue: String {
        if model.isExecuting {
            return ToggleCommandTileStrings.string("commands.toggleTile.state.running", "Running")
        }
        var parts = [ToggleCommandTileAccessibility.powerValue(
            isOn: model.isOn,
            localize: ToggleCommandTileStrings.string
        )]
        switch model.connection {
        case .offline:
            parts.append(ToggleCommandTileStrings.string("commands.tile.freshness.offline", "Offline"))
        case .stale:
            parts.append(ToggleCommandTileStrings.string("commands.tile.freshness.stale", "Stale"))
        case .live:
            break
        }
        switch model.outcome {
        case .succeeded:
            parts.append(ToggleCommandTileStrings.string("commands.toggleTile.state.succeeded", "Succeeded"))
        case .failed:
            parts.append(ToggleCommandTileStrings.string("commands.toggleTile.state.failed", "Failed"))
        case .none:
            break
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Surface fill (web `GlassPanel` + `bg-neon-*/5` wash while on)

/// The tile's layered background: the system glass material with the variant-tone wash
/// drawn over it while the toggle is on (web `styles.panel` background), behind content.
struct ToggleCommandTileSurfaceFill: View {
    let tone: TSTone?
    let shape: RoundedRectangle

    var body: some View {
        shape
            .fill(tone?.color.opacity(0.08) ?? Color.clear)
            .background(TSMaterial.panel, in: shape)
    }
}

// MARK: - Panel content (icon box + label block)

/// The centered tile content: the icon box (spinner while executing) above the label
/// block. Mirrors the web column layout (`flex flex-col items-center gap-2`).
struct ToggleCommandTilePanel: View {
    let model: ToggleCommandTileModel

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ToggleCommandTileIconBox(
                systemImage: model.def.systemImage(isOn: model.isOn),
                tone: model.activeTone,
                isExecuting: model.isExecuting
            )
            ToggleCommandTileLabelBlock(model: model)
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(TSSpacing.lg)
        .multilineTextAlignment(.center)
    }
}

// MARK: - Icon box (web `Loader2` / `Icon` / `iconOff` in a rounded surface)

/// The rounded icon container. Shows a spinner while a command is in flight (web
/// `loading ? <Loader2 animate-spin/> : <Icon/>`), otherwise the command's current SF
/// Symbol. Takes the variant tone (filled tint + symbol) while on, the neutral glass
/// surface otherwise (web `styles.icon` vs `bg-surface-2 text-muted`).
struct ToggleCommandTileIconBox: View {
    let systemImage: String
    let tone: TSTone?
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
        .foregroundStyle(tone?.color ?? Color.TS.textMuted)
        .background(tone?.color.opacity(0.18) ?? Color.TS.surface, in: RoundedRectangle(
            cornerRadius: TSRadius.md,
            style: .continuous
        ))
        .accessibilityHidden(true)
    }
}

// MARK: - Label block (web label + ON/OFF + status line)

/// The command label, the ON / OFF power line, the last-status line, and the freshness
/// chip stacked under the icon. Always renders the label + power (never a blank tile).
struct ToggleCommandTileLabelBlock: View {
    let model: ToggleCommandTileModel

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: ToggleCommandTileStrings.string(model.def.labelKey, model.def.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            Text(verbatim: ToggleCommandTileStrings.string(model.power.labelKey, model.power.labelFallback))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(model.activeTone?.color ?? Color.TS.textMuted)
                .accessibilityHidden(true)

            if case let .result(outcome) = model.phase {
                ToggleCommandTileStatusLine(outcome: outcome)
            }

            if let chip = ToggleCommandConnectionChip.project(model.connection) {
                ToggleCommandTileConnectionBadge(chip: chip)
            }
        }
    }
}

// MARK: - Status line (web green/red `lastStatus`)

/// The last-command-status line (web `lastStatus`): an outcome glyph + the message,
/// tinted success/danger.
struct ToggleCommandTileStatusLine: View {
    let outcome: ToggleCommandOutcome

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

/// The stale/offline freshness chip shown under the status line when the last outcome is
/// out of date or the tile is offline (native chrome over the controlled web prop).
struct ToggleCommandTileConnectionBadge: View {
    let chip: ToggleCommandConnectionChip

    var body: some View {
        let label = ToggleCommandTileStrings.string(chip.labelKey, chip.labelFallback)
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

/// The favorite toggle in the tile's top-leading corner. A sibling overlay button so its
/// tap is independent of the tile activation (web `e.stopPropagation()`).
struct ToggleCommandTileFavorite: View {
    let model: ToggleCommandTileModel

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
        .accessibilityLabel(Text(verbatim: ToggleCommandTileAccessibility.favoriteLabel(
            localize: ToggleCommandTileStrings.string
        )))
        .accessibilityAddTraits(model.isFavorite ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(ToggleCommandTileAccessibility.favoriteTestID(commandID: model.def.id))
    }
}

// MARK: - Status dot (web top-right rounded dot)

/// The decorative power dot in the tile's top-trailing corner (web `isOn ? styles.dot :
/// bg-surface-2`). Non-interactive; the tile's accessibility value conveys on/off.
struct ToggleCommandTileStatusDot: View {
    let tone: TSTone?

    var body: some View {
        Circle()
            .fill(tone?.color ?? Color.TS.surface)
            .frame(width: 8, height: 8)
            .padding(TSSpacing.sm)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
