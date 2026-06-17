//
//  GeofencesPage.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple)
//
//  SwiftUI / HIG parity of web/src/features/maps/pages/GeofencesPage.tsx — manage
//  geofence zones with create / edit / delete / toggle / inline-rename / bulk-delete,
//  a summary stat grid, an AI location-id picker, a searchable pinned-first list,
//  and a create/edit sheet with a "Use Current Location" panel that hosts the
//  MapKit draw map. Adaptive across macOS and iOS (ADR-002, ADR-006). Eight panels,
//  three MapKit surfaces, the four data states, and every visible string from the
//  catalog. Bound to `GeofencesPageModel`; no business logic in the view body.
//

import SwiftUI

struct GeofencesPage: View {
    @State private var model = GeofencesPageModel()

    var body: some View {
        ScrollView {
            switch model.viewState {
            case .loading:
                loadingView
            case let .error(message):
                errorView(message)
            case .empty, .success:
                contentView
            }
        }
        .navigationTitle(String(localized: "Geofences", defaultValue: "Geofences"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    model.openCreate()
                } label: {
                    Label(
                        String(localized: "Add Geofence", defaultValue: "Add Geofence"),
                        systemImage: "plus"
                    )
                }
            }
        }
        .task { await model.load() }
        .refreshable { await model.refresh() }
        .sheet(isPresented: $model.isModalOpen) {
            GeofencesFormSheet(model: model)
                .interactiveDismissDisabled(model.isFormDirty)
        }
        .alert(
            String(localized: "Delete Geofence", defaultValue: "Delete Geofence"),
            isPresented: deleteAlertBinding,
            presenting: model.deleteTarget
        ) { _ in
            Button(String(localized: "Delete", defaultValue: "Delete"), role: .destructive) {
                Task { await model.confirmDelete() }
            }
            Button(String(localized: "Cancel", defaultValue: "Cancel"), role: .cancel) {
                model.deleteTarget = nil
            }
        } message: { zone in
            Text(deleteMessage(name: zone.name))
        }
        .confirmationDialog(
            String(localized: "geofences.bulk.deleteConfirm.title", defaultValue: "Delete geofences?"),
            isPresented: $showBulkDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button(String(localized: "common.delete", defaultValue: "Delete"), role: .destructive) {
                Task { await model.bulkDeleteSelected() }
            }
            Button(String(localized: "Cancel", defaultValue: "Cancel"), role: .cancel) {}
        } message: {
            Text(String(
                localized: "geofences.bulk.deleteConfirm.body",
                defaultValue: """
                Selected geofences will be removed permanently. Linked alert rules and \
                automations will continue to reference their old IDs.
                """
            ))
        }
        .overlay(alignment: .bottom) { toastOverlay }
    }

    @State private var showBulkDeleteConfirm = false

    // MARK: - Success / empty content (web PageContainer body)

    private var contentView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            subtitleHeader
            if model.isStale {
                GeofencesStalenessChip()
            }
            GeofencesSummaryPanel(stats: model.stats, hasAnyZone: model.hasAnyZone)
            GeofencesAILocationPicker(rawValue: $model.aiLocationIDRaw)
            if !model.selectedIDs.isEmpty {
                GeofencesBulkToolbar(
                    count: model.selectedIDs.count,
                    onClear: { model.clearSelection() },
                    onDelete: { showBulkDeleteConfirm = true }
                )
            }
            if model.hasAnyZone {
                GeofencesSearchBar(search: $model.search, onClear: { model.clearSearch() })
            }
            listSection
        }
        .padding()
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var listSection: some View {
        if model.hasAnyZone {
            if model.filteredZones.isEmpty {
                GeofencesNoMatchState(onClear: { model.clearSearch() })
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, TSSpacing.x2xl)
            } else {
                LazyVStack(spacing: TSSpacing.md) {
                    ForEach(model.sortedZones) { zone in
                        GeofencesListCard(
                            zone: zone,
                            isSelected: model.isSelected(zone.id),
                            isPinned: model.isPinned(zone.id),
                            onToggleSelect: { model.toggleSelection(zone.id) },
                            onTogglePin: { model.togglePin(zone) },
                            onToggleEnabled: { enabled in Task { await model.toggle(zone, enabled: enabled) } },
                            onEdit: { model.openEdit(zone) },
                            onDelete: { model.requestDelete(zone) },
                            onRename: { name in await model.rename(zone, to: name) }
                        )
                    }
                }
            }
        } else {
            GeofencesEmptyState(onAdd: { model.openCreate() })
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.x2xl)
        }
    }

    private var subtitleHeader: some View {
        Text(String(
            localized: "Define locations for contextual tracking and automation",
            defaultValue: "Define locations for contextual tracking and automation"
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
    }

    // MARK: - Loading state (web skeleton — GlassPanel 6)

    private var loadingView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            subtitleHeader
            GeofencesLoadingPanel()
        }
        .padding()
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Error state (web PageContainer error)

    private func errorView(_ message: String) -> some View {
        let prefix = String(localized: "common.error", defaultValue: "Something went wrong")
        return ContentUnavailableView {
            Label(
                String(localized: "Geofences", defaultValue: "Geofences"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text("\(prefix): \(message)")
        } actions: {
            Button(String(localized: "common.retry", defaultValue: "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    // MARK: - Toast overlay (web `useToast`)

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast = model.toast {
            GeofencesToastView(toast: toast)
                .padding(.bottom, TSSpacing.xl)
                .padding(.horizontal, TSSpacing.lg)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .id(toast.id)
        }
    }

    // MARK: - Bindings + helpers

    private var deleteAlertBinding: Binding<Bool> {
        Binding(
            get: { model.deleteTarget != nil },
            set: { presented in if !presented { model.deleteTarget = nil } }
        )
    }

    private func deleteMessage(name: String) -> String {
        String(
            localized: "Are you sure you want to delete \"{{name}}\"? This action cannot be undone.",
            defaultValue: "Are you sure you want to delete \"{{name}}\"? This action cannot be undone."
        )
        .replacingOccurrences(of: "{{name}}", with: name)
    }
}

#Preview {
    NavigationStack {
        GeofencesPage()
    }
}
