import SwiftUI

#if os(macOS)
    /// The macOS `Settings` scene (⌘,) hosting the native settings surface. Added to
    /// the app's `Scene` body so TeslaSync gets a real Preferences window.
    public struct TeslaSyncSettingsScene: Scene {
        private let model: AppSettingsModel
        private let onOpenNotifications: (() -> Void)?

        public init(model: AppSettingsModel, onOpenNotifications: (() -> Void)? = nil) {
            self.model = model
            self.onOpenNotifications = onOpenNotifications
        }

        public var body: some Scene {
            Settings {
                AppSettingsView(model: model, onOpenNotifications: onOpenNotifications)
                    .teslaSyncTheme()
                    .frame(minWidth: 480, minHeight: 560)
            }
        }
    }
#endif

/// Registers the native Settings surface for the `.settings` route so the existing
/// iOS/iPad Settings navigation item renders it through the shell's route host —
/// platform settings integration without duplicating the page.
public enum SettingsRouteRegistration {
    @MainActor
    public static func registry(
        model: AppSettingsModel,
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        onOpenNotifications: (() -> Void)? = nil
    ) -> AppRouteHostRegistry {
        var registry = base
        registry.register(.settings) {
            AppSettingsView(model: model, onOpenNotifications: onOpenNotifications)
        }
        return registry
    }
}
