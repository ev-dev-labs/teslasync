//
//  VehicleSelect.Views.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  The presentational pieces of the vehicle scope picker — the native peers of the web elements: the select
//  control (web `<Select>` with the optional leading `Car` glyph from `withIcon`), and the P4 leaf chrome
//  the native state matrix adds so the surface is never a blank box: a loading skeleton trigger, a compact
//  empty indicator (the web renders nothing for an empty fleet; the native HIG calls for a labelled state),
//  a compact error tile with retry, and the freshness chip. All chrome is token-driven (P1/S9); every string
//  resolves through the P1/S10 facade; every interactive element carries a VoiceOver label. No networking —
//  every affordance routes back through the state-holder.
//

import SwiftUI

// MARK: - Control (web `<Select>` + optional `withIcon` glyph)

/// The populated select — the SwiftUI parity of the web `<Select options value onChange aria-label />`,
/// backed by the shared ``TSSelect`` (the native `@/components/ui` Select counterpart). Optionally prefixed
/// by a muted `Car` glyph (web `withIcon`). The control carries the `vehicleSelect.aria` accessible name and
/// exposes the selected vehicle's name as its accessibility value.
struct VehicleSelectControl: View {
    let projection: VehicleSelectProjection
    let ariaLabel: String
    let selectedName: String?
    let withIcon: Bool
    let onSelect: (String) -> Void

    private var selectionBinding: Binding<String> {
        Binding(get: { projection.selectedValue }, set: { onSelect($0) })
    }

    private var options: [TSSelectOption<String>] {
        projection.options.map { TSSelectOption($0.value, LocalizedStringKey($0.label)) }
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if withIcon {
                Image(systemName: "car.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            TSSelect(selection: selectionBinding, options: options)
                .accessibilityLabel(Text(verbatim: ariaLabel))
                .accessibilityValue(Text(verbatim: selectedName ?? ""))
        }
    }
}

// MARK: - Loading (initial fetch — skeleton chrome)

/// The initial-fetch state — a skeleton pill shaped like the select trigger so the surface keeps its shape
/// while the fleet resolves (web has no peer; never a blank box).
struct VehicleSelectLoadingView: View {
    let label: String

    var body: some View {
        TSSkeleton(width: 160, height: 36, cornerRadius: TSRadius.md)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Empty (fleet resolved empty — web returns null)

/// The empty-fleet state. The web returns `null` here (the page shows its own empty state); the native HIG
/// calls for a compact labelled indicator so the action row is never a bare gap.
struct VehicleSelectEmptyView: View {
    let title: String
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.fill")
                .font(.system(size: 13))
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.caption)
                .lineLimit(1)
        }
        .foregroundStyle(Color.TS.textMuted)
        .padding(.horizontal, TSSpacing.md)
        .frame(minHeight: 36)
        .background(Color.TS.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(RoundedRectangle(cornerRadius: TSRadius.md).strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityHint(Text(verbatim: message))
    }
}

// MARK: - Error (failed fleet read — web has no QueryError peer)

/// The fetch-failure state — a compact inline tile with a retry affordance, sized for the action row. The
/// message is the runtime failure reason, exposed to VoiceOver but visually elided to keep the row compact.
struct VehicleSelectErrorView: View {
    let title: String
    let message: String
    let retryLabel: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: retryLabel)
            }
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .padding(.horizontal, TSSpacing.md)
        .frame(minHeight: 36)
        .background(Color.TS.statusDanger.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        message.isEmpty ? title : "\(title). \(message)"
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the control when the fleet is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the fleet.
struct VehicleSelectFreshnessChip: View {
    let connection: VehicleSelectConnection
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
        case .live: VehicleSelectStrings.live
        case .stale: VehicleSelectStrings.stale
        case .offline: VehicleSelectStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: VehicleSelectStrings.live
        case .stale: VehicleSelectStrings.staleA11y
        case .offline: VehicleSelectStrings.offlineA11y
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
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
