//
//  GeneralSettings.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The composed General Settings feature view — SwiftUI parity of
//  features/settings/components/GeneralSettings.tsx. Renders the units / language
//  / cost preferences editor: the header, the sync-from-car + car-clock panels,
//  the responsive field grid, and the save bar, wrapped by a freshness chip +
//  connectivity banner (ADR-013) and a draft-recovery banner. Binds through
//  `GeneralSettingsModel` (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content. Emits the P1/S11
//  `view.opened` diagnostics event on appear via the model.
//

import SwiftUI

/// The units / language / cost preferences editor — the SwiftUI parity of the web
/// `GeneralSettings`. A pure composition over `GeneralSettingsModel`: it owns no
/// data and performs no networking, mapping every web region to a native,
/// HIG-idiomatic counterpart and reproducing all of the source's render branches.
public struct GeneralSettings: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        GeneralSettingsModel.surfaceSlug
    }

    @State private var model: GeneralSettingsModel

    public init(model: GeneralSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            TSFadeIn(delay: 0.1) {
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                        SettingsHeader(
                            freshness: model.freshness,
                            updatedAt: model.updatedAt,
                            onRefresh: { model.refresh() }
                        )
                        if model.connection != .live {
                            SettingsConnectivityBanner(connection: model.connection)
                        }
                        if model.hasDraft {
                            SettingsDraftBanner(
                                savedAt: model.draftSavedAt,
                                onDiscard: { model.discardDraft() }
                            )
                        }
                        content
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg)
        .overlay(alignment: .top) {
            if let toast = model.toast {
                SettingsToastView(toast: toast) { model.dismissToast() }
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.top, TSSpacing.sm)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Surface content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SettingsLoadingChrome()
        case .empty:
            SettingsEmptyState(onRetry: { model.refresh() })
        case let .error(message):
            SettingsErrorState(message: message, onRetry: { model.refresh() })
        case .content:
            loadedForm
        }
    }

    private var loadedForm: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if let preferences = model.carPreferences, preferences.hasUnitInfo {
                SyncFromCarPanel(
                    preferences: preferences,
                    onSync: { model.syncUnitsFromCar() }
                )
            }
            if let preferences = model.carPreferences, let is24Hour = preferences.clock24Hour {
                CarClockPanel(is24Hour: is24Hour)
            }
            SettingsFormGrid(model: model)
            SettingsSaveBar(
                status: model.saveStatus,
                onSave: { model.save() }
            )
        }
    }
}

// MARK: - Field binding sugar (routes every edit through the model)

extension GeneralSettingsModel {
    /// A two-way binding to a form field that routes writes through `update(_:)`
    /// so the web `setForm` side effects (draft persistence + navigation guard)
    /// stay centralized. Keeps the SwiftUI `Binding` dependency out of the
    /// host-free model file.
    func binding<Value>(_ keyPath: WritableKeyPath<AppSettingsState, Value>) -> Binding<Value> {
        Binding(
            get: { self.form[keyPath: keyPath] },
            set: { newValue in self.update { $0[keyPath: keyPath] = newValue } }
        )
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension GeneralSettingsStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the
    /// resolved value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
