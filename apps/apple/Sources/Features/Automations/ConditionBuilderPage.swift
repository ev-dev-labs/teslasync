//
//  ConditionBuilderPage.swift
//  TeslaSync — P7 page · automations/ConditionBuilder (Apple)
//
//  Native SwiftUI parity of `web/src/features/automations/pages/ConditionBuilder.tsx` — the
//  composable automation condition editor. Renders the ordered list of condition cards (each a glass
//  panel with a condition-type select, the kind-specific fields, and a remove control) above the
//  "Add Condition" button, exactly like the web component, but as a self-contained screen bound to an
//  `@Observable ConditionBuilderPageModel`. The single data source (web `useGeofences`) is bound
//  through the reused `GeofenceOptionsModel`, and its loading / empty / error / offline branches
//  render inside the geofence picker. Implements every page state — loading (redacted skeleton),
//  empty (`ContentUnavailableView`), and success (the card list) — so no region renders blank.
//  Adaptive across macOS + iOS (ADR-002/006); every literal resolves from `Localizable.xcstrings`.
//

import SwiftUI

/// The ConditionBuilder screen (web `ConditionBuilder`). State lives in `ConditionBuilderPageModel`.
public struct ConditionBuilderPage: View {
    @State private var model: ConditionBuilderPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: ConditionBuilderPageModel = ConditionBuilderPageModel()) {
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
        .navigationTitle(Text("automations.builder.conditionsTitle"))
        .task {
            if case .loading = model.state { await model.load() }
        }
        .refreshable { await model.refresh() }
        .onDisappear { model.stop() }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    /// Constrains the form to a comfortable reading measure on wide macOS / iPad layouts while
    /// staying full-width on compact iPhone (ADR-002/006).
    private var maxContentWidth: CGFloat? {
        isCompact ? nil : 820
    }

    // MARK: - State switch (web loading / content, plus the no-conditions empty state)

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ConditionBuilderPageSkeleton()
        case .empty:
            emptyState
        case .success:
            cardList
        }
    }

    private var cardList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(Array(model.conditions.enumerated()), id: \.element.id) { item in
                ConditionBuilderPageCard(model: model, row: item.element, index: item.offset)
            }
            addButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var emptyState: some View {
        TSEmptyState(
            title: "automations.builder.conditionsEmptyTitle",
            message: "automations.builder.conditionsEmptyMessage",
            systemImage: "line.3.horizontal.decrease.circle"
        ) {
            addButton
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }

    private var addButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.addCondition() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .semibold))
                        .accessibilityHidden(true)
                    Text("automations.builder.addCondition")
                }
            }
        )
        .accessibilityLabel(Text("automations.builder.addCondition"))
    }
}

// MARK: - Loading skeleton (web redacted loading state)

/// The page loading state — redacted condition-card skeletons (HIG `redacted`-style), never a blank
/// region.
struct ConditionBuilderPageSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                TSSkeleton(height: 120, cornerRadius: TSRadius.lg)
            }
            TSSkeleton(width: 140, height: 32, cornerRadius: TSRadius.md)
        }
        .accessibilityLabel(Text("automations.builder.conditionsTitle"))
    }
}

#if DEBUG
    #Preview("Populated") {
        NavigationStack {
            ConditionBuilderPage(model: ConditionBuilderPageModel(provider: DefaultConditionBuilderPageData()))
        }
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            ConditionBuilderPage(model: ConditionBuilderPageModel(provider: EmptyConditionBuilderPageData()))
        }
        .teslaSyncTheme()
    }

    #Preview("Geofences loading") {
        NavigationStack {
            ConditionBuilderPage(model: ConditionBuilderPageModel(
                provider: GeofenceConditionOnlyPreviewData(),
                geofences: GeofenceOptionsModel(previewState: .loading(cached: nil, stale: false))
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Geofences error") {
        NavigationStack {
            ConditionBuilderPage(model: ConditionBuilderPageModel(
                provider: GeofenceConditionOnlyPreviewData(),
                geofences: GeofenceOptionsModel(previewState: .failed(
                    .network(message: "timeout"),
                    cached: nil,
                    stale: false
                ))
            ))
        }
        .teslaSyncTheme()
    }

    /// A single geofence condition so the multi-state geofence picker is on screen for the preview.
    private struct GeofenceConditionOnlyPreviewData: ConditionBuilderPageProviding {
        func load() async -> [ConditionBody] {
            [.geofence(GeofenceCondition(placeId: 0, state: .inside))]
        }
    }
#endif
