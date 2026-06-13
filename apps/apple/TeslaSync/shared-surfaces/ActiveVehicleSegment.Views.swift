//
//  ActiveVehicleSegment.Views.swift
//  TeslaSync — P4 shared surface · 0176 · ActiveVehicleSegment (Apple)
//
//  The presentational pieces of the footer active-vehicle segment — the native peers of the web elements:
//  the active-vehicle chip (web `<span>` / `<button>` with the `Car` glyph, the truncated name, the
//  `battery% · range` metrics, and — when switchable — the chevron), the switcher (web listbox popover →
//  a HIG-idiomatic `Menu` of every vehicle, the current one checkmarked), and the P4 leaf chrome the native
//  state matrix adds so the segment is never a blank box: a loading skeleton chip, a friendly "No vehicle"
//  chip (the web returns `null` for an empty fleet), a compact error tile with retry, and the freshness
//  chip. All chrome is token-driven (P1/S9); every string resolves through the P1/S10 facade; every
//  interactive element carries a VoiceOver label. No networking — every affordance routes back through the
//  state-holder.
//

import SwiftUI

// MARK: - Layout constants (web footer-tier `text-[11px]` / `h-3 w-3` sizing)

enum ActiveVehicleSegmentLayout {
    /// The `Car` / status glyph size (web `h-3 w-3`).
    static let iconSize: CGFloat = 12
    /// The switcher chevron size (web `h-3 w-3`, rendered as the compact selector indicator).
    static let chevronSize: CGFloat = 9
    /// The minimum touch target height for the footer chip.
    static let minHeight: CGFloat = 24
    /// Max width of the truncating name before it elides (web `max-w-[140px]` / `[160px]`).
    static let labelMaxWidth: CGFloat = 160
    /// The freshness dot size (web freshness chip).
    static let dotSize: CGFloat = 6
}

// MARK: - Chip content (web inner `<span>`: glyph + name + metrics [+ chevron])

/// The shared inner chrome of the chip — the `Car` glyph, the truncated active-vehicle name, the
/// `· battery% · range` metrics, and (for the switcher) a trailing selector chevron. `iconOnly` collapses
/// it to the lone glyph (web `iconOnly`). Decorative only — the wrapping chip / menu owns the accessibility.
struct ActiveVehicleSegmentChipContent: View {
    let label: String
    let metricsLabel: String?
    let iconOnly: Bool
    let showsChevron: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.fill")
                .font(.system(size: ActiveVehicleSegmentLayout.iconSize))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            if !iconOnly {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: ActiveVehicleSegmentLayout.labelMaxWidth, alignment: .leading)
                if let metricsLabel {
                    Text(verbatim: "· \(metricsLabel)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
                if showsChevron {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: ActiveVehicleSegmentLayout.chevronSize, weight: .semibold))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
            }
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .frame(minHeight: ActiveVehicleSegmentLayout.minHeight)
    }
}

// MARK: - Static chip (web single-vehicle `<span>` — non-interactive)

/// The single-vehicle chip — the native parity of the web static `<span>` rendered when `vehicles.length
/// === 1`. Non-interactive (there is nothing to switch to); it just names the active vehicle and its
/// metrics. VoiceOver reads "Active vehicle: {label}" with the metrics as the value.
struct ActiveVehicleSegmentStaticChip: View {
    let projection: ActiveVehicleSegmentProjection
    let iconOnly: Bool

    var body: some View {
        ActiveVehicleSegmentChipContent(
            label: projection.label,
            metricsLabel: projection.metricsLabel,
            iconOnly: iconOnly,
            showsChevron: false
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ActiveVehicleSegmentStrings.activeVehicleAria(label: projection.label)))
        .accessibilityValue(Text(verbatim: projection.metricsLabel ?? ""))
        .help(Text(verbatim: projection.tooltip))
    }
}

// MARK: - Switcher (web multi-vehicle `<button>` + listbox popover → native `Menu`)

/// The multi-vehicle switcher — the native parity of the web `<button aria-haspopup="listbox">` + the
/// listbox popover, rendered when `vehicles.length > 1`. A HIG-idiomatic `Menu`: its label is the chip (with
/// the selector chevron), and its items are one `Button` per vehicle, the current one carrying a checkmark
/// (web trailing `Check`). Picking a row routes the chosen id back through `onSelect` (the web `pick` →
/// `setVehicleId`). VoiceOver announces it as a pop-up button named "Switch vehicle ({label})".
struct ActiveVehicleSegmentSwitcher: View {
    let projection: ActiveVehicleSegmentProjection
    let iconOnly: Bool
    let onSelect: (Int) -> Void

    var body: some View {
        Menu {
            ForEach(projection.options) { option in
                ActiveVehicleSegmentMenuItem(option: option) { onSelect(option.id) }
            }
        } label: {
            ActiveVehicleSegmentChipContent(
                label: projection.label,
                metricsLabel: projection.metricsLabel,
                iconOnly: iconOnly,
                showsChevron: !iconOnly
            )
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .accessibilityLabel(Text(verbatim: ActiveVehicleSegmentStrings.switchVehicleAria(label: projection.label)))
        .accessibilityValue(Text(verbatim: projection.metricsLabel ?? ""))
        .help(Text(verbatim: projection.tooltip))
    }
}

/// One switcher row — the native peer of the web listbox `<button role="option">`: the vehicle name, the
/// model badge, and a checkmark when it is the current selection (web `aria-selected` + trailing `Check`).
/// VoiceOver appends "Selected" to the current row.
private struct ActiveVehicleSegmentMenuItem: View {
    let option: ActiveVehicleSegmentOption
    let action: () -> Void

    private var rowText: String {
        guard let model = option.model, !model.isEmpty else { return option.name }
        return "\(option.name)  \(model)"
    }

    var body: some View {
        Button(action: action) {
            if option.isSelected {
                Label(rowText, systemImage: "checkmark")
            } else {
                Text(verbatim: rowText)
            }
        }
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        option.isSelected ? "\(rowText), \(ActiveVehicleSegmentStrings.selectedA11y)" : rowText
    }
}

// MARK: - Loading (initial fetch — skeleton chrome)

/// The initial-fetch state — a skeleton chip shaped like the segment so the footer keeps its shape while the
/// fleet resolves (web avoids the flash by not rendering; native shows a skeleton, never a blank box).
struct ActiveVehicleSegmentLoadingChip: View {
    let iconOnly: Bool

    var body: some View {
        TSSkeleton(
            width: iconOnly ? 16 : 120,
            height: 14,
            cornerRadius: TSRadius.sm
        )
        .frame(minHeight: ActiveVehicleSegmentLayout.minHeight)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ActiveVehicleSegmentStrings.loadingA11y))
    }
}

// MARK: - Empty (fleet resolved empty — web returns null)

/// The empty-fleet state. The web returns `null` here; the native HIG calls for a friendly labelled chip so
/// the footer is never a bare gap. A muted `Car` glyph plus the "No vehicle" label (collapsed to the glyph
/// in `iconOnly`).
struct ActiveVehicleSegmentEmptyChip: View {
    let iconOnly: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.fill")
                .font(.system(size: ActiveVehicleSegmentLayout.iconSize))
                .accessibilityHidden(true)
            if !iconOnly {
                Text(verbatim: ActiveVehicleSegmentStrings.none)
                    .font(Font.TS.caption)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(Color.TS.textMuted)
        .padding(.horizontal, TSSpacing.xs)
        .frame(minHeight: ActiveVehicleSegmentLayout.minHeight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ActiveVehicleSegmentStrings.none))
    }
}

// MARK: - Error (failed fleet read — web has no peer)

/// The fetch-failure state — a compact inline tile with a retry affordance, sized for the footer. The
/// message is the runtime failure reason, exposed to VoiceOver but visually elided to keep the row compact.
struct ActiveVehicleSegmentErrorChip: View {
    let message: String
    let iconOnly: Bool
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: ActiveVehicleSegmentLayout.iconSize))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            if !iconOnly {
                Text(verbatim: ActiveVehicleSegmentStrings.errorTitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
            Button(action: onRetry) {
                Text(verbatim: ActiveVehicleSegmentStrings.retry)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: ActiveVehicleSegmentStrings.retry))
        }
        .padding(.horizontal, TSSpacing.xs)
        .frame(minHeight: ActiveVehicleSegmentLayout.minHeight)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        message.isEmpty
            ? ActiveVehicleSegmentStrings.errorTitle
            : "\(ActiveVehicleSegmentStrings.errorTitle). \(message)"
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the segment when the live state is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the live state.
struct ActiveVehicleSegmentFreshnessChip: View {
    let connection: ActiveVehicleSegmentConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: ActiveVehicleSegmentStrings.live
        case .stale: ActiveVehicleSegmentStrings.stale
        case .offline: ActiveVehicleSegmentStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: ActiveVehicleSegmentStrings.live
        case .stale: ActiveVehicleSegmentStrings.staleA11y
        case .offline: ActiveVehicleSegmentStrings.offlineA11y
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(tone)
                    .frame(width: ActiveVehicleSegmentLayout.dotSize, height: ActiveVehicleSegmentLayout.dotSize)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}
