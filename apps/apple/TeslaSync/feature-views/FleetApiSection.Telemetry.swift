//
//  FleetApiSection.Telemetry.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The remaining four tool cards (ports of the web tool functions):
//  FleetTelemetrySubscribeTool, FleetTelemetryConfigTool, FleetStatusTool, and
//  VehicleDataTools. Subscribe composes the signal-config sheet; Config drives the
//  five-state telemetry-errors panel. All bind through the shared model.
//

import SwiftUI

// MARK: - Telemetry subscribe tool (port of `FleetTelemetrySubscribeTool`)

struct FleetTelemetrySubscribeTool: View {
    let model: FleetApiSectionModel

    @State private var vin = ""
    @State private var hostname = ""
    @State private var port = "443"
    @State private var interval = 30
    @State private var caCert = ""
    @State private var signalSheet = false
    @State private var selectedSignals: [String] = []

    var body: some View {
        FleetToolCard(
            icon: "dot.radiowaves.left.and.right", tone: .cyan,
            titleKey: "Telemetry Sub", titleFallback: "Telemetry Sub",
            descKey: "Telemetry Sub Desc", descFallback: "Subscribe a vehicle to Fleet Telemetry"
        ) {
            FleetVehiclePicker(
                labelKey: "Vehicle", labelFallback: "Vehicle",
                options: model.vehicles, selection: $vin
            )
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: TSSpacing.sm) {
                FleetField(
                    labelKey: "Hostname", labelFallback: "Hostname",
                    promptKey: "devtools.fleet.hostnamePrompt", promptFallback: "telemetry.example.com",
                    systemImage: "server.rack", text: $hostname
                )
                FleetField(
                    labelKey: "Port", labelFallback: "Port",
                    promptKey: "devtools.fleet.portPrompt", promptFallback: "443",
                    systemImage: "network", text: $port
                )
            }
            FleetTextArea(
                labelKey: "Ca Cert", labelFallback: "CA Certificate",
                promptKey: "devtools.fleet.caCertPrompt", promptFallback: "-----BEGIN CERTIFICATE-----",
                text: $caCert
            )
            signalControls
            FleetButton(
                titleKey: "Subscribe", fallback: "Subscribe", variant: .primary, systemImage: "play.fill",
                loading: model.result(for: "fleet-telemetry-subscribe").isLoading
            ) { subscribe() }
            if model.result(for: "fleet-telemetry-subscribe").isPresented {
                FleetResultPanel(
                    titleKey: "Telemetry Sub", titleFallback: "Telemetry Sub",
                    result: model.result(for: "fleet-telemetry-subscribe")
                )
            }
        }
        .sheet(isPresented: $signalSheet) {
            FleetSignalConfigSheet(
                initialSelected: selectedSignals,
                initialInterval: interval
            ) { names, chosenInterval in
                selectedSignals = names
                interval = chosenInterval
            }
        }
    }

    private var signalControls: some View {
        HStack(spacing: TSSpacing.md) {
            FleetButton(
                titleKey: "Configure Signals", fallback: "Configure Signals",
                variant: .secondary, systemImage: "slider.horizontal.3"
            ) { signalSheet = true }
            Text(verbatim: "(\(selectedSignals.count))")
                .font(Font.TS.caption).monospacedDigit().foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
            Text(verbatim: intervalLabel)
                .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
    }

    private var intervalLabel: String {
        FleetApiStrings.format("devtools.fleet.intervalLabel", "Interval: %@", "\(interval)s")
    }

    private func subscribe() {
        var body: [String: JSONValue] = [
            "vins": .array([.string(vin)]),
            "hostname": .string(hostname),
            "port": .number(Double(Int(port) ?? 443)),
            "interval_seconds": .number(Double(interval))
        ]
        if !caCert.isEmpty { body["ca"] = .string(caCert) }
        if !selectedSignals.isEmpty { body["fields"] = .array(selectedSignals.map(JSONValue.string)) }
        model.run(FleetRequest(
            id: "fleet-telemetry-subscribe", endpoint: "fleet-telemetry-subscribe", method: .post, body: body
        ))
    }
}

// MARK: - Telemetry config tool (port of `FleetTelemetryConfigTool`)

struct FleetTelemetryConfigTool: View {
    let model: FleetApiSectionModel
    @State private var vin = ""

    private var vinSelected: Bool {
        !vin.isEmpty
    }

    var body: some View {
        FleetToolCard(
            icon: "antenna.radiowaves.left.and.right", tone: .purple,
            titleKey: "Telemetry Config", titleFallback: "Telemetry Config",
            descKey: "Telemetry Config Desc", descFallback: "Inspect a vehicle's telemetry config"
        ) {
            FleetVehiclePicker(
                labelKey: "Vehicle", labelFallback: "Vehicle",
                options: model.vehicles, selection: $vin
            )
            actionRow
            FleetResultPanel(
                titleKey: "Telemetry Config", titleFallback: "Telemetry Config",
                result: model.result(
                    for: "fleet-telemetry-config",
                    idleKey: "devtools.configIdle", idleFallback: "Fetch config to see results"
                )
            )
            FleetResultPanel(
                titleKey: "Delete Config", titleFallback: "Delete Config",
                result: model.result(for: "delete-telemetry-config")
            )
            FleetTelemetryErrorsPanel(
                titleKey: "Telemetry Errors", titleFallback: "Telemetry Errors",
                phase: FleetApiBuilder.telemetryErrorsPhase(from: model.result(for: "fleet-telemetry-errors")),
                vin: vin
            )
        }
    }

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            FleetButton(
                titleKey: "Get Config", fallback: "Get Config", variant: .primary, systemImage: "eye",
                loading: model.result(for: "fleet-telemetry-config").isLoading, disabled: !vinSelected
            ) { model.run(FleetRequest(id: "fleet-telemetry-config", endpoint: "fleet-telemetry-config?vin=\(vin)")) }
            FleetButton(
                titleKey: "View Errors", fallback: "View Errors", variant: .secondary,
                systemImage: "exclamationmark.triangle",
                loading: model.result(for: "fleet-telemetry-errors").isLoading, disabled: !vinSelected
            ) { model.run(FleetRequest(id: "fleet-telemetry-errors", endpoint: "fleet-telemetry-errors?vin=\(vin)")) }
            FleetButton(
                titleKey: "Delete Config", fallback: "Delete Config", variant: .destructive, systemImage: "trash",
                loading: model.result(for: "delete-telemetry-config").isLoading, disabled: !vinSelected
            ) {
                model.run(FleetRequest(
                    id: "delete-telemetry-config", endpoint: "fleet-telemetry-config?vin=\(vin)", method: .delete
                ))
            }
        }
    }
}

// MARK: - Fleet status tool (port of `FleetStatusTool`)

struct FleetStatusTool: View {
    let model: FleetApiSectionModel

    var body: some View {
        FleetToolCard(
            icon: "bolt.fill", tone: .green,
            titleKey: "Fleet Status", titleFallback: "Fleet Status",
            descKey: "devtools.fleet.statusDesc", descFallback: "Check fleet status for all vehicles"
        ) {
            FleetButton(
                titleKey: "Check Fleet Status", fallback: "Check Fleet Status",
                variant: .primary, systemImage: "play.fill",
                loading: model.result(for: "fleet-status").isLoading,
                disabled: model.vehicles.isEmpty
            ) {
                let vins = model.vehicles.map { JSONValue.string($0.vin) }
                model.run(FleetRequest(
                    id: "fleet-status", endpoint: "fleet-status", method: .post, body: ["vins": .array(vins)]
                ))
            }
            if model.result(for: "fleet-status").isPresented {
                FleetResultPanel(
                    titleKey: "Fleet Status", titleFallback: "Fleet Status",
                    result: model.result(for: "fleet-status")
                )
            }
        }
    }
}

// MARK: - Vehicle data tools (port of `VehicleDataTools`)

struct VehicleDataTools: View {
    let model: FleetApiSectionModel
    @State private var vin = ""

    var body: some View {
        FleetToolCard(
            icon: "car.2.fill", tone: .cyan,
            titleKey: "Vehicle Data", titleFallback: "Vehicle Data",
            descKey: "Vehicle Data Desc", descFallback: "Query live Tesla vehicle endpoints"
        ) {
            FleetVehiclePicker(
                labelKey: "Vehicle", labelFallback: "Vehicle",
                options: model.vehicles, selection: $vin
            )
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: TSSpacing.sm) {
                dataButton("Nearby Charging", "Nearby Charging", "mappin.and.ellipse", "nearby-charging")
                dataButton("Release Notes", "Release Notes", "doc.text", "release-notes")
                dataButton("Recent Alerts", "Recent Alerts", "exclamationmark.triangle", "recent-alerts")
                dataButton("Service Data", "Service Data", "wrench.and.screwdriver", "service-data")
            }
            if model.result(for: "vehicle-data").isPresented {
                FleetResultPanel(
                    titleKey: "Vehicle Data", titleFallback: "Vehicle Data",
                    result: model.result(for: "vehicle-data")
                )
            }
        }
    }

    private func dataButton(_ key: String, _ fallback: String, _ icon: String, _ endpoint: String) -> some View {
        FleetButton(
            titleKey: key, fallback: fallback, variant: .secondary, systemImage: icon,
            loading: model.result(for: "vehicle-data").isLoading
        ) {
            model.run(FleetRequest(id: "vehicle-data", endpoint: "\(endpoint)?vin=\(vin)"))
        }
    }
}
