//
//  AlertStudioPage.Previews.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  Xcode previews + the shared sample fixtures the previews (and tests) build their
//  view-models from. Every P4 state the surface renders has a preview: the populated
//  content (rules + channels + metrics loaded), the empty fleet (no rules yet), the
//  initial loading skeleton, the error + offline page states, the computed-metric
//  editor branch, and the snooze sheet. All fixtures use the in-memory sources + the
//  `.echo` localizer so previews render without the shared core or a bundle.
//

import SwiftUI

// MARK: - Sample fixtures (shared by previews + tests)

enum AlertStudioSamples {
    static let vehicles: [ASVehicle] = [
        ASVehicle(id: 1, displayName: "Model 3"),
        ASVehicle(id: 2, displayName: "Model Y")
    ]

    static let channels: [ASNotificationChannel] = [
        ASNotificationChannel(id: 10, name: "Ops Discord", kind: "discord"),
        ASNotificationChannel(id: 11, name: "On-call Slack", kind: "slack")
    ]

    static let metrics: [ASComputedMetricSummary] = [
        ASComputedMetricSummary(
            id: "charging_cost",
            label: "Charging cost",
            unit: "currency",
            windows: ["7d", "30d"],
            ops: [.greaterThan, .greaterThanOrEqual, .lessThan]
        ),
        ASComputedMetricSummary(
            id: "energy_used",
            label: "Energy used",
            unit: "kwh",
            windows: ["1d", "7d"],
            ops: [.greaterThan, .percentChangeGreater]
        )
    ]

    static let rules: [ASAlertRule] = [
        ASAlertRule(
            id: 100,
            name: "Battery Low",
            enabled: true,
            signalName: "BatteryLevel",
            op: .lessThan,
            severity: .warn,
            cooldownMin: 30,
            triggerMode: .repeatMode,
            allVehicles: true,
            vehicleIDs: [],
            valueNum: 20,
            updatedAt: "2026-06-01T12:00:00Z"
        ),
        ASAlertRule(
            id: 101,
            name: "Car Unlocked While Parked",
            enabled: true,
            signalName: "Locked",
            op: .equal,
            severity: .critical,
            cooldownMin: 30,
            triggerMode: .once,
            allVehicles: false,
            vehicleIDs: [1],
            valueBool: false,
            snoozedUntil: "2999-01-01T00:00:00Z",
            updatedAt: "2026-06-02T08:30:00Z"
        ),
        ASAlertRule(
            id: 102,
            name: "Charge Complete",
            enabled: false,
            signalName: "ChargeState",
            op: .equal,
            severity: .info,
            cooldownMin: 60,
            triggerMode: .once,
            allVehicles: true,
            vehicleIDs: [],
            valueText: "Complete",
            updatedAt: "2026-06-03T19:15:00Z"
        ),
        ASAlertRule(
            id: 103,
            name: "Speed Limit Exceeded",
            enabled: true,
            signalName: "VehicleSpeed",
            op: .greaterThan,
            severity: .warn,
            cooldownMin: 15,
            triggerMode: .repeatMode,
            allVehicles: true,
            vehicleIDs: [],
            valueNum: 120,
            updatedAt: "2026-06-04T06:45:00Z"
        )
    ]

    @MainActor
    static func viewModel(
        rules: ASListSnapshot<ASAlertRule>,
        channels: ASListSnapshot<ASNotificationChannel> = .loaded(channels),
        metrics: ASListSnapshot<ASComputedMetricSummary> = .loaded(metrics),
        editor: EditorState? = nil
    ) -> AlertStudioViewModel {
        let model = AlertStudioViewModel(
            rulesModel: ASRulesModel(preview: rules),
            channelsModel: ASChannelsModel(preview: channels),
            metricsModel: ASMetricsModel(preview: metrics),
            vehicles: vehicles,
            localize: .echo
        )
        if let editor { model.previewSetEditor(editor) }
        return model
    }
}

extension AlertStudioViewModel {
    /// Preview/test affordance: seed the editor + baseline without going through the
    /// guarded-switch flow.
    @MainActor
    func previewSetEditor(_ editor: EditorState) {
        updateEditor { $0 = editor }
    }
}

// MARK: - Previews

#if DEBUG
    #Preview("Content") {
        AlertStudioPage(viewModel: AlertStudioSamples.viewModel(rules: .loaded(AlertStudioSamples.rules)))
    }

    #Preview("Empty fleet") {
        AlertStudioPage(viewModel: AlertStudioSamples.viewModel(rules: .loaded([])))
    }

    #Preview("Loading") {
        AlertStudioPage(viewModel: AlertStudioSamples.viewModel(rules: ASListSnapshot(status: .loading)))
    }

    #Preview("Error") {
        AlertStudioPage(
            viewModel: AlertStudioSamples.viewModel(
                rules: ASListSnapshot(status: .failed, error: .network(message: "500"))
            )
        )
    }

    #Preview("Offline") {
        AlertStudioPage(
            viewModel: AlertStudioSamples.viewModel(
                rules: ASListSnapshot(status: .failed, error: .offline)
            )
        )
    }

    #Preview("Computed metric") {
        AlertStudioPage(
            viewModel: AlertStudioSamples.viewModel(
                rules: .loaded(AlertStudioSamples.rules),
                editor: {
                    var editor = EditorState.fresh()
                    editor.name = "Weekly charging cost"
                    editor.kind = .computedMetric
                    editor.metricID = "charging_cost"
                    editor.metricWindow = "7d"
                    editor.metricThreshold = "50"
                    editor.triggerMode = .once
                    return editor
                }()
            )
        )
    }
#endif
