import SwiftUI

/// A self-contained demo of the push subsystem for SwiftUI previews and the
/// XCUITest path (`-uiTestPushDemo`). It drives the *real* `PushCoordinator` +
/// `LiveActivityController` (wired to in-memory fakes, no APNs/ActivityKit
/// runtime), so the permission flow, foreground banner + deep-link routing, device
/// registration, settings, and Live Activities are all exercised end to end.
public struct PushDemoView: View {
    @State private var coordinator: PushCoordinator
    @State private var activities: LiveActivityController

    public init() {
        _coordinator = State(initialValue: PushCoordinator.demo())
        _activities = State(initialValue: LiveActivityController(presenter: PreviewLiveActivityPresenter()))
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    statusRow
                    if let banner = coordinator.foregroundBanner {
                        PushBannerView(
                            notification: banner,
                            onOpen: { coordinator.openBanner() },
                            onDismiss: { coordinator.dismissBanner() }
                        )
                    }
                    routeRow
                    controls
                    activityControls
                    NavigationLink {
                        PushSettingsView(coordinator: coordinator)
                    } label: {
                        Label("push.demo.openSettings", systemImage: "gearshape")
                    }
                    .accessibilityIdentifier("push.demo.openSettings")
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("push.demo.title")
        }
    }

    private var statusRow: some View {
        HStack {
            TSText("push.settings.status")
            Spacer()
            Text(verbatim: coordinator.authorizationStatus.rawValue)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityIdentifier("push.demo.status")
            if coordinator.isRegistered {
                TSBadge("push.demo.registered", tone: .success)
                    .accessibilityIdentifier("push.demo.registered")
            }
        }
    }

    @ViewBuilder private var routeRow: some View {
        if let route = coordinator.pendingRoute {
            HStack {
                TSCaption("push.demo.routed")
                Text(verbatim: route.rawValue)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityIdentifier("push.demo.route")
            }
        }
    }

    private var controls: some View {
        VStack(spacing: TSSpacing.sm) {
            TSButton("push.demo.requestAuth") {
                Task { await coordinator.requestAuthorization() }
            }
            .accessibilityIdentifier("push.demo.requestAuth")

            TSButton("push.demo.registerToken", variant: .secondary) {
                Task { await coordinator.didRegister(tokenData: Data([0xDE, 0xAD, 0xBE, 0xEF])) }
            }
            .accessibilityIdentifier("push.demo.registerToken")

            TSButton("push.demo.simulateCharging", variant: .secondary) {
                coordinator.foregroundPresentation(for: DemoPushSamples.charging())
            }
            .accessibilityIdentifier("push.demo.simulateCharging")

            TSButton("push.demo.simulateCommandTap", variant: .secondary) {
                coordinator.handleTap(userInfo: DemoPushSamples.command())
            }
            .accessibilityIdentifier("push.demo.simulateCommandTap")
        }
    }

    private var activityControls: some View {
        VStack(spacing: TSSpacing.sm) {
            HStack {
                TSText("push.demo.liveActivity")
                Spacer()
                if activities.activeKinds.contains(.charging) {
                    TSBadge("push.demo.activityActive", tone: .accent)
                        .accessibilityIdentifier("push.demo.activityActive")
                }
            }
            TSButton("push.demo.startActivity", variant: .secondary) {
                Task {
                    await activities.startCharging(
                        vehicleName: "Model 3",
                        state: .init(batteryLevel: 0.62, chargeLimit: 0.8, powerW: 11000)
                    )
                }
            }
            .accessibilityIdentifier("push.demo.startActivity")
            TSButton("push.demo.endActivity", variant: .destructive) {
                Task { await activities.endCharging() }
            }
            .accessibilityIdentifier("push.demo.endActivity")
        }
    }
}

#if DEBUG
    #Preview("Push demo") {
        PushDemoView()
            .teslaSyncTheme()
    }
#endif
