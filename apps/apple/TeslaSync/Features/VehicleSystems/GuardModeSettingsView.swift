//
//  GuardModeSettingsView.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple) — Row 2 (Settings)
//
//  The guard configuration form (web GlassPanel 4): home geofence, movement
//  sensitivity, auto-panic, and a save action. Adaptive — a three-up row on
//  regular width, a single column on compact (`ViewThatFits`).
//

import SwiftUI

/// The guard settings form (web GlassPanel 4).
struct GuardModeSettingsPanel: View {
    let geofences: [GuardModeGeofence]
    @Binding var selectedGeofenceID: Int64
    @Binding var selectedSensitivity: GuardModeSensitivity
    @Binding var autoPanicEnabled: Bool
    let isSaving: Bool
    let onSave: () -> Void

    var body: some View {
        GuardModeCard {
            VStack(alignment: .leading, spacing: 16) {
                GuardModeSectionTitle(
                    text: String(localized: "translation.guard.settings", defaultValue: "Guard Settings")
                )
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 16) {
                        geofenceField
                        sensitivityField
                        autoPanicField
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        geofenceField
                        sensitivityField
                        autoPanicField
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Home geofence

    private var geofenceField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(String(localized: "translation.guard.homeGeofence", defaultValue: "Home Geofence"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Picker(selection: $selectedGeofenceID) {
                Text(String(localized: "translation.guard.noGeofence", defaultValue: "— No home geofence —"))
                    .tag(Int64(0))
                ForEach(geofences) { geofence in
                    Text(geofence.name).tag(geofence.id)
                }
            } label: {
                EmptyView()
            }
            .labelsHidden()
            .pickerStyle(.menu)
            Text(String(
                localized: "translation.guard.homeGeofenceHelp",
                defaultValue: "Vehicle will trigger alert if it leaves this area"
            ))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Sensitivity

    private var sensitivityField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(String(localized: "translation.guard.sensitivity", defaultValue: "Sensitivity"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Picker(selection: $selectedSensitivity) {
                ForEach(GuardModeSensitivity.allCases) { option in
                    Text(option.label).tag(option)
                }
            } label: {
                EmptyView()
            }
            .labelsHidden()
            .pickerStyle(.menu)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Auto-panic + save

    private var autoPanicField: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $autoPanicEnabled) {
                Text(String(localized: "translation.guard.autoPanic", defaultValue: "Auto-Panic on Trigger"))
                    .font(.subheadline)
            }
            Text(String(
                localized: "translation.guard.autoPanicHelp",
                defaultValue: "Automatically execute panic actions when guard is triggered"
            ))
            .font(.caption)
            .foregroundStyle(.secondary)
            Button(action: onSave) {
                Text(String(localized: "translation.guard.saveSettings", defaultValue: "Save Settings"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isSaving)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
