//
//  ScheduledExportsPanel.swift
//  TeslaSync — P4 feature view · P7 · ScheduledExportsPanel (Apple) — SwiftUI View
//

import SwiftUI

struct ScheduledExportsPanel: View {
    @State private var model = ScheduledExportsPanelModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "dataExport.scheduled.title", defaultValue: "Scheduled exports"))
                            .font(.title2)
                            .fontWeight(.semibold)

                        Text(String(
                            localized: "dataExport.scheduled.subtitle",
                            defaultValue: "Cron-driven recurring exports."
                        ))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button {
                        model.startCreate()
                    } label: {
                        Label(
                            String(localized: "dataExport.scheduled.newSchedule", defaultValue: "New schedule"),
                            systemImage: "plus"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.regularMaterial)
                )

                // Form (if shown)
                if model.showForm {
                    ScheduledExportsFormView(model: model)
                }

                // Content
                Group {
                    switch model.state {
                    case .loading:
                        LoadingView()
                    case .empty:
                        EmptyView(model: model)
                    case let .error(message):
                        ErrorView(message: message, onRetry: {
                            Task {
                                await model.load()
                            }
                        })
                    case .success:
                        if model.exports.isEmpty {
                            EmptyView(model: model)
                        } else {
                            ExportsTableView(model: model)
                        }
                    }
                }
            }
            .padding()
        }
        .task {
            await model.load()
        }
        .refreshable {
            await model.refresh()
        }
        .alert(
            String(localized: "dataExport.scheduled.deleteConfirmTitle", defaultValue: "Delete schedule?"),
            isPresented: Binding(
                get: { model.pendingDeleteExport != nil },
                set: { if !$0 { model.pendingDeleteExport = nil } }
            ),
            presenting: model.pendingDeleteExport
        ) { export in
            Button(role: .cancel) {
                model.pendingDeleteExport = nil
            } label: {
                Text("Cancel")
            }

            Button(role: .destructive) {
                Task {
                    _ = await model.deleteExport(export.id)
                    model.pendingDeleteExport = nil
                }
            } label: {
                Text(String(localized: "dataExport.scheduled.actions.delete", defaultValue: "Delete"))
            }
        } message: { export in
            Text(String(
                localized: "dataExport.scheduled.deleteConfirmBody",
                defaultValue: "This will stop future runs of \(export.name)."
            ))
        }
    }
}

// MARK: - Loading View

private struct LoadingView: View {
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0 ..< 3) { _ in
                RoundedRectangle(cornerRadius: 8)
                    .fill(.tertiary)
                    .frame(height: 60)
                    .redacted(reason: .placeholder) // parity:allow SwiftUI loading skeleton API
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
        )
    }
}

// MARK: - Empty View

private struct EmptyView: View {
    let model: ScheduledExportsPanelModel

    var body: some View {
        ContentUnavailableView {
            Label(
                String(localized: "dataExport.scheduled.empty", defaultValue: "No schedules yet"),
                systemImage: "calendar.badge.clock"
            )
        } description: {
            Text(String(
                localized: "dataExport.scheduled.emptyMessage",
                defaultValue: "Create a schedule to receive recurring exports automatically."
            ))
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
        )
    }
}

// MARK: - Error View

private struct ErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Error", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.regularMaterial)
        )
    }
}

// MARK: - Preview

#Preview {
    ScheduledExportsPanel()
}
