//
//  TriggerConfiguratorPage.swift
//  TeslaSync — P7 page · automations/TriggerConfigurator (Apple)
//
//  Native SwiftUI parity of `web/src/features/automations/pages/TriggerConfigurator.tsx` — the
//  composable automation trigger editor. As a self-contained screen it hosts the web component's
//  exported trigger-type picker (`TRIGGER_TYPES`) above the per-kind editor (web `switch (trigger.kind)`)
//  in a glass panel, bound to an `@Observable TriggerConfiguratorPageModel`. The one data source — the
//  web `useGeofences` query — is projected into loading / empty / error / success states inside the
//  geofence picker, so no region renders blank (HIG). Adaptive across macOS + iOS (ADR-002/006); every
//  literal resolves from `Localizable.xcstrings`.
//

import SwiftUI

/// The TriggerConfigurator screen (web `TriggerConfigurator`). State lives in
/// `TriggerConfiguratorPageModel`; the geofence source is supplied by the model's provider seam.
public struct TriggerConfiguratorPage: View {
    @State private var model: TriggerConfiguratorPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: TriggerConfiguratorPageModel = TriggerConfiguratorPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            content
                .frame(maxWidth: maxContentWidth, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("automations.builder.triggerTitle"))
        .task {
            if case .loading = model.geofenceState { await model.load() }
        }
        .refreshable { await model.refresh() }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    /// Constrains the form to a comfortable reading measure on wide macOS / iPad layouts while staying
    /// full-width on compact iPhone (ADR-002/006).
    private var maxContentWidth: CGFloat? {
        isCompact ? nil : 620
    }

    // MARK: - Content (type picker + per-kind editor)

    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            typePicker
            editorPanel
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    /// The web `TRIGGER_TYPES` host picker (exported from the same source). Reseeds a fresh default
    /// trigger of the chosen kind so every editor is reachable on the standalone screen.
    private var typePicker: some View {
        TriggerConfiguratorPagePicker(
            labelKey: "automations.builder.triggerType",
            labelFallback: "Trigger Type",
            options: TriggerTypeCatalog.all.map(\.option),
            selection: Binding(get: { model.trigger.kind }, set: { model.setTriggerKind($0) })
        )
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }

    private var editorPanel: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            editor
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement(children: .contain)
    }

    /// The per-kind editor (web `switch (trigger.kind)`).
    @ViewBuilder
    private var editor: some View {
        switch model.trigger {
        case let .schedule(cronExpr, timezone):
            TriggerConfiguratorPageScheduleEditor(model: model, cronExpr: cronExpr, timezone: timezone)
        case let .event(eventType):
            TriggerConfiguratorPageEventEditor(model: model, eventType: eventType)
        case let .geofence(placeID, event, dwellMinutes):
            TriggerConfiguratorPageGeofenceEditor(
                model: model,
                placeID: placeID,
                event: event,
                dwellMinutes: dwellMinutes
            )
        case let .signal(signalTrigger):
            TriggerConfiguratorPageSignalEditor(model: model, trigger: signalTrigger)
        }
    }
}

#if DEBUG
    #Preview("Schedule") {
        NavigationStack {
            TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(trigger: .createDefault(.schedule)))
        }
        .teslaSyncTheme()
    }

    #Preview("Event") {
        NavigationStack {
            TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(trigger: .createDefault(.event)))
        }
        .teslaSyncTheme()
    }

    #Preview("Geofence — success") {
        NavigationStack {
            TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(
                trigger: .createDefault(.geofence),
                geofenceProvider: DefaultTriggerConfiguratorGeofenceData()
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Geofence — empty") {
        NavigationStack {
            TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(
                trigger: .createDefault(.geofence),
                geofenceProvider: EmptyTriggerConfiguratorGeofenceData()
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Geofence — error") {
        NavigationStack {
            TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(
                trigger: .createDefault(.geofence),
                geofenceProvider: FailingTriggerConfiguratorGeofenceData()
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Signal") {
        NavigationStack {
            TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(trigger: .createDefault(.signal)))
        }
        .teslaSyncTheme()
    }
#endif
