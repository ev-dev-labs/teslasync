//
//  ActionBuilderPage.swift
//  TeslaSync — P7 page · automations/ActionBuilder (Apple)
//
//  Native SwiftUI parity of `web/src/features/automations/pages/ActionBuilder.tsx` — the
//  composable automation action editor. Renders the ordered list of action cards (each a glass
//  panel with a numbered type select, the kind-specific fields, and move/remove controls) above
//  the "Add Action" button, exactly like the web component, but as a self-contained screen bound
//  to an `@Observable ActionBuilderPageModel` (no networking; the manifest's "navigation values /
//  local state"). Implements every data state — loading (redacted skeleton), empty
//  (`ContentUnavailableView`), success (the card list), and error (the web command-params JSON
//  validation error shown inline) — so no region renders blank. Adaptive across macOS + iOS
//  (ADR-002/006); every literal resolves from `Localizable.xcstrings`.
//

import SwiftUI

/// The ActionBuilder screen (web `ActionBuilder`). State lives in `ActionBuilderPageModel`.
public struct ActionBuilderPage: View {
    @State private var model: ActionBuilderPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: ActionBuilderPageModel = ActionBuilderPageModel()) {
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
        .navigationTitle(Text("automations.builder.actionsTitle"))
        .task {
            if case .loading = model.state { await model.load() }
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

    /// Constrains the form to a comfortable reading measure on wide macOS / iPad layouts while
    /// staying full-width on compact iPhone (ADR-002/006).
    private var maxContentWidth: CGFloat? {
        isCompact ? nil : 760
    }

    // MARK: - State switch (web loading / content, plus the params error surface)

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ActionBuilderPageSkeleton()
        case .empty:
            emptyState
        case .success, .error:
            cardList
        }
    }

    private var cardList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(Array(model.rows.enumerated()), id: \.element.id) { item in
                ActionBuilderPageCard(model: model, row: item.element, index: item.offset)
            }
            addButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var emptyState: some View {
        TSEmptyState(
            title: "automations.builder.emptyTitle",
            message: "automations.builder.emptyMessage",
            systemImage: "bolt.badge.automatic"
        ) {
            addButton
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }

    private var addButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.addAction() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .semibold))
                        .accessibilityHidden(true)
                    Text("automations.builder.addAction")
                }
            }
        )
        .accessibilityLabel(Text("automations.builder.addAction"))
    }
}

// MARK: - Loading skeleton (web redacted loading state)

/// The page loading state — redacted action-card skeletons (HIG `redacted`-style),
/// never a blank region.
struct ActionBuilderPageSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                TSSkeleton(height: 132, cornerRadius: TSRadius.lg)
            }
            TSSkeleton(width: 130, height: 32, cornerRadius: TSRadius.md)
        }
        .accessibilityLabel(Text("automations.builder.actionsTitle"))
    }
}

#if DEBUG
    #Preview("Populated") {
        NavigationStack {
            ActionBuilderPage(model: ActionBuilderPageModel(provider: DefaultActionBuilderPageData()))
        }
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            ActionBuilderPage(model: ActionBuilderPageModel(provider: EmptyActionBuilderPageData()))
        }
        .teslaSyncTheme()
    }

    #Preview("Invalid params (error)") {
        NavigationStack {
            ActionBuilderPageErrorPreview()
        }
        .teslaSyncTheme()
    }

    /// Drives the page into the `error` data state by seeding a command action and committing an
    /// invalid command-params edit through the model's public API.
    private struct ActionBuilderPageErrorPreview: View {
        @State private var model = ActionBuilderPageModel(provider: DefaultActionBuilderPageData())

        var body: some View {
            ActionBuilderPage(model: model)
                .task {
                    await model.load()
                    if let first = model.rows.first(where: { $0.action.kind == .command }) {
                        model.updateParams(id: first.id, text: "{ not valid json")
                    }
                }
        }
    }
#endif
