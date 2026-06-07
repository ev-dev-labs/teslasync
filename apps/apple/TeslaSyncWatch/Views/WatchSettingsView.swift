import SwiftUI

/// The watch Settings surface, aligned with watch HIG (a single Digital-Crown
/// `List`). Core preferences mirror the iPhone (units, notifications, app-lock,
/// offline cache) and are clearly marked as synced from there — the phone stays the
/// single source of truth. Watch-local controls cover refreshing and clearing the
/// on-wrist cache, and a diagnostics section reports the honest sync state.
struct WatchSettingsView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        List {
            Section {
                settingRow(titleKey: "watch.settings.units", value: Text(LocalizedStringKey(unitsKey)))
                settingRow(titleKey: "watch.settings.notifications", value: onOff(model.settings.notificationsEnabled))
                settingRow(titleKey: "watch.settings.appLock", value: onOff(model.settings.appLockEnabled))
                settingRow(titleKey: "watch.settings.offlineCache", value: onOff(model.settings.offlineCacheEnabled))
            } header: {
                Text("watch.settings.preferences")
            } footer: {
                Text("watch.settings.syncedFooter")
                    .font(Font.TS.caption)
            }

            Section("watch.settings.data") {
                Button {
                    model.requestRefresh()
                } label: {
                    Label("watch.action.refresh", systemImage: "arrow.clockwise")
                }
                Button(role: .destructive) {
                    model.clearCache()
                } label: {
                    Label("watch.settings.clearCache", systemImage: "trash")
                }
            }

            Section("watch.settings.diagnostics") {
                diagnosticsRow(titleKey: "watch.settings.connection", value: reachabilityText)
                if let lastUpdated = model.lastUpdated {
                    LabeledContent {
                        Text(lastUpdated, style: .relative)
                    } label: {
                        Text("watch.settings.lastSync")
                    }
                    .font(Font.TS.caption)
                }
                diagnosticsRow(titleKey: "watch.settings.version", value: Text(verbatim: appVersion))
                diagnosticsRow(
                    titleKey: "watch.settings.schema",
                    value: Text(verbatim: "\(WatchSyncPayload.currentSchemaVersion)")
                )
            }
        }
        .navigationTitle("watch.settings.title")
    }

    private var unitsKey: String {
        model.settings.measurementSystem.titleKey
    }

    private func onOff(_ value: Bool) -> Text {
        Text(value ? "watch.status.on" : "watch.status.off")
    }

    private var reachabilityText: Text {
        Text(model.isReachable ? "watch.settings.connected" : "watch.settings.disconnected")
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return version ?? "1.0.0"
    }

    private func settingRow(titleKey: LocalizedStringKey, value: Text) -> some View {
        LabeledContent {
            value.foregroundStyle(Color.TS.textSecondary)
        } label: {
            Text(titleKey)
        }
    }

    private func diagnosticsRow(titleKey: LocalizedStringKey, value: Text) -> some View {
        LabeledContent {
            value.foregroundStyle(Color.TS.textMuted)
        } label: {
            Text(titleKey)
        }
        .font(Font.TS.caption)
    }
}
