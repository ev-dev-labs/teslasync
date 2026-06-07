import SwiftUI

/// The native Settings surface: Appearance, Units, Notifications, Privacy,
/// Security, Cache & Offline, and Developer Diagnostics. Every control binds to
/// `AppSettingsModel`, which persists through the shared settings store — no
/// business logic lives in the view.
public struct AppSettingsView: View {
    @Bindable private var model: AppSettingsModel
    private let appVersion: String
    private let onOpenNotifications: (() -> Void)?
    private let onExportDiagnostics: (() -> Void)?

    public init(
        model: AppSettingsModel,
        appVersion: String = AppSettingsView.bundleVersion(),
        onOpenNotifications: (() -> Void)? = nil,
        onExportDiagnostics: (() -> Void)? = nil
    ) {
        self.model = model
        self.appVersion = appVersion
        self.onOpenNotifications = onOpenNotifications
        self.onExportDiagnostics = onExportDiagnostics
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                appearanceSection
                unitsSection
                notificationsSection
                privacySection
                securitySection
                cacheSection
                diagnosticsSection
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg)
        .navigationTitle("settings.title")
    }

    // MARK: - Sections

    private var appearanceSection: some View {
        panel("settings.section.appearance") {
            TSFormField("settings.appearance.label") {
                TSThemePicker(selection: binding(\.appearance, model.setAppearance))
            }
        }
    }

    private var unitsSection: some View {
        panel("settings.section.units") {
            TSFormField("settings.units.label") {
                TSSelect(
                    selection: binding(\.measurementSystem, model.setMeasurementSystem),
                    options: MeasurementSystem.allCases.map {
                        TSSelectOption($0, LocalizedStringKey($0.titleKey))
                    }
                )
            }
            TSHelperText("settings.units.help")
        }
    }

    private var notificationsSection: some View {
        panel("settings.section.notifications") {
            TSToggle(
                "settings.notifications.enabled",
                isOn: binding(\.notificationsEnabled, model.setNotificationsEnabled)
            )
            if let onOpenNotifications {
                TSButton(
                    "settings.notifications.manage",
                    variant: .secondary,
                    size: .small,
                    action: onOpenNotifications
                )
            }
            TSHelperText("settings.notifications.help")
        }
    }

    private var privacySection: some View {
        panel("settings.section.privacy") {
            TSToggle("settings.privacy.analytics", isOn: binding(\.analyticsOptIn, model.setAnalyticsOptIn))
            TSToggle("settings.privacy.recents", isOn: binding(\.recordRecentActivity, model.setRecordRecentActivity))
            TSToggle(
                "settings.privacy.spotlight",
                isOn: binding(\.spotlightIndexingEnabled, model.setSpotlightIndexing)
            )
            TSToggle("settings.privacy.handoff", isOn: binding(\.handoffEnabled, model.setHandoff))
            TSHelperText("settings.privacy.help")
        }
    }

    private var securitySection: some View {
        panel("settings.section.security") {
            TSToggle("settings.security.biometric", isOn: binding(\.biometricUnlockEnabled, model.setBiometricUnlock))
                .disabled(!model.isBiometricAvailable)
            if !model.isBiometricAvailable {
                TSHelperText("settings.security.biometricUnavailable")
            }
        }
    }

    private var cacheSection: some View {
        panel("settings.section.cache") {
            TSToggle("settings.cache.offline", isOn: binding(\.offlineCacheEnabled, model.setOfflineCache))
            TSButton("settings.cache.clear", variant: .secondary, size: .small) {
                model.clearCache()
            }
            TSHelperText("settings.cache.help")
        }
    }

    private var diagnosticsSection: some View {
        panel("settings.section.diagnostics") {
            TSToggle(
                "settings.diagnostics.verbose",
                isOn: binding(\.diagnosticsVerboseLogging, model.setDiagnosticsVerboseLogging)
            )
            HStack(spacing: TSSpacing.sm) {
                TSMetricLabel("settings.diagnostics.version")
                TSCode(appVersion)
            }
            if let onExportDiagnostics {
                TSButton("settings.diagnostics.export", variant: .ghost, size: .small, action: onExportDiagnostics)
            }
        }
    }

    // MARK: - Helpers

    private func panel(_ title: LocalizedStringKey, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        TSGlassPanel {
            TSFormSection(title) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    content()
                }
            }
        }
    }

    private func binding<Value>(
        _ keyPath: KeyPath<AppSettings, Value>,
        _ setter: @escaping (Value) -> Void
    ) -> Binding<Value> {
        Binding(get: { model.settings[keyPath: keyPath] }, set: setter)
    }

    /// The marketing version + build number from the bundle, for the diagnostics row.
    public static func bundleVersion(bundle: Bundle = .main) -> String {
        let short = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(short) (\(build))"
    }
}
