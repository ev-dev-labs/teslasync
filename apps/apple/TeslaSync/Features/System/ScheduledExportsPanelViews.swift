//
//  ScheduledExportsPanelViews.swift
//  TeslaSync — P4 feature view · P7 · ScheduledExportsPanel (Apple) — Table Views
//

import SwiftUI

// MARK: - Exports Table View

struct ExportsTableView: View {
    @Bindable var model: ScheduledExportsPanelModel

    var body: some View {
        VStack(spacing: 0) {
            // Table
            #if os(macOS)
                MacOSTableView(model: model)
            #else
                IOSListView(model: model)
            #endif
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
        )
    }
}

// MARK: - macOS Table

#if os(macOS)
    private struct MacOSTableView: View {
        @Bindable var model: ScheduledExportsPanelModel

        var body: some View {
            Table(model.exports) {
                TableColumn(String(localized: "dataExport.scheduled.table.name", defaultValue: "Name")) { export in
                    Text(export.name)
                        .fontWeight(.medium)
                        .opacity(export.enabled ? 1.0 : 0.5)
                }

                TableColumn(String(localized: "dataExport.scheduled.table.type", defaultValue: "Type")) { export in
                    Text("\(export.exportType.rawValue) (\(export.format.rawValue))")
                        .opacity(export.enabled ? 1.0 : 0.5)
                }

                TableColumn(String(localized: "dataExport.scheduled.table.cron", defaultValue: "Cron")) { export in
                    Text(export.scheduleCron)
                        .font(.system(.body, design: .monospaced))
                        .opacity(export.enabled ? 1.0 : 0.5)
                }

                TableColumn(String(
                    localized: "dataExport.scheduled.table.delivery",
                    defaultValue: "Delivery"
                )) { export in
                    HStack(spacing: 4) {
                        Text(export.delivery.kind.rawValue)
                        if let target = export.delivery.target {
                            Text("→ \(target)")
                        }
                    }
                    .opacity(export.enabled ? 1.0 : 0.5)
                }

                TableColumn(String(
                    localized: "dataExport.scheduled.table.nextRun",
                    defaultValue: "Next run"
                )) { export in
                    if let nextRun = export.nextRunAt {
                        Text(formattedTimestamp(nextRun))
                    } else {
                        Text("—")
                            .foregroundStyle(.tertiary)
                    }
                }

                TableColumn(String(
                    localized: "dataExport.scheduled.table.lastRun",
                    defaultValue: "Last run"
                )) { export in
                    if let lastRun = export.lastRunAt {
                        Text(formattedTimestamp(lastRun))
                    } else {
                        Text(String(localized: "dataExport.scheduled.status.never", defaultValue: "Never"))
                            .foregroundStyle(.tertiary)
                    }
                }

                TableColumn(String(localized: "dataExport.scheduled.table.status", defaultValue: "Status")) { export in
                    StatusBadge(status: export.lastStatus)
                }

                TableColumn(String(
                    localized: "dataExport.scheduled.table.actions",
                    defaultValue: "Actions"
                )) { export in
                    HStack(spacing: 4) {
                        ActionButtons(model: model, export: export)
                    }
                }
            }
            .padding()
        }
    }
#endif

// MARK: - iOS List

#if os(iOS)
    private struct IOSListView: View {
        @Bindable var model: ScheduledExportsPanelModel

        var body: some View {
            List {
                ForEach(model.exports) { export in
                    VStack(alignment: .leading, spacing: 8) {
                        // Name & status
                        HStack {
                            Text(export.name)
                                .fontWeight(.semibold)
                                .opacity(export.enabled ? 1.0 : 0.5)

                            Spacer()

                            StatusBadge(status: export.lastStatus)
                        }

                        // Type & format
                        Text("\(export.exportType.rawValue) (\(export.format.rawValue))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .opacity(export.enabled ? 1.0 : 0.5)

                        // Cron
                        Text(export.scheduleCron)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .opacity(export.enabled ? 1.0 : 0.5)

                        // Delivery
                        HStack(spacing: 4) {
                            Text(export.delivery.kind.rawValue)
                            if let target = export.delivery.target {
                                Text("→ \(target)")
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .opacity(export.enabled ? 1.0 : 0.5)

                        Divider()

                        // Timestamps
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(String(localized: "dataExport.scheduled.table.nextRun", defaultValue: "Next run"))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)

                                Spacer()

                                if let nextRun = export.nextRunAt {
                                    Text(formattedTimestamp(nextRun))
                                        .font(.caption2)
                                } else {
                                    Text("—")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }

                            HStack {
                                Text(String(localized: "dataExport.scheduled.table.lastRun", defaultValue: "Last run"))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)

                                Spacer()

                                if let lastRun = export.lastRunAt {
                                    Text(formattedTimestamp(lastRun))
                                        .font(.caption2)
                                } else {
                                    Text(String(localized: "dataExport.scheduled.status.never", defaultValue: "Never"))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }

                        Divider()

                        // Actions
                        ActionButtons(model: model, export: export)
                    }
                    .padding(.vertical, 4)
                }
            }
            .listStyle(.plain)
        }
    }
#endif

// MARK: - Action Buttons

private struct ActionButtons: View {
    @Bindable var model: ScheduledExportsPanelModel
    let export: ScheduledExport

    var body: some View {
        HStack(spacing: 4) {
            Button {
                Task {
                    _ = await model.runNow(export.id)
                }
            } label: {
                if model.runningNowId == export.id {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Text(String(localized: "dataExport.scheduled.actions.runNow", defaultValue: "Run now"))
                }
            }
            .buttonStyle(.bordered)
            .disabled(model.runningNowId == export.id)

            Button {
                Task {
                    _ = await model.toggleEnabled(export)
                }
            } label: {
                Text(export.enabled
                    ? String(localized: "dataExport.scheduled.actions.disable", defaultValue: "Disable")
                    : String(localized: "dataExport.scheduled.actions.enable", defaultValue: "Enable")
                )
            }
            .buttonStyle(.bordered)

            Button {
                model.startEdit(export)
            } label: {
                Text(String(localized: "dataExport.scheduled.actions.edit", defaultValue: "Edit"))
            }
            .buttonStyle(.bordered)

            Button(role: .destructive) {
                model.pendingDeleteExport = export
            } label: {
                Text(String(localized: "dataExport.scheduled.actions.delete", defaultValue: "Delete"))
            }
            .buttonStyle(.bordered)
        }
    }
}

// MARK: - Status Badge

private struct StatusBadge: View {
    let status: ScheduledExport.Status?

    var body: some View {
        if let status {
            switch status {
            case .ok:
                Text(String(localized: "dataExport.scheduled.status.ok", defaultValue: "OK"))
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(Color.green.opacity(0.2))
                    )
                    .foregroundStyle(.green)
            case .failed:
                Text(String(localized: "dataExport.scheduled.status.failed", defaultValue: "Failed"))
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(Color.red.opacity(0.2))
                    )
                    .foregroundStyle(.red)
            }
        } else {
            Text("—")
                .foregroundStyle(.tertiary)
        }
    }
}

// MARK: - Helpers

private func formattedTimestamp(_ iso8601: String) -> String {
    guard let date = ISO8601DateFormatter().date(from: iso8601) else {
        return iso8601
    }

    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}
