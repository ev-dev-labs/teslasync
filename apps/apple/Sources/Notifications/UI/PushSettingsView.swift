import SwiftUI

/// The notification-settings screen: authorization state + enable affordance,
/// per-category toggles, alert channels (sound/badge/critical), the quiet-hours
/// window, and localized privacy copy. Binds to the coordinator's shared
/// `PushSettingsModel`; every label is localized (ADR-014). Renders the same on
/// iOS and macOS.
public struct PushSettingsView: View {
    private let coordinator: PushCoordinator

    public init(coordinator: PushCoordinator) {
        self.coordinator = coordinator
    }

    private var model: PushSettingsModel {
        coordinator.settingsModel
    }

    public var body: some View {
        Form {
            authorizationSection
            categoriesSection
            channelsSection
            quietHoursSection
            privacySection
        }
        .navigationTitle("push.settings.title")
        .task { await coordinator.refreshAuthorizationStatus() }
    }

    // MARK: - Sections

    private var authorizationSection: some View {
        Section {
            HStack {
                TSText("push.settings.status")
                Spacer()
                TSBadge(Self.statusKey(model.authorizationStatus), tone: Self.statusTone(model.authorizationStatus))
                    .accessibilityIdentifier("push.settings.status")
            }
            if model.authorizationStatus.canPrompt {
                TSButton("push.settings.enable") {
                    Task { await coordinator.requestAuthorization() }
                }
                .accessibilityIdentifier("push.settings.enable")
            } else if model.authorizationStatus == .denied {
                TSHelperText("push.settings.deniedHelp")
            }
        } header: {
            Text("push.settings.section.permission")
        }
    }

    private var categoriesSection: some View {
        Section {
            ForEach(PushCategory.allCases) { category in
                TSToggle(category.titleKey, isOn: categoryBinding(category))
                    .accessibilityIdentifier("push.settings.category.\(category.rawValue)")
            }
        } header: {
            Text("push.settings.section.categories")
        } footer: {
            TSHelperText("push.settings.categoriesHelp")
        }
    }

    private var channelsSection: some View {
        Section {
            TSToggle("push.settings.sound", isOn: boolBinding(\.soundEnabled) { model.setSoundEnabled($0) })
            TSToggle("push.settings.badge", isOn: boolBinding(\.badgeEnabled) { model.setBadgeEnabled($0) })
            TSToggle("push.settings.critical", isOn: criticalBinding)
                .accessibilityIdentifier("push.settings.critical")
        } header: {
            Text("push.settings.section.channels")
        } footer: {
            TSHelperText("push.settings.criticalHelp")
        }
    }

    private var quietHoursSection: some View {
        Section {
            TSToggle("push.settings.quietHours", isOn: quietEnabledBinding)
                .accessibilityIdentifier("push.settings.quietHours")
            if model.settings.quietHours.isEnabled {
                DatePicker(
                    "push.settings.quietStart",
                    selection: timeBinding(model.settings.quietHours.start) { model.setQuietHoursStart(
                        hour: $0,
                        minute: $1
                    ) },
                    displayedComponents: .hourAndMinute
                )
                DatePicker(
                    "push.settings.quietEnd",
                    selection: timeBinding(model.settings.quietHours.end) {
                        model.setQuietHoursEnd(hour: $0, minute: $1)
                    },
                    displayedComponents: .hourAndMinute
                )
            }
        } header: {
            Text("push.settings.section.quietHours")
        } footer: {
            TSHelperText("push.settings.quietHelp")
        }
    }

    private var privacySection: some View {
        Section {
            TSHelperText("push.settings.privacy")
        } header: {
            Text("push.settings.section.privacy")
        }
    }

    // MARK: - Bindings

    private func categoryBinding(_ category: PushCategory) -> Binding<Bool> {
        Binding(
            get: { model.settings.isEnabled(category) },
            set: { model.setCategory(category, enabled: $0) }
        )
    }

    private func boolBinding(_ keyPath: KeyPath<PushSettings, Bool>, set: @escaping (Bool) -> Void) -> Binding<Bool> {
        Binding(get: { model.settings[keyPath: keyPath] }, set: set)
    }

    private var criticalBinding: Binding<Bool> {
        Binding(
            get: { model.settings.criticalAlertsEnabled },
            set: { enabled in Task { await coordinator.setCriticalAlertsEnabled(enabled) } }
        )
    }

    private var quietEnabledBinding: Binding<Bool> {
        Binding(
            get: { model.settings.quietHours.isEnabled },
            set: { model.setQuietHoursEnabled($0) }
        )
    }

    private func timeBinding(_ time: (hour: Int, minute: Int), set: @escaping (Int, Int) -> Void) -> Binding<Date> {
        Binding(
            get: {
                var components = DateComponents()
                components.hour = time.hour
                components.minute = time.minute
                return Calendar.current.date(from: components) ?? Date()
            },
            set: { date in
                let components = Calendar.current.dateComponents([.hour, .minute], from: date)
                set(components.hour ?? 0, components.minute ?? 0)
            }
        )
    }

    // MARK: - Status presentation

    static func statusKey(_ status: PushAuthorizationStatus) -> LocalizedStringKey {
        switch status {
        case .authorized: "push.status.authorized"
        case .provisional: "push.status.provisional"
        case .ephemeral: "push.status.ephemeral"
        case .denied: "push.status.denied"
        case .notDetermined: "push.status.notDetermined"
        }
    }

    static func statusTone(_ status: PushAuthorizationStatus) -> TSTone {
        switch status {
        case .authorized, .provisional, .ephemeral: .success
        case .denied: .danger
        case .notDetermined: .neutral
        }
    }
}
