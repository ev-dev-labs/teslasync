#if os(iOS)
    import ActivityKit
    import SwiftUI
    import WidgetKit

    /// The charging session Live Activity UI — lock-screen / banner presentation plus
    /// the Dynamic Island (expanded, compact, minimal). Values arrive SI and are
    /// formatted here at the render boundary.
    struct ChargingLiveActivity: Widget {
        var body: some WidgetConfiguration {
            ActivityConfiguration(for: ChargingActivityAttributes.self) { context in
                ChargingLockScreenView(attributes: context.attributes, state: context.state)
                    .padding()
                    .activityBackgroundTint(Color.black.opacity(0.6))
            } dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                        Label {
                            Text(ChargingActivityFormat.percent(context.state.batteryLevel))
                        } icon: {
                            Image(systemName: "bolt.fill").foregroundStyle(.green)
                        }
                    }
                    DynamicIslandExpandedRegion(.trailing) {
                        ChargingETAView(finishBy: context.state.finishBy)
                    }
                    DynamicIslandExpandedRegion(.bottom) {
                        ProgressView(value: min(max(context.state.batteryLevel, 0), 1)) {
                            Text(verbatim: context.attributes.vehicleName)
                        }
                        .tint(.green)
                    }
                } compactLeading: {
                    Image(systemName: "bolt.fill").foregroundStyle(.green)
                } compactTrailing: {
                    Text(ChargingActivityFormat.percent(context.state.batteryLevel))
                } minimal: {
                    Image(systemName: "bolt.fill").foregroundStyle(.green)
                }
            }
        }
    }

    struct ChargingLockScreenView: View {
        let attributes: ChargingActivityAttributes
        let state: ChargingActivityAttributes.ContentState

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label(attributes.vehicleName, systemImage: "bolt.car.fill")
                        .font(.headline)
                    Spacer()
                    Text(ChargingActivityFormat.percent(state.batteryLevel))
                        .font(.headline.monospacedDigit())
                }
                ProgressView(value: min(max(state.batteryLevel, 0), 1))
                    .tint(.green)
                HStack {
                    if let powerW = state.powerW {
                        Text(ChargingActivityFormat.power(powerW))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    ChargingETAView(finishBy: state.finishBy)
                        .font(.caption)
                }
            }
        }
    }

    struct ChargingETAView: View {
        let finishBy: Date?

        var body: some View {
            if let finishBy, finishBy > Date() {
                Text(timerInterval: Date() ... finishBy, countsDown: true)
                    .monospacedDigit()
            } else {
                Text("—")
            }
        }
    }

    /// SI → display formatting for the charging activity (render-boundary only).
    enum ChargingActivityFormat {
        static func percent(_ fraction: Double) -> String {
            "\(Int((min(max(fraction, 0), 1) * 100).rounded()))%"
        }

        static func power(_ watts: Double) -> String {
            String(format: "%.1f kW", watts / 1000)
        }
    }
#endif
