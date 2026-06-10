//
//  GeofenceDrawer.Views.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The populated content for `GeofenceDrawer`: the modal header (map glyph + "Geofences" title +
//  freshness chip + Done), the draw toolbar (the leaflet-draw control peer — a mode picker, the
//  circle radius slider, the live hint, and the Undo / Cancel / Add-or-Save actions), and the saved
//  fences list (each `describeFence` row with focus / edit / delete). All copy resolves through the
//  P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: the map glyph, the "Geofences" title + freshness chip, and the trailing Done
/// button that dismisses the surface.
struct GeofenceDrawerHeader: View {
    let connection: GeofenceDrawerConnection
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                GeofenceDrawerStrings.text("geofence.title", "Geofences")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                GeofenceFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "mappin.and.ellipse")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            GeofenceDrawerStrings.text("geofence.done", "Done")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(GeofenceDrawerStrings.text("geofence.done", "Done"))
    }
}

// MARK: - Draw toolbar (web leaflet-draw control)

/// The draw toolbar: the allowed-mode picker, the circle radius slider, the live step hint, and the
/// Undo / Cancel / Add (or Save, when editing) actions.
struct GeofenceDrawToolbar: View {
    @Bindable var model: GeofenceDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            GeofenceFieldLabel(text: GeofenceDrawerStrings.string("geofence.shapeLabel", "Shape"))
            modePicker
            if model.draft.mode == .circle {
                radiusRow
            }
            Text(verbatim: model.draftHint)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text(verbatim: model.draftHint))
            actions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var modePicker: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(model.modes) { mode in
                GeofenceModeChip(
                    mode: mode,
                    selected: mode == model.draft.mode,
                    accessibilityLabel: model.modeAccessibilityLabel(for: mode)
                ) {
                    model.selectMode(mode)
                }
            }
        }
    }

    private var radiusRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "smallcircle.filled.circle")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Slider(value: radiusBinding, in: 25 ... 2000, step: 5)
                .accessibilityLabel(GeofenceDrawerStrings.text("geofence.radiusLabel", "Radius"))
                .accessibilityValue(Text(verbatim: radiusValueText))
            Text(verbatim: radiusValueText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .ghost, size: .small, action: { model.undoPoint() }, label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.uturn.backward")
                    GeofenceDrawerStrings.text("geofence.undo", "Undo")
                }
            })
            .disabled(model.draft.pointCount == 0)
            .accessibilityLabel(GeofenceDrawerStrings.text("geofence.undo", "Undo"))
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: { model.clearDraft() }, label: {
                GeofenceDrawerStrings.text("geofence.cancel", "Cancel")
            })
            .disabled(model.draft.pointCount == 0 && !model.isEditing)
            .accessibilityLabel(GeofenceDrawerStrings.text("geofence.cancel", "Cancel"))
            TSButton(variant: .primary, size: .small, action: { model.commitDraft() }, label: {
                Text(verbatim: addButtonTitle)
            })
            .disabled(!model.canCommitDraft)
            .accessibilityLabel(Text(verbatim: addButtonTitle))
        }
    }

    private var addButtonTitle: String {
        model.isEditing
            ? GeofenceDrawerStrings.string("geofence.save", "Save")
            : GeofenceDrawerStrings.string("geofence.add", "Add")
    }

    private var radiusValueText: String {
        GeofenceDrawerStrings.string(
            "geofence.radiusValue", "{{meters}} m",
            "{{meters}}", GeofenceFormat.fixed(model.draft.radiusMeters, places: 0)
        )
    }

    private var radiusBinding: Binding<Double> {
        Binding(get: { model.draft.radiusMeters }, set: { model.setRadius($0) })
    }
}

/// One draw-mode chip (glyph + label), tinted when selected (web toolbar tool button).
struct GeofenceModeChip: View {
    let mode: GeofenceDrawerMode
    let selected: Bool
    let accessibilityLabel: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 4) {
                Image(systemName: mode.systemImage).font(.system(size: 11, weight: .semibold))
                GeofenceDrawerStrings.text(mode.labelKey, mode.labelFallback).font(Font.TS.label)
            }
            .foregroundStyle(selected ? Color.TS.accent : Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(selected ? Color.TS.surfaceGlass : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.TS.accent.opacity(0.55) : Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Saved fences list (web persisted shapes)

/// The saved-fences list: the section heading, then a `describeFence` row per fence with focus /
/// edit / delete affordances (web on-map edit + trash).
struct GeofenceFenceList: View {
    @Bindable var model: GeofenceDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            GeofenceFieldLabel(text: GeofenceDrawerStrings.string("geofence.savedLabel", "Saved geofences"))
            ForEach(model.rows) { row in
                GeofenceFenceRow(
                    row: row,
                    isEditing: model.editingFenceID == row.id,
                    onFocus: { model.focusFence(id: row.id) },
                    onEdit: { model.beginEdit(id: row.id) },
                    onDelete: { model.deleteFence(id: row.id) }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One saved-fence row.
struct GeofenceFenceRow: View {
    let row: GeofenceRow
    let isEditing: Bool
    let onFocus: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button(action: onFocus) {
                Text(verbatim: row.text)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: row.text))
            .accessibilityHint(GeofenceDrawerStrings.text("geofence.focusHint", "Centers the map on this geofence"))
            iconButton(system: "pencil", key: "geofence.edit", fallback: "Edit geofence", action: onEdit)
                .foregroundStyle(isEditing ? Color.TS.accent : Color.TS.textMuted)
            iconButton(system: "trash", key: "geofence.delete", fallback: "Delete geofence", action: onDelete)
                .foregroundStyle(Color.TS.statusDanger)
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private func iconButton(
        system: String,
        key: String,
        fallback: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(GeofenceDrawerStrings.text(key, fallback))
    }
}

// MARK: - Field label + Text helper

/// A form field's visible label, styled as a token label.
struct GeofenceFieldLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension GeofenceDrawerStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
