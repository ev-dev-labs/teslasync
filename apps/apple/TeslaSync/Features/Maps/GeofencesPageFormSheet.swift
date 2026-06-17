//
//  GeofencesPageFormSheet.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Create/edit sheet
//
//  The create/edit sheet (web create/edit `Modal`): the validation banner, the
//  "Use Current Location" panel (create only, web GlassPanel 8 — hosting the
//  MapKit draw map), the name / coordinate / radius / alert-type / active inputs,
//  Cancel + Create|Update, and the unsaved-changes discard guard. Split from the
//  map surfaces purely to keep each file within the lint budget. Bound to
//  `GeofencesPageModel`; tokens for all color/typography; every string from the
//  catalog.
//

import SwiftUI

// MARK: - Create / edit sheet (web `Modal`)

/// The create/edit sheet (web `Modal`): the validation banner, the
/// "Use Current Location" panel (create only), and the name / coordinate / radius /
/// alert-type / active inputs, with Cancel + Create|Update.
struct GeofencesFormSheet: View {
    @Bindable var model: GeofencesPageModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    if let formError = model.formError {
                        banner(formError)
                    }
                    if model.editingID == nil {
                        GeofencesUseCurrentLocationPanel(model: model)
                    }
                    GeofencesLabeledField(
                        label: String(localized: "Name", defaultValue: "Name"),
                        text: $model.form.name,
                        prompt: String(localized: "Home", defaultValue: "Home"),
                        error: model.fieldErrors[.name]
                    )
                    coordinateFields
                    GeofencesLabeledField(
                        label: String(localized: "Radius (meters)", defaultValue: "Radius (meters)"),
                        text: $model.form.radius,
                        prompt: "100",
                        systemImage: "ruler",
                        keyboard: .decimal,
                        hint: String(
                            localized: "Minimum 10m, maximum 50000m",
                            defaultValue: "Minimum 10m, maximum 50000m"
                        ),
                        error: model.fieldErrors[.radius]
                    )
                    alertTypePicker
                    Toggle(String(localized: "Active", defaultValue: "Active"), isOn: $model.form.enabled)
                        .tint(Color.TS.statusSuccess)
                }
                .padding(TSSpacing.xl)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle(model.modalTitle)
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "Cancel", defaultValue: "Cancel")) {
                            model.requestCloseModal()
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(model.saveLabel) {
                            Task { await model.submit() }
                        }
                        .disabled(!model.canSave)
                    }
                }
        }
        .confirmationDialog(
            String(localized: "forms.discard.title", defaultValue: "Discard changes?"),
            isPresented: $model.isDiscardPromptPresented,
            titleVisibility: .visible
        ) {
            Button(String(localized: "forms.discard.confirm", defaultValue: "Discard"), role: .destructive) {
                model.discardAndClose()
            }
            Button(String(localized: "forms.discard.keepEditing", defaultValue: "Keep Editing"), role: .cancel) {}
        } message: {
            Text(String(
                localized: "forms.discard.body",
                defaultValue: "You have unsaved changes. Discard them?"
            ))
        }
    }

    private var coordinateFields: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                latitudeField
                longitudeField
            }
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                latitudeField
                longitudeField
            }
        }
    }

    private var latitudeField: some View {
        GeofencesLabeledField(
            label: String(localized: "Latitude", defaultValue: "Latitude"),
            text: $model.form.latitude,
            prompt: "37.7749",
            systemImage: "globe",
            keyboard: .decimal,
            error: model.fieldErrors[.latitude]
        )
    }

    private var longitudeField: some View {
        GeofencesLabeledField(
            label: String(localized: "Longitude", defaultValue: "Longitude"),
            text: $model.form.longitude,
            prompt: "-122.4194",
            systemImage: "globe",
            keyboard: .decimal,
            error: model.fieldErrors[.longitude]
        )
    }

    private var alertTypePicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(String(localized: "Alert Type", defaultValue: "Alert Type"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Picker(selection: $model.form.alertType) {
                ForEach(GeofencesAlertKind.allCases) { kind in
                    Text(kind.optionLabel).tag(kind)
                }
            } label: {
                Text(String(localized: "Alert Type", defaultValue: "Alert Type"))
            }
            .pickerStyle(.menu)
            .labelsHidden()
        }
    }

    private func banner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(Color.TS.statusDanger.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .accessibilityElement(children: .combine)
    }
}
