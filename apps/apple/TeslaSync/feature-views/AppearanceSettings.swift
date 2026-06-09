//
//  AppearanceSettings.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The composed Appearance Settings feature view — SwiftUI parity of
//  features/settings/components/AppearanceSettings.tsx. Renders the theme picker,
//  the information-density selector + live preview, the sidebar-style selector, the
//  default-time-format + chart-palette selectors, the footer status-bar toggles,
//  the achievement-celebration toggles, and the product-tour controls, wrapped by a
//  freshness chip + connectivity banner (ADR-013). Binds through
//  `AppearanceSettingsModel` (no networking / no device storage in the view) and
//  renders every state: loading / empty / error / stale / offline / content. Emits
//  the P1/S11 `view.opened` diagnostics event on appear via the model.
//

import SwiftUI

/// The display + appearance preferences editor — the SwiftUI parity of the web
/// `AppearanceSettings`. A pure composition over `AppearanceSettingsModel`: it owns
/// no data and performs no networking, mapping every web region to a native,
/// HIG-idiomatic counterpart and reproducing all of the source's render branches.
public struct AppearanceSettings: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AppearanceSettingsModel.surfaceSlug
    }

    @State private var model: AppearanceSettingsModel

    public init(model: AppearanceSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            TSFadeIn(delay: 0.15) {
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                        AppearanceSettingsHeader(
                            freshness: model.freshness,
                            updatedAt: model.updatedAt,
                            onRefresh: { model.refresh() }
                        )
                        if model.connection != .live {
                            AppearanceConnectivityBanner(connection: model.connection)
                        }
                        sections
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
                AppearanceToastView(toast: toast) { model.dismissToast() }
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

    // MARK: - Composed sections (web top-to-bottom order)

    @ViewBuilder
    private var sections: some View {
        AppearanceThemeSection(
            mode: model.theme.mode,
            accentID: model.theme.accentID,
            onSelectMode: { model.setThemeMode($0) },
            onSelectAccent: { model.setAccent($0) }
        )
        AppearanceDensitySection(
            density: model.preferences.density,
            isLoaded: model.isSettingsLoaded,
            isSaving: model.savingField == .density,
            phase: model.phase,
            onSelect: { model.setDensity($0) },
            onRetry: { model.refresh() }
        )
        AppearanceSidebarSection(
            style: model.sidebarStyle,
            onSelect: { model.setSidebarStyle($0) }
        )
        AppearanceTimeFormatSection(
            timeFormat: model.preferences.timeFormat,
            isLoaded: model.isSettingsLoaded,
            isSaving: model.savingField == .timeFormat,
            phase: model.phase,
            onSelect: { model.setTimeFormat($0) },
            onRetry: { model.refresh() }
        )
        AppearanceChartPaletteSection(
            palette: model.preferences.chartPalette,
            isLoaded: model.isSettingsLoaded,
            isSaving: model.savingField == .chartPalette,
            phase: model.phase,
            onSelect: { model.setChartPalette($0) },
            onRetry: { model.refresh() }
        )
        AppearanceStatusBarPanel(
            prefs: model.statusBar,
            onSetEnabled: { model.setStatusBarEnabled($0) },
            onSetIconOnly: { model.setStatusBarIconOnly($0) }
        )
        AppearanceCelebrationPanel(
            prefs: model.celebration,
            onChange: { keyPath, value in
                model.updateCelebration { $0[keyPath: keyPath] = value }
            }
        )
        AppearanceProductToursPanel(
            onStartTour: { model.startTour($0) },
            onResetTours: { model.resetTours() }
        )
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension AppearanceSettingsStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the
    /// resolved value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
