//
//  VehicleHeroCard.Previews.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  Xcode previews for every branch of the vehicle hero card: full content (photo + gauges + stats, imperial),
//  metric content, the low-battery red gauge, the no-live-data fallback, the loading skeleton, the empty
//  state, the error tile, and the stale + offline freshness states. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let vhcDemoVehicle = VehicleHeroCardVehicle(
        id: 1,
        displayName: "Lightning",
        model: "Model 3",
        vin: "5YJ3E1EA7KF000001",
        state: "online"
    )

    private func vhcDemoState(batteryLevel: Double = 72, isCharging: Bool = false) -> VehicleHeroCardLiveState {
        VehicleHeroCardLiveState(
            batteryLevel: batteryLevel,
            ratedRangeMeters: 441_000,
            insideTempC: 22.5,
            outsideTempC: 14,
            odometerMeters: 68_154_000,
            isCharging: isCharging,
            isLocked: true,
            sentryMode: true,
            softwareVersion: "2026.6.2",
            power: isCharging ? -11 : 0,
            state: isCharging ? "charging" : "online"
        )
    }

    @MainActor
    private func vhcModel(_ snapshot: VehicleHeroCardSnapshot) -> VehicleHeroCardModel {
        let model = VehicleHeroCardModel(source: InMemoryVehicleHeroCardSource(snapshot: snapshot))
        model.start()
        return model
    }

    @MainActor
    private func vhcStaged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 560, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Content · imperial + photo") {
        ScrollView {
            vhcStaged("full content · 72% · mi/°F") {
                VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(
                    vehicle: vhcDemoVehicle,
                    liveState: vhcDemoState(),
                    photoURL: URL(string: "https://teslasync.local/photo.jpg"),
                    unitPrefs: .imperial
                )))
            }
        }
    }

    #Preview("Content · metric") {
        ScrollView {
            vhcStaged("metric · km/°C") {
                VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(
                    vehicle: vhcDemoVehicle,
                    liveState: vhcDemoState(),
                    unitPrefs: .metric
                )))
            }
        }
    }

    #Preview("Content · low battery") {
        ScrollView {
            vhcStaged("battery 12% → red gauge") {
                VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(
                    vehicle: vhcDemoVehicle,
                    liveState: vhcDemoState(batteryLevel: 12),
                    unitPrefs: .imperial
                )))
            }
        }
    }

    #Preview("No live data") {
        vhcStaged("vehicle present · no live state") {
            VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(vehicle: vhcDemoVehicle, liveState: nil)))
        }
    }

    #Preview("Loading / empty / error") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                vhcStaged("loading") {
                    VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(vehicle: nil, isLoading: true)))
                }
                vhcStaged("empty") {
                    VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(vehicle: nil)))
                }
                vhcStaged("error") {
                    VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(
                        vehicle: nil, errorMessage: "Network unavailable"
                    )))
                }
            }
        }
    }

    #Preview("Freshness · stale / offline") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                vhcStaged("stale") {
                    VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(
                        vehicle: vhcDemoVehicle, liveState: vhcDemoState(), connection: .stale
                    )))
                }
                vhcStaged("offline") {
                    VehicleHeroCard(model: vhcModel(VehicleHeroCardSnapshot(
                        vehicle: vhcDemoVehicle, liveState: vhcDemoState(), connection: .offline
                    )))
                }
            }
        }
    }
#endif
