//
//  GuardModePage.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple)
//
//  SwiftUI / HIG parity of web/src/features/vehicle-systems/pages/GuardModePage.tsx
//  — anti-theft monitoring and emergency response. Adaptive across macOS and iOS
//  (ADR-002, ADR-006). Six panels (toggle · status · panic · settings · live map
//  · event timeline), a MapKit live map, the four data states, and every visible
//  string from the catalog. Bound to `GuardModePageModel`; no logic in the body.
//

import CoreLocation
import SwiftUI

struct GuardModePage: View {
    @State private var model = GuardModePageModel()

    var body: some View {
        ScrollView {
            switch model.viewState {
            case .loading:
                loadingView
            case let .error(message):
                errorView(message)
            case .empty:
                emptyView
            case .success:
                contentView
            }
        }
        .navigationTitle(String(localized: "translation.guard.title", defaultValue: "Guard Mode"))
        .toolbar { ToolbarItem(placement: .primaryAction) { vehiclePicker } }
        .task { await model.load() }
        .refreshable { await model.refresh() }
        .confirmationDialog(
            String(localized: "translation.guard.panicConfirmTitle", defaultValue: "Activate Panic Mode?"),
            isPresented: $model.panicDialogOpen,
            titleVisibility: .visible
        ) {
            Button(panicConfirmLabel, role: .destructive) {
                Task { await model.confirmPanic() }
            }
        } message: {
            Text(panicConfirmMessage)
        }
    }

    // MARK: - Success / content

    private var contentView: some View {
        VStack(alignment: .leading, spacing: 20) {
            subtitleHeader
            if model.isStale {
                GuardModeStalenessChip()
            }
            if model.isTriggered, let latest = model.latestEvent {
                GuardModeTriggeredBanner(event: latest)
            }
            statusRow
            settingsPanel
            liveMapPanel
            timelinePanel
        }
        .padding()
        .frame(maxWidth: 1100, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    private var subtitleHeader: some View {
        Text(String(
            localized: "translation.guard.subtitle",
            defaultValue: "Anti-theft monitoring and emergency response"
        ))
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    // MARK: - Row 1 (toggle · status · panic)

    private var statusRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) {
                togglePanel
                statusPanel
                panicPanel
            }
            VStack(spacing: 16) {
                togglePanel
                statusPanel
                panicPanel
            }
        }
    }

    private var togglePanel: some View {
        GuardModeTogglePanel(
            armState: model.armState,
            isArmed: model.isArmed,
            isUpdating: model.isSettingConfig,
            onToggle: { Task { await model.toggleGuard() } }
        )
    }

    private var statusPanel: some View {
        GuardModeStatusPanel(
            armedSinceText: model.armedSinceText,
            isLocked: model.isLocked,
            sentryActive: model.sentryActive,
            unacknowledgedSummary: model.unacknowledgedSummary
        )
    }

    private var panicPanel: some View {
        GuardModePanicPanel(
            isPanicking: model.isPanicking,
            isDisabled: model.selectedVehicleID <= 0,
            onPanic: { model.panicDialogOpen = true }
        )
    }

    // MARK: - Row 2 (settings)

    private var settingsPanel: some View {
        GuardModeSettingsPanel(
            geofences: model.geofences,
            selectedGeofenceID: $model.selectedGeofenceID,
            selectedSensitivity: $model.selectedSensitivity,
            autoPanicEnabled: $model.autoPanicEnabled,
            isSaving: model.isSettingConfig,
            onSave: { Task { await model.saveSettings() } }
        )
    }

    // MARK: - Row 3 (live map · GlassPanel 5)

    private var liveMapPanel: some View {
        GuardModeLiveMapPanel(
            coordinate: model.vehicleCoordinate,
            vehicleName: model.activeVehicleName,
            homeGeofence: model.homeGeofence
        )
    }

    // MARK: - Row 4 (timeline)

    private var timelinePanel: some View {
        GuardModeTimelinePanel(
            events: model.events,
            unacknowledgedCount: model.unacknowledgedCount,
            isAcknowledging: model.isAcknowledging,
            onAcknowledge: { eventID in Task { await model.acknowledge(eventID) } }
        )
    }

    // MARK: - Toolbar vehicle selector (web VehicleSelect)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            ForEach(model.vehicles) { vehicle in
                Text(vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Label(model.activeVehicleName, systemImage: "car.fill")
        }
        .pickerStyle(.menu)
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Loading state

    private var loadingView: some View {
        VStack(spacing: 20) {
            ForEach(0 ..< 4, id: \.self) { _ in
                GuardModeCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(verbatim: "Guard panel")
                            .font(.headline)
                        Text(verbatim: "Loading guard data")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding()
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
    }

    // MARK: - Empty state

    private var emptyView: some View {
        ContentUnavailableView {
            Label(
                String(localized: "translation.guard.title", defaultValue: "Guard Mode"),
                systemImage: "exclamationmark.shield"
            )
        } description: {
            Text(String(
                localized: "translation.guard.subtitle",
                defaultValue: "Anti-theft monitoring and emergency response"
            ))
        }
        .padding()
    }

    // MARK: - Error state

    private func errorView(_ message: String) -> some View {
        ContentUnavailableView {
            Label(
                String(localized: "translation.guard.title", defaultValue: "Guard Mode"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text(message)
        } actions: {
            Button(String(localized: "translation.common.retry", defaultValue: "Retry")) {
                Task { await model.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private var panicConfirmLabel: String {
        String(localized: "translation.guard.panicConfirmLabel", defaultValue: "🚨 ACTIVATE PANIC")
    }

    private var panicConfirmMessage: String {
        String(
            localized: "translation.guard.panicConfirmMessage",
            defaultValue: """
            This will immediately flash lights, honk horn, lock doors, \
            enable sentry mode, and send alerts to all notification channels.
            """
        )
    }
}

// MARK: - GlassPanel 5 — Live map panel wrapper

/// The live map card (web GlassPanel 5) — the MapKit canvas when a location is
/// known, otherwise a `ContentUnavailableView` (never a blank region).
struct GuardModeLiveMapPanel: View {
    let coordinate: CLLocationCoordinate2D?
    let vehicleName: String
    let homeGeofence: GuardModeGeofence?

    var body: some View {
        GuardModeCard {
            VStack(alignment: .leading, spacing: 12) {
                GuardModeSectionTitle(
                    text: String(localized: "translation.guard.liveMap", defaultValue: "Live Vehicle Location")
                )
                if let coordinate {
                    GuardModeLiveMap(
                        coordinate: coordinate,
                        vehicleName: vehicleName,
                        homeGeofence: homeGeofence,
                        trailCoordinates: []
                    )
                    .frame(height: 360)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    ContentUnavailableView(
                        String(
                            localized: "translation.guard.noLocation",
                            defaultValue: "No vehicle location available"
                        ),
                        systemImage: "mappin.slash"
                    )
                    .frame(height: 360)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Staleness indicator (ADR-013 — live values older than 2 minutes)

/// A subtle chip surfaced when the last refresh is older than two minutes.
struct GuardModeStalenessChip: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "clock.badge.exclamationmark")
            Text(String(localized: "translation.common.staleData", defaultValue: "Data may be out of date"))
        }
        .font(.caption)
        .foregroundStyle(.orange)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(.orange.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack {
        GuardModePage()
    }
}
