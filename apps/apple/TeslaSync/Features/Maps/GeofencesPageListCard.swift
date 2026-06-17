//
//  GeofencesPageListCard.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Geofence list card
//
//  GlassPanel 7 — one geofence list card (web list item): the select checkbox, the
//  pin glyph, the inline-editable name (web `EditableText`), the active + alert
//  badges, the coordinate + radius rows, and the pin / toggle / edit / delete
//  actions. Split from the other list views purely to keep each file within the
//  lint budget. Tokens for all color/typography; every string from the catalog.
//

import SwiftUI

// MARK: - GlassPanel 7 — one geofence list card

/// One geofence card (web GlassPanel 7): a select checkbox, a pin glyph, the
/// inline-editable name, the active + alert badges, the coordinate + radius rows,
/// and the pin / toggle / edit / delete actions.
struct GeofencesListCard: View {
    let zone: GeofenceZone
    let isSelected: Bool
    let isPinned: Bool
    let onToggleSelect: () -> Void
    let onTogglePin: () -> Void
    let onToggleEnabled: (Bool) -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onRename: (String) async -> Bool

    var body: some View {
        GeofencesCard(glow: true) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    info
                    Spacer(minLength: TSSpacing.md)
                    actions
                }
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    info
                    actions
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var info: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            selectCheckbox
            Image(systemName: "mappin")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 40, height: 40)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    GeofencesInlineRename(name: zone.name, onCommit: onRename)
                    GeofencesBadge(
                        text: zone.enabled
                            ? String(localized: "Active", defaultValue: "Active")
                            : String(localized: "Inactive", defaultValue: "Inactive"),
                        tone: zone.enabled ? Color.TS.statusSuccess : Color.TS.textMuted
                    )
                    GeofencesBadge(text: zone.alertKind.badgeLabel, tone: alertTone)
                }
                metaRow
            }
        }
    }

    private var metaRow: some View {
        HStack(spacing: TSSpacing.lg) {
            Label {
                Text(GeofencesFormat.coordinate(latitude: zone.latitude, longitude: zone.longitude))
                    .font(Font.TS.caption.monospacedDigit())
            } icon: {
                Image(systemName: "globe")
            }
            .foregroundStyle(Color.TS.textMuted)
            Label {
                Text(GeofencesFormat.radius(zone.radius))
                    .font(Font.TS.caption)
            } icon: {
                Image(systemName: "ruler")
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .labelStyle(.titleAndIcon)
    }

    private var selectCheckbox: some View {
        Button(action: onToggleSelect) {
            Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                .font(Font.TS.panel)
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(Text(selectLabel))
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            Button(action: onTogglePin) {
                Image(systemName: isPinned ? "pin.fill" : "pin")
                    .font(Font.TS.body)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(isPinned ? Color.TS.accent : Color.TS.textSecondary)
            .accessibilityLabel(Text(String(localized: "geofences.pin", defaultValue: "Pin")))
            .accessibilityAddTraits(isPinned ? [.isSelected, .isButton] : .isButton)

            Toggle("", isOn: Binding(get: { zone.enabled }, set: { onToggleEnabled($0) }))
                .labelsHidden()
                .toggleStyle(.switch)
                .tint(Color.TS.statusSuccess)
                .accessibilityLabel(Text(String(localized: "Active", defaultValue: "Active")))

            GeofencesIconButton(
                systemImage: "pencil",
                label: String(localized: "Edit Geofence", defaultValue: "Edit Geofence"),
                action: onEdit
            )
            GeofencesIconButton(
                systemImage: "trash",
                label: String(localized: "Delete Geofence", defaultValue: "Delete Geofence"),
                role: .destructive,
                action: onDelete
            )
        }
    }

    private var alertTone: Color {
        switch zone.alertKind {
        case .both: Color.TS.statusSuccess
        case .entry: Color.TS.accent
        case .exit: Color.TS.statusWarning
        case .none: Color.TS.textMuted
        }
    }

    private var selectLabel: String {
        String(localized: "geofences.selectGeofence", defaultValue: "Select geofence {{name}}")
            .replacingOccurrences(of: "{{name}}", with: zone.name)
    }
}

// MARK: - Inline rename (web `EditableText`)

/// The inline-editable geofence name (web `EditableText`): tap to edit, commit on
/// submit, with the `geofences.error.nameTooLong` inline guard.
struct GeofencesInlineRename: View {
    let name: String
    let onCommit: (String) async -> Bool

    @State private var isEditing = false
    @State private var draft = ""
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        if isEditing {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TextField(name, text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .font(Font.TS.panel)
                    .frame(maxWidth: 280)
                    .disabled(isSaving)
                    .onSubmit { Task { await commit() } }
                if let error {
                    Text(error)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                }
            }
        } else {
            Button {
                draft = name
                error = nil
                isEditing = true
            } label: {
                Text(name)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(renameLabel))
            .accessibilityHint(Text(String(localized: "common.edit", defaultValue: "Edit")))
        }
    }

    private func commit() async {
        let trimmed = GeofencesText.trim(draft)
        guard trimmed.count <= 120 else {
            error = String(localized: "geofences.error.nameTooLong", defaultValue: "Max 120 characters")
            return
        }
        guard !trimmed.isEmpty, trimmed != name else {
            isEditing = false
            return
        }
        isSaving = true
        let ok = await onCommit(trimmed)
        isSaving = false
        if ok {
            isEditing = false
        } else {
            error = String(localized: "Failed to update geofence", defaultValue: "Failed to update geofence")
        }
    }

    private var renameLabel: String {
        String(localized: "editableText.rename.geofence", defaultValue: "Rename geofence {{name}}")
            .replacingOccurrences(of: "{{name}}", with: name)
    }
}
