#if os(iOS)
    import SwiftUI
    import WidgetKit

    /// The Live Activity widget extension entry point. Bundles the charging, drive,
    /// and command activities. Lives in its own iOS app-extension target
    /// (`TeslaSyncActivities`); the `ActivityAttributes` are shared with the app via
    /// file membership so the app's `LiveActivityController` and these UIs agree.
    @main
    struct TeslaSyncActivitiesBundle: WidgetBundle {
        var body: some Widget {
            ChargingLiveActivity()
            DriveLiveActivity()
            CommandLiveActivity()
        }
    }
#endif
