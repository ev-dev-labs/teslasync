//
//  ScheduledExportsPanelForm.swift
//  TeslaSync — P4 feature view · P7 · ScheduledExportsPanel (Apple) — Form View
//

import SwiftUI

// MARK: - Form View

struct ScheduledExportsFormView: View {
    @Bindable var model: ScheduledExportsPanelModel

    var body: some View {
        VStack(spacing: 16) {
            // Form fields
            VStack(spacing: 12) {
                // Name & Cron (row 1)
                HStack(spacing: 12) {
                    FormField(
                        label: String(localized: "dataExport.scheduled.form.name", defaultValue: "Name"),
                        text: $model.form.name,
                        placeholder: String(
                            localized: "dataExport.scheduled.form.namePlaceholder",
                            defaultValue: "Drives weekly"
                        ) // parity:allow SwiftUI TextField API
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        FormField(
                            label: String(
                                localized: "dataExport.scheduled.form.scheduleCron",
                                defaultValue: "Cron expression"
                            ),
                            text: $model.form.scheduleCron,
                            placeholder: "0 9 * * 0" // parity:allow SwiftUI TextField API
                        )

                        Text(String(
                            localized: "dataExport.scheduled.form.scheduleCronHelp",
                            defaultValue: "Standard 5-field cron, e.g. '0 9 * * 0'."
                        ))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    }
                }

                // Export type & Format (row 2)
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "dataExport.scheduled.form.exportType", defaultValue: "Export type"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)

                        Picker("", selection: $model.form.exportType) {
                            ForEach(ScheduledExport.ExportType.allCases, id: \.self) { type in
                                Text(type.rawValue).tag(type)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "dataExport.scheduled.form.format", defaultValue: "Format"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)

                        Picker("", selection: $model.form.format) {
                            ForEach(ScheduledExport.Format.allCases, id: \.self) { format in
                                Text(format.rawValue).tag(format)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }

                // Range window & Delivery kind (row 3)
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        FormField(
                            label: String(
                                localized: "dataExport.scheduled.form.rangeWindow",
                                defaultValue: "Range window"
                            ),
                            text: Binding(
                                get: { model.form.rangeWindow ?? "" },
                                set: { model.form.rangeWindow = $0.isEmpty ? nil : $0 }
                            ),
                            placeholder: "7d" // parity:allow SwiftUI TextField API
                        )

                        Text(String(
                            localized: "dataExport.scheduled.form.rangeWindowHelp",
                            defaultValue: "Format: number + m/h/d."
                        ))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "dataExport.scheduled.form.deliveryKind", defaultValue: "Delivery kind"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)

                        Picker("", selection: Binding(
                            get: { model.form.delivery.kind },
                            set: { newKind in
                                model.form.delivery = ScheduledExportDelivery(
                                    kind: newKind,
                                    target: newKind == .download ? nil : model.form.delivery.target
                                )
                            }
                        )) {
                            ForEach([
                                ScheduledExportDelivery.DeliveryKind.download,
                                .email,
                                .webhook
                            ], id: \.self) { kind in
                                Text(kind.rawValue).tag(kind)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }

                // Delivery target (conditional)
                if model.form.delivery.kind != .download {
                    VStack(alignment: .leading, spacing: 4) {
                        FormField(
                            label: String(
                                localized: "dataExport.scheduled.form.deliveryTarget",
                                defaultValue: "Delivery target"
                            ),
                            text: Binding(
                                get: { model.form.delivery.target ?? "" },
                                set: { newValue in
                                    model.form.delivery = ScheduledExportDelivery(
                                        kind: model.form.delivery.kind,
                                        target: newValue.isEmpty ? nil : newValue
                                    )
                                }
                            ),
                            placeholder: model.form.delivery.kind == .email // parity:allow SwiftUI TextField API
                                ? "you@example.com"
                                : "https://example.com/hook"
                        )

                        Text(String(
                            localized: "dataExport.scheduled.form.deliveryTargetHelp",
                            defaultValue: "Email address or HTTPS URL."
                        ))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    }
                }
            }

            // Action buttons
            HStack(spacing: 8) {
                Spacer()

                Button {
                    model.closeForm()
                } label: {
                    Text(String(localized: "dataExport.scheduled.form.cancel", defaultValue: "Cancel"))
                }
                .buttonStyle(.bordered)

                Button {
                    Task {
                        _ = await model.submit()
                    }
                } label: {
                    if model.isCreating || model.isUpdating {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text(String(localized: "dataExport.scheduled.form.submit", defaultValue: "Save schedule"))
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isCreating || model.isUpdating || model.form.name.isEmpty)
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.background.secondary)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
                )
        )
    }
}

// MARK: - Form Field Helper

struct FormField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = "" // parity:allow SwiftUI TextField parameter

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            TextField(placeholder, text: $text) // parity:allow SwiftUI TextField API
                .textFieldStyle(.roundedBorder)
        }
    }
}
