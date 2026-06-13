//
//  VehicleMultiSelect.Views.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  The presentational pieces of the multi-vehicle picker — the native peers of the web elements: the trigger
//  button (web custom `<button aria-haspopup="listbox">` with the summary `Badge` + the rotating chevron), the
//  check rows (web `<button role="checkbox" aria-checked>` for the All sentinel, each vehicle, and each
//  unknown id), the empty-fleet help line, the inline validation error text, and the P4 leaf chrome the native
//  state matrix adds so the surface is never a blank box: a loading skeleton trigger, a compact fetch-error
//  tile with retry, and the freshness chip. All chrome is token-driven (P1/S9); every string resolves through
//  the P1/S10 facade; every interactive element carries a VoiceOver label + a toggle value. No networking —
//  every affordance routes back through the state-holder.
//

import SwiftUI

// MARK: - Check box glyph (web rounded border box + checkmark SVG)

/// The leading check indicator — an accent-filled box with a checkmark when on, a bordered empty box when off
/// (web's `<span>` with the inline check `<svg>`). Decorative; the row owns the accessibility value.
struct VehicleMultiSelectCheckBox: View {
    let checked: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(checked ? Color.TS.accent : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(checked ? Color.TS.accent : Color.TS.border, lineWidth: 1)
            )
            .overlay {
                if checked {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 16, height: 16)
            .accessibilityHidden(true)
    }
}

// MARK: - Check row (web `<button role="checkbox" aria-checked>`)

/// One selectable row — the All sentinel, a fleet vehicle, or an unknown id. Renders the check box + the
/// label (optionally emphasized / muted) + an optional trailing badge (the unknown "Unknown" pill). Exposes
/// the `checkbox`-equivalent semantics: a labelled toggle whose value announces Selected / Not selected.
struct VehicleMultiSelectCheckRow: View {
    let title: String
    let checked: Bool
    var emphasized: Bool = false
    var muted: Bool = false
    var badge: String?
    let selectedValue: String
    let notSelectedValue: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.sm) {
                VehicleMultiSelectCheckBox(checked: checked)
                Text(verbatim: title)
                    .font(emphasized ? Font.TS.label : Font.TS.body)
                    .foregroundStyle(muted ? Color.TS.textMuted : Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: TSSpacing.sm)
                if let badge {
                    TSBadge(LocalizedStringKey(badge), tone: .warning)
                }
            }
            .contentShape(Rectangle())
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(
                checked ? Color.TS.surfaceGlass : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: badge.map { "\(title), \($0)" } ?? title))
        .accessibilityValue(Text(verbatim: checked ? selectedValue : notSelectedValue))
        .accessibilityAddTraits(.isToggle)
    }
}

// MARK: - Trigger (web custom popover `<button>`)

/// The trigger button — the SwiftUI parity of the web custom `<button aria-haspopup="listbox">`: a summary
/// `Badge` + a chevron that rotates when the popover is open, a danger-tinted border on a validation error,
/// and the disabled treatment for a disabled / empty fleet. Owns the `.popover` that hosts the option list.
struct VehicleMultiSelectTrigger: View {
    @Bindable var model: VehicleMultiSelectModel

    private var openBinding: Binding<Bool> {
        Binding(get: { model.isOpen }, set: { model.setOpen($0) })
    }

    var body: some View {
        Button(action: model.toggleOpen) {
            HStack(spacing: TSSpacing.sm) {
                TSBadge(LocalizedStringKey(model.summaryText), tone: .neutral)
                Spacer(minLength: TSSpacing.sm)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(model.isOpen ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, TSSpacing.md)
            .frame(minHeight: 38)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(model.hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
            .opacity(model.isTriggerEnabled ? 1 : 0.6)
        }
        .buttonStyle(.plain)
        .disabled(!model.isTriggerEnabled)
        .accessibilityLabel(Text(verbatim: model.summaryText))
        .accessibilityValue(Text(verbatim: model.errorText ?? ""))
        .accessibilityHint(Text(verbatim: VehicleMultiSelectStrings.triggerA11yHint(model.localize)))
        .popover(isPresented: openBinding, arrowEdge: .bottom) {
            VehicleMultiSelectPopover(model: model)
                .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Popover (web `role="listbox"` option list)

/// The option list — the parity of the web `<div role="listbox" aria-multiselectable>`: the All sentinel, a
/// divider, the per-vehicle rows, and (when present) a divider + the unknown-id rows. Scrolls past the
/// freshness-window height; labelled as one multi-select group for VoiceOver.
struct VehicleMultiSelectPopover: View {
    @Bindable var model: VehicleMultiSelectModel

    private var projection: VehicleMultiSelectProjection {
        model.projection
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                VehicleMultiSelectCheckRow(
                    title: VehicleMultiSelectStrings.allOption(model.localize),
                    checked: projection.allSelected,
                    emphasized: true,
                    selectedValue: VehicleMultiSelectStrings.optionSelected(model.localize),
                    notSelectedValue: VehicleMultiSelectStrings.optionNotSelected(model.localize),
                    action: { model.toggleAll() }
                )

                Divider().background(Color.TS.border)

                ForEach(projection.rows) { row in
                    VehicleMultiSelectCheckRow(
                        title: row.label,
                        checked: row.checked,
                        selectedValue: VehicleMultiSelectStrings.optionSelected(model.localize),
                        notSelectedValue: VehicleMultiSelectStrings.optionNotSelected(model.localize),
                        action: { model.toggleVehicle(id: row.id) }
                    )
                }

                if projection.hasUnknown {
                    Divider().background(Color.TS.border)
                    ForEach(projection.unknownRows) { row in
                        VehicleMultiSelectCheckRow(
                            title: row.label,
                            checked: true,
                            muted: true,
                            badge: VehicleMultiSelectStrings.unknownBadge(model.localize),
                            selectedValue: VehicleMultiSelectStrings.optionSelected(model.localize),
                            notSelectedValue: VehicleMultiSelectStrings.optionNotSelected(model.localize),
                            action: { model.toggleVehicle(id: row.id) }
                        )
                    }
                }
            }
            .padding(TSSpacing.xs)
        }
        .frame(minWidth: 260, maxHeight: 288)
        .background(Color.TS.surface)
        .accessibilityLabel(Text(verbatim: VehicleMultiSelectStrings.popoverA11y(model.localize)))
    }
}

// MARK: - Empty-fleet help (web `vehiclesEmptyFleetHelp`)

/// The help line under the disabled trigger when the fleet is empty (web `isFleetEmpty && <p>…</p>`).
struct VehicleMultiSelectEmptyHelp: View {
    let message: String

    var body: some View {
        Text(verbatim: message)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Inline validation error (web `hasError && <p role="alert">`)

/// The inline validation error text under the trigger (web `errorKey` → danger-coloured copy with `role`
/// `alert`). The trigger border is tinted by the trigger itself; this is the announced text.
struct VehicleMultiSelectErrorText: View {
    let message: String

    var body: some View {
        Text(verbatim: message)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Loading (initial fetch — skeleton chrome)

/// The initial-fetch state — a skeleton pill shaped like the trigger so the surface keeps its shape while the
/// fleet resolves (web has no peer; never a blank box).
struct VehicleMultiSelectLoadingView: View {
    let label: String

    var body: some View {
        TSSkeleton(width: nil, height: 38, cornerRadius: TSRadius.md)
            .frame(maxWidth: .infinity)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Error tile (failed fleet read — web has no QueryError peer)

/// The fetch-failure state — a compact inline tile with a retry affordance. The message is the runtime failure
/// reason, exposed to VoiceOver but visually elided to keep the row compact.
struct VehicleMultiSelectErrorTile: View {
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
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: retryLabel)
            }
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .padding(.horizontal, TSSpacing.md)
        .frame(minHeight: 38)
        .frame(maxWidth: .infinity)
        .background(Color.TS.statusDanger.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: message.isEmpty ? title : "\(title). \(message)"))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the trigger when the fleet is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the fleet.
struct VehicleMultiSelectFreshnessChip: View {
    let connection: VehicleMultiSelectConnection
    let localize: VehicleMultiSelectResolve
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
        case .live: VehicleMultiSelectStrings.live(localize)
        case .stale: VehicleMultiSelectStrings.stale(localize)
        case .offline: VehicleMultiSelectStrings.offline(localize)
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: VehicleMultiSelectStrings.live(localize)
        case .stale: VehicleMultiSelectStrings.staleA11y(localize)
        case .offline: VehicleMultiSelectStrings.offlineA11y(localize)
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
