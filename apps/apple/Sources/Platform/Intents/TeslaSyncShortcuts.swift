import AppIntents

/// Declares TeslaSync's App Shortcuts so the safe intents are available in Siri,
/// Spotlight, and the Shortcuts gallery without the user building anything.
///
/// Kept to the system's per-provider budget and to **safe** entry points:
/// navigation + read-only status answer hands-free; the one actuating shortcut
/// (`StartVehicleCommandIntent`) still enforces auth + permission + confirmation
/// inside `perform()`.
public struct TeslaSyncShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ViewChargingStatusIntent(),
            phrases: [
                "Check charging status in \(.applicationName)",
                "What's my \(.applicationName) charge level"
            ],
            shortTitle: "intent.charging.title",
            systemImageName: "bolt.fill"
        )
        AppShortcut(
            intent: ShowLatestAlertIntent(),
            phrases: [
                "Show my latest \(.applicationName) alert",
                "Any new alerts in \(.applicationName)"
            ],
            shortTitle: "intent.alert.title",
            systemImageName: "bell.fill"
        )
        AppShortcut(
            intent: RefreshVehicleStateIntent(),
            phrases: [
                "Refresh my vehicle in \(.applicationName)",
                "Update \(.applicationName) vehicle state"
            ],
            shortTitle: "intent.refresh.title",
            systemImageName: "arrow.clockwise"
        )
        AppShortcut(
            intent: OpenLiveMapIntent(),
            phrases: [
                "Open the live map in \(.applicationName)",
                "Show my vehicle on the \(.applicationName) map"
            ],
            shortTitle: "intent.openLiveMap.title",
            systemImageName: "mappin.and.ellipse"
        )
        AppShortcut(
            intent: OpenVehicleIntent(),
            phrases: [
                "Open my vehicle in \(.applicationName)",
                "Show my \(.applicationName) vehicle"
            ],
            shortTitle: "intent.openVehicle.title",
            systemImageName: "car.fill"
        )
        AppShortcut(
            intent: StartVehicleCommandIntent(),
            phrases: [
                "Send a command with \(.applicationName)",
                "Run a \(.applicationName) vehicle command"
            ],
            shortTitle: "intent.command.title",
            systemImageName: "play.circle.fill"
        )
        AppShortcut(
            intent: ExportReportIntent(),
            phrases: [
                "Export a report from \(.applicationName)",
                "Create a \(.applicationName) report"
            ],
            shortTitle: "intent.export.title",
            systemImageName: "square.and.arrow.up"
        )
    }
}
