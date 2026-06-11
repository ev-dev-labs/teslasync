//
//  PollingEngine.Previews.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  Xcode previews for each surface state (disabled / loading / error / ready-live / ready-empty /
//  ready-stale / ready-offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum PollingPreviewData {
        static let savings = PollingCostSnapshot(
            pollsMade: 1284,
            pollsSaved: 942,
            savingsPercent: 42.5,
            estimatedSavings: 12.84,
            remainingCredit: 87.16,
            savingsBreakdown: [
                "fleet_telemetry": 540,
                "idle_detection": 280,
                "prediction": 90,
                "sleep_detection": 32
            ]
        )

        static func vehicles(now: Date) -> [PollingVehicleStatus] {
            [
                PollingVehicleStatus(
                    vin: "5YJ3E1EA7KF317261",
                    activity: .active,
                    profile: .driving,
                    consecIdle: 0,
                    batteryLevel: 78,
                    nextPollAfter: now.addingTimeInterval(90),
                    lastDecision: PollingDecision(
                        nextIntervalMs: 15000,
                        reasons: ["Vehicle is driving", "High data-rate window"],
                        prediction: PollingPrediction(
                            nextState: "charging",
                            estimatedInNanos: 1_200_000_000_000,
                            confidence: 0.82,
                            basedOn: "recent drive pattern"
                        )
                    )
                ),
                PollingVehicleStatus(
                    vin: "5YJSA1E26MF860104",
                    activity: .idle,
                    profile: .idle,
                    consecIdle: 5,
                    batteryLevel: 64,
                    nextPollAfter: now.addingTimeInterval(600),
                    lastDecision: PollingDecision(
                        nextIntervalMs: 300_000,
                        reasons: ["Vehicle idle", "Backing off to conserve credit"],
                        prediction: nil
                    )
                ),
                PollingVehicleStatus(
                    vin: "7SAYGDEF9NF512033",
                    activity: .sleeping,
                    profile: .sleeping,
                    consecIdle: 22,
                    batteryLevel: 55,
                    nextPollAfter: now.addingTimeInterval(3600),
                    lastDecision: nil
                )
            ]
        }

        static func enabled(now: Date) -> PollingInput {
            PollingInput(
                status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: vehicles(now: now))),
                savings: savings,
                connection: .live
            )
        }

        static func enabled(connection: PollingConnection, now: Date) -> PollingInput {
            PollingInput(
                status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: vehicles(now: now))),
                savings: savings,
                connection: connection
            )
        }

        static var empty: PollingInput {
            PollingInput(
                status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: [])),
                savings: savings,
                connection: .live
            )
        }

        static let disabled = PollingInput(
            status: .loaded(PollingStatusSnapshot(enabled: false, vehicles: [])),
            connection: .live
        )

        static let loading = PollingInput(status: .loading)

        static let failed = PollingInput(status: .failed("The polling status endpoint timed out."))
    }

    @MainActor
    private func pollingPreviewModel(_ input: PollingInput) -> PollingEngineModel {
        let source = InMemoryPollingEngineSource(initial: input)
        let model = PollingEngineModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func pollingStaged(_ model: PollingEngineModel) -> some View {
        ScrollView {
            PollingEngine(model: model)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg)
    }

    #Preview("Ready · live") {
        pollingStaged(pollingPreviewModel(PollingPreviewData.enabled(now: Date())))
    }

    #Preview("Ready · empty") {
        pollingStaged(pollingPreviewModel(PollingPreviewData.empty))
    }

    #Preview("Loading") {
        pollingStaged(pollingPreviewModel(PollingPreviewData.loading))
    }

    #Preview("Error") {
        pollingStaged(pollingPreviewModel(PollingPreviewData.failed))
    }

    // The disabled surface renders nothing (faithful `!status.enabled → null`); the preview shows
    // the collapse alongside its label so the behaviour is visible in the canvas.
    #Preview("Disabled") {
        pollingStaged(pollingPreviewModel(PollingPreviewData.disabled))
    }

    #Preview("Ready · stale") {
        pollingStaged(pollingPreviewModel(PollingPreviewData.enabled(connection: .stale, now: Date())))
    }

    #Preview("Ready · offline") {
        pollingStaged(pollingPreviewModel(PollingPreviewData.enabled(connection: .offline, now: Date())))
    }
#endif
