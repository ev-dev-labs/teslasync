//
//  VehiclePicker.Views.swift
//  TeslaSync — P4 shared surface · 0183 · VehiclePicker (Apple)
//
//  The presentational pieces of the vehicle selector — the native peers of the web elements: the bordered
//  selector chip (web `<Select>` with the leading `Car` glyph, the truncated active-vehicle name, the pin
//  glyph for pinned selections, and the selector chevron), the picker itself (web `<Select>` listbox → a
//  HIG-idiomatic `Menu` of every vehicle in pin-aware order, each pinned row pin-marked, the current one
//  checkmarked), and the P4 leaf chrome the native state matrix adds so the surface is never a blank box: a
//  loading skeleton, a friendly static single-vehicle chip + an empty "No vehicles" chip (the web returns
//  `null` for a 0/1-vehicle fleet), a compact error tile with retry, and the freshness chip. All chrome is
//  token-driven (P1/S9); every string resolves through the P1/S10 facade; every interactive element carries a
//  VoiceOver label. No networking — every affordance routes back through the state-holder.
//

import SwiftUI

// MARK: - Layout constants (web sidebar `Car` `h-4 w-4` + `text-xs` `<Select>` sizing)

enum VehiclePickerLayout {
    /// The leading `Car` glyph size (web `h-4 w-4`).
    static let iconSize: CGFloat = 16
    /// The pin glyph size (the native peer of the web `📌` label prefix).
    static let pinSize: CGFloat = 10
    /// The selector chevron size (web `<Select>` indicator).
    static let chevronSize: CGFloat = 10
    /// The minimum touch target height for the selector chip.
    static let minHeight: CGFloat = 32
    /// Max width of the truncating name before it elides.
    static let labelMaxWidth: CGFloat = 200
    /// The freshness dot size.
    static let dotSize: CGFloat = 6
}

// MARK: - Chip content (web inner `<Select>`: glyph + [pin] + name [+ chevron])

/// The shared inner chrome of the selector chip — the `Car` glyph, an optional pin glyph (the native peer of
/// the web `📌` prefix), the truncated active-vehicle name, and (for the picker) a trailing selector chevron.
/// `bordered` wraps it in the web `<Select>` box outline. Decorative only — the wrapping picker / chip owns
/// the accessibility.
struct VehiclePickerChipContent: View {
    let label: String
    let isPinned: Bool
    let showsChevron: Bool
    var bordered: Bool = true

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.fill")
                .font(.system(size: VehiclePickerLayout.iconSize))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            if isPinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: VehiclePickerLayout.pinSize))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
            }
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: VehiclePickerLayout.labelMaxWidth, alignment: .leading)
            if showsChevron {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: VehiclePickerLayout.chevronSize, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minHeight: VehiclePickerLayout.minHeight)
        .background(chipBackground)
    }

    @ViewBuilder
    private var chipBackground: some View {
        if bordered {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.surfaceGlass)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        }
    }
}

// MARK: - Static chip (web single-vehicle — web hides; native shows a non-interactive chip)

/// The single-vehicle chip — the native parity of the web `vehicles.length <= 1 → null`. Non-interactive
/// (there is nothing to switch to); it just names the active vehicle. The native HIG calls for a labelled
/// surface rather than a blank box. VoiceOver reads the vehicle name, with "Pinned" as the value when pinned.
struct VehiclePickerStaticChip: View {
    let projection: VehiclePickerProjection

    var body: some View {
        VehiclePickerChipContent(
            label: projection.selectedLabel,
            isPinned: projection.selectedIsPinned,
            showsChevron: false,
            bordered: false
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: projection.selectedLabel))
        .accessibilityValue(Text(verbatim: projection.selectedIsPinned ? VehiclePickerStrings.pinnedA11y : ""))
    }
}

// MARK: - Picker (web `<Select>` listbox → native `Menu`)

/// The multi-vehicle picker — the native parity of the web `<Select>` listbox, rendered when
/// `vehicles.length > 1`. A HIG-idiomatic `Menu`: its label is the bordered selector chip (with the selector
/// chevron), and its items are one `Button` per vehicle in pin-aware order, pinned rows pin-marked and the
/// current one carrying a checkmark. Picking a row routes the chosen id back through `onSelect` (the web
/// `onChange` → `setVehicleId`). VoiceOver announces it as a pop-up button named "Select vehicle".
struct VehiclePickerMenu: View {
    let projection: VehiclePickerProjection
    let onSelect: (Int) -> Void

    var body: some View {
        Menu {
            ForEach(projection.options) { option in
                VehiclePickerMenuItem(option: option) { onSelect(option.id) }
            }
        } label: {
            VehiclePickerChipContent(
                label: projection.selectedLabel,
                isPinned: projection.selectedIsPinned,
                showsChevron: true
            )
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .accessibilityLabel(Text(verbatim: VehiclePickerStrings.aria))
        .accessibilityValue(Text(verbatim: projection.selectedLabel))
    }
}

/// One picker row — the native peer of the web listbox `<option>`: the vehicle name, a pin glyph when pinned
/// (web `📌` prefix), and a checkmark when it is the current selection. VoiceOver appends "Pinned" / "Selected".
private struct VehiclePickerMenuItem: View {
    let option: VehiclePickerOption
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if option.isSelected {
                Label(option.label, systemImage: "checkmark")
            } else if option.isPinned {
                Label(option.label, systemImage: "pin.fill")
            } else {
                Text(verbatim: option.label)
            }
        }
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        var parts = [option.label]
        if option.isPinned { parts.append(VehiclePickerStrings.pinnedA11y) }
        if option.isSelected { parts.append(VehiclePickerStrings.selectedA11y) }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Loading (initial fetch — skeleton chrome)

/// The initial-fetch state — a skeleton selector shaped like the picker so the sidebar keeps its shape while
/// the fleet resolves (web hides while loading; native shows a skeleton, never a blank box).
struct VehiclePickerLoadingChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.fill")
                .font(.system(size: VehiclePickerLayout.iconSize))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSSkeleton(width: 160, height: 16, cornerRadius: TSRadius.sm)
        }
        .frame(minHeight: VehiclePickerLayout.minHeight)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VehiclePickerStrings.loadingA11y))
    }
}

// MARK: - Empty (fleet resolved empty — web returns null)

/// The empty-fleet state. The web returns `null` here; the native HIG calls for a friendly labelled chip so
/// the sidebar is never a bare gap. A muted `Car` glyph plus the "No vehicles" label.
struct VehiclePickerEmptyChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.fill")
                .font(.system(size: VehiclePickerLayout.iconSize))
                .accessibilityHidden(true)
            Text(verbatim: VehiclePickerStrings.emptyTitle)
                .font(Font.TS.caption)
                .lineLimit(1)
        }
        .foregroundStyle(Color.TS.textMuted)
        .frame(minHeight: VehiclePickerLayout.minHeight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: VehiclePickerStrings.emptyTitle))
    }
}

// MARK: - Error (failed fleet read — web has no peer)

/// The fetch-failure state — a compact inline tile with a retry affordance. The message is the runtime
/// failure reason, exposed to VoiceOver but visually elided to keep the row compact.
struct VehiclePickerErrorChip: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: VehiclePickerLayout.iconSize))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: VehiclePickerStrings.errorTitle)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Button(action: onRetry) {
                Text(verbatim: VehiclePickerStrings.retry)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: VehiclePickerStrings.retry))
        }
        .frame(minHeight: VehiclePickerLayout.minHeight)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        message.isEmpty
            ? VehiclePickerStrings.errorTitle
            : "\(VehiclePickerStrings.errorTitle). \(message)"
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the picker when the live state is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the live fleet.
struct VehiclePickerFreshnessChip: View {
    let connection: VehiclePickerConnection
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
        case .live: VehiclePickerStrings.live
        case .stale: VehiclePickerStrings.stale
        case .offline: VehiclePickerStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: VehiclePickerStrings.live
        case .stale: VehiclePickerStrings.staleA11y
        case .offline: VehiclePickerStrings.offlineA11y
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(tone)
                    .frame(width: VehiclePickerLayout.dotSize, height: VehiclePickerLayout.dotSize)
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
