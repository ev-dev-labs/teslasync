#if os(iOS)
    import ActivityKit
    import SwiftUI
    import WidgetKit

    /// The active-drive / trip-replay Live Activity UI. Values arrive SI (m/s, m, s)
    /// and are formatted at the render boundary.
    struct DriveLiveActivity: Widget {
        var body: some WidgetConfiguration {
            ActivityConfiguration(for: DriveActivityAttributes.self) { context in
                DriveLockScreenView(attributes: context.attributes, state: context.state)
                    .padding()
                    .activityBackgroundTint(Color.black.opacity(0.6))
            } dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                        Label {
                            Text(DriveActivityFormat.distance(context.state.distanceMeters))
                        } icon: {
                            Image(systemName: "car.fill").foregroundStyle(.blue)
                        }
                    }
                    DynamicIslandExpandedRegion(.trailing) {
                        Text(DriveActivityFormat.duration(context.state.durationSeconds))
                            .monospacedDigit()
                    }
                    DynamicIslandExpandedRegion(.bottom) {
                        HStack {
                            Text(verbatim: context.attributes.vehicleName)
                            Spacer()
                            if let destination = context.state.destination {
                                Label(destination, systemImage: "mappin.and.ellipse")
                                    .font(.caption)
                            }
                        }
                    }
                } compactLeading: {
                    Image(systemName: "car.fill").foregroundStyle(.blue)
                } compactTrailing: {
                    Text(DriveActivityFormat.distance(context.state.distanceMeters))
                } minimal: {
                    Image(systemName: "car.fill").foregroundStyle(.blue)
                }
            }
        }
    }

    struct DriveLockScreenView: View {
        let attributes: DriveActivityAttributes
        let state: DriveActivityAttributes.ContentState

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label(attributes.vehicleName, systemImage: "car.fill")
                        .font(.headline)
                    Spacer()
                    Text(DriveActivityFormat.battery(state.batteryLevel))
                        .font(.headline.monospacedDigit())
                }
                HStack {
                    metric(DriveActivityFormat.distance(state.distanceMeters), label: "activity.drive.distance")
                    Spacer()
                    metric(DriveActivityFormat.duration(state.durationSeconds), label: "activity.drive.duration")
                    if let speedMps = state.speedMps {
                        Spacer()
                        metric(DriveActivityFormat.speed(speedMps), label: "activity.drive.speed")
                    }
                }
                if let destination = state.destination {
                    Label(destination, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }

        private func metric(_ value: String, label: LocalizedStringKey) -> some View {
            VStack(alignment: .leading, spacing: 2) {
                Text(value).font(.subheadline.monospacedDigit())
                Text(label).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    /// SI → display formatting for the drive activity (render-boundary only).
    enum DriveActivityFormat {
        static func distance(_ meters: Double) -> String {
            String(format: "%.1f km", meters / 1000)
        }

        static func speed(_ mps: Double) -> String {
            String(format: "%.0f km/h", mps * 3.6)
        }

        static func duration(_ seconds: Int) -> String {
            let minutes = seconds / 60
            return "\(minutes / 60)h \(minutes % 60)m"
        }

        static func battery(_ fraction: Double) -> String {
            "\(Int((min(max(fraction, 0), 1) * 100).rounded()))%"
        }
    }
#endif
