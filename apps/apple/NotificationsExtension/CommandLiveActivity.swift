#if os(iOS)
    import ActivityKit
    import SwiftUI
    import WidgetKit

    /// The vehicle-command execution Live Activity UI — tracks a queued command to its
    /// terminal state with a status glyph + optional message.
    struct CommandLiveActivity: Widget {
        var body: some WidgetConfiguration {
            ActivityConfiguration(for: CommandActivityAttributes.self) { context in
                CommandLockScreenView(attributes: context.attributes, state: context.state)
                    .padding()
                    .activityBackgroundTint(Color.black.opacity(0.6))
            } dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                        Image(systemName: CommandActivityStyle.icon(context.state.status))
                            .foregroundStyle(CommandActivityStyle.color(context.state.status))
                    }
                    DynamicIslandExpandedRegion(.trailing) {
                        Text(CommandActivityStyle.label(context.state.status))
                            .font(.caption)
                    }
                    DynamicIslandExpandedRegion(.bottom) {
                        VStack(alignment: .leading) {
                            Text(verbatim: context.attributes.commandName).font(.headline)
                            Text(verbatim: context.attributes.vehicleName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } compactLeading: {
                    Image(systemName: CommandActivityStyle.icon(context.state.status))
                        .foregroundStyle(CommandActivityStyle.color(context.state.status))
                } compactTrailing: {
                    Text(CommandActivityStyle.label(context.state.status)).font(.caption2)
                } minimal: {
                    Image(systemName: CommandActivityStyle.icon(context.state.status))
                        .foregroundStyle(CommandActivityStyle.color(context.state.status))
                }
            }
        }
    }

    struct CommandLockScreenView: View {
        let attributes: CommandActivityAttributes
        let state: CommandActivityAttributes.ContentState

        var body: some View {
            HStack(spacing: 12) {
                Image(systemName: CommandActivityStyle.icon(state.status))
                    .font(.title2)
                    .foregroundStyle(CommandActivityStyle.color(state.status))
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: attributes.commandName).font(.headline)
                    Text(verbatim: state.message ?? attributes.vehicleName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(CommandActivityStyle.label(state.status))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(CommandActivityStyle.color(state.status))
            }
        }
    }

    /// Status → glyph/colour/label for the command activity (render-boundary only).
    enum CommandActivityStyle {
        static func icon(_ status: CommandActivityStatus) -> String {
            switch status {
            case .pending: "clock"
            case .sent: "paperplane.fill"
            case .executing: "gearshape.fill"
            case .succeeded: "checkmark.circle.fill"
            case .failed: "xmark.octagon.fill"
            }
        }

        static func color(_ status: CommandActivityStatus) -> Color {
            switch status {
            case .pending, .sent, .executing: .blue
            case .succeeded: .green
            case .failed: .red
            }
        }

        static func label(_ status: CommandActivityStatus) -> LocalizedStringKey {
            switch status {
            case .pending: "activity.command.pending"
            case .sent: "activity.command.sent"
            case .executing: "activity.command.executing"
            case .succeeded: "activity.command.succeeded"
            case .failed: "activity.command.failed"
            }
        }
    }
#endif
