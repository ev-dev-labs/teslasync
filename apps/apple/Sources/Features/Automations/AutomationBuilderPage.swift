import SwiftUI

/// Native SwiftUI parity of `web/src/features/automations/pages/AutomationBuilderPage.tsx`
/// (routes `/automations/new`, `/automations/:id/edit`, `?preset=`). Reproduces the web
/// `PageContainer` chrome (title + subtitle + breadcrumb + back action), every page data state
/// (loading skeleton / retryable error / "not found" empty / the form), and the typed builder
/// form: the General fields, the When trigger type + configurator panel, the Only-If conditions,
/// the Then actions, the conflict warnings, the save-error banner, the Save / Test Run / Cancel
/// bar, and the preset-hint panel. Adaptive (ADR-002/006); all copy resolves from
/// `Localizable.xcstrings`; data binds through the `@Observable` `AutomationBuilderPageModel`
/// (no networking in the view, ADR-004); the trigger / condition / action editors compose the
/// sibling parity surfaces.
public struct AutomationBuilderPage: View {
    @State private var model: AutomationBuilderPageModel
    @State private var didLoad = false
    @State private var confirmingDiscard = false
    private let onClose: () -> Void

    public init(model: AutomationBuilderPageModel, onClose: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(model.pageTitleKey)
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task { await loadOnce() }
            .confirmationDialog(
                "forms.unsavedAutomation",
                isPresented: $confirmingDiscard,
                titleVisibility: .visible
            ) {
                Button("forms.discard", role: .destructive, action: onClose)
                Button("forms.keepEditing", role: .cancel) {}
            }
    }

    // MARK: - Header (web back action + title + breadcrumb + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSButton(variant: .ghost, size: .small, action: handleBack) {
                Label("automations.builder.backToList", systemImage: "chevron.left")
            }
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle(model.headerTitleKey)
                if let breadcrumb = model.editBreadcrumb {
                    Text(verbatim: breadcrumb)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                Text("automations.builder.subtitle")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Phase switch (web loading / error / not-found / content)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingState
        case let .error(message):
            errorState(message)
        case .notFound:
            notFoundState
        case .ready:
            AutomationBuilderFormView(model: model, onClose: onClose, onCancel: handleBack)
        }
    }

    /// Web `PageContainer loading` skeleton.
    private var loadingState: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 180, height: 18)
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 48, cornerRadius: TSRadius.md)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(model.headerTitleKey))
    }

    /// Web `PageContainer error` — a retryable failure region (never blank, ADR-013).
    private func errorState(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                TSErrorDisplay(onRetry: { Task { await model.load() } })
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }

    /// Web edit-mode "Automation not found" empty state.
    private var notFoundState: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "automations.builder.notFound",
                systemImage: "exclamationmark.triangle"
            )
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Behavior

    private func loadOnce() async {
        guard !didLoad else { return }
        didLoad = true
        await model.load()
    }

    /// Web `handleBackToList` — prompt before leaving when the form is dirty, else leave.
    private func handleBack() {
        if model.dirty {
            confirmingDiscard = true
        } else {
            onClose()
        }
    }
}

#if DEBUG
    @MainActor
    private func builderModel(
        _ mode: AutomationBuilderMode,
        _ source: any AutomationBuilderDataSource = SampleAutomationBuilderDataSource(),
        hasDraft: Bool = false,
        hasEditConflict: Bool = false
    ) -> AutomationBuilderPageModel {
        AutomationBuilderPageModel(
            mode: mode,
            dataSource: source,
            hasDraft: hasDraft,
            hasEditConflict: hasEditConflict
        )
    }

    #Preview("Create") {
        NavigationStack { AutomationBuilderPage(model: builderModel(.create)) }
            .teslaSyncTheme()
    }

    #Preview("Edit") {
        NavigationStack { AutomationBuilderPage(model: builderModel(.edit(42))) }
            .teslaSyncTheme()
    }

    #Preview("Preset + draft + conflict") {
        NavigationStack {
            AutomationBuilderPage(model: builderModel(.preset("p1"), hasDraft: true, hasEditConflict: true))
        }
        .teslaSyncTheme()
    }

    #Preview("Not found") {
        NavigationStack {
            AutomationBuilderPage(model: builderModel(.edit(99), EmptyAutomationBuilderDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            AutomationBuilderPage(model: builderModel(.edit(99), FailingAutomationBuilderDataSource()))
        }
        .teslaSyncTheme()
    }
#endif
