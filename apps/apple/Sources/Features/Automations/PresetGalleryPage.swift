import SwiftUI

/// Native SwiftUI parity of `web/src/features/automations/pages/PresetGallery.tsx` — the automation
/// preset-template gallery. Reproduces the web responsive card grid: a loading state (a grid of
/// skeleton cards), a no-data empty state (clock glyph + message), and the populated success state
/// (a fade-in, index-staggered grid of preset cards). The web source is `(unrouted)` — it is the
/// card grid the `/automations` preset disclosure renders inline — so this is exposed as a
/// deep-linkable screen rather than a top-level route (`PresetGalleryRouteRegistration`).
///
/// Adaptive (ADR-002/006): the grid uses an adaptive column track so iPhone-compact shows one
/// column while iPad / macOS show several (the web `sm:2 / lg:3 / xl:4` breakpoints). Data binds
/// through the `@Observable` `PresetGalleryModel` (no networking in the view, ADR-004); every
/// visible string resolves from `Localizable.xcstrings` with the web key names; the Install action
/// is the injected `onInstall` shell hook (web navigates to the typed builder pre-filled).
public struct PresetGalleryPage: View {
    @State private var model: PresetGalleryModel
    private let onInstall: (PresetGalleryItem) -> Void

    /// Number of skeleton cards shown while loading (web `Array.from({ length: 4 })`).
    private static let skeletonCount = 4

    public init(
        model: PresetGalleryModel = PresetGalleryModel(),
        onInstall: @escaping (PresetGalleryItem) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onInstall = onInstall
    }

    public var body: some View {
        ScrollView {
            content
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle("automations.presets.title")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.phase, model.presets.isEmpty else { return }
                await model.load()
            }
    }

    // MARK: - State switch (web isLoading / empty / cards)

    @ViewBuilder private var content: some View {
        switch model.galleryState {
        case .loading:
            loadingGrid
        case .empty:
            emptyState
        case .success:
            successGrid
        case .error:
            errorView
        }
    }

    // MARK: - Grid track (web grid-cols-1 / sm:2 / lg:3 / xl:4)

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 260, maximum: .infinity), spacing: TSSpacing.md, alignment: .top)]
    }

    // MARK: - Loading (web 4 PresetCardSkeleton)

    private var loadingGrid: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< Self.skeletonCount, id: \.self) { _ in
                PresetGalleryCardSkeleton()
            }
        }
        .accessibilityLabel(Text("automations.presets.title"))
    }

    // MARK: - Empty (web EmptyState clock + presets.empty)

    private var emptyState: some View {
        TSEmptyState(title: "automations.presets.empty", systemImage: "clock")
            .frame(maxWidth: .infinity, minHeight: 240)
    }

    // MARK: - Success (web FadeIn + StaggerContainer of PresetCard)

    private var successGrid: some View {
        TSFadeIn {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(Array(model.presets.enumerated()), id: \.element.id) { index, preset in
                    TSStaggerItem(index: index) {
                        PresetGalleryCard(preset: preset) { onInstall(preset) }
                    }
                }
            }
        }
    }

    // MARK: - Error (ADR-013 — retryable, never a blank gallery)

    private var errorView: some View {
        TSGlassPanel {
            TSQueryError { Task { await model.refresh() } }
        }
        .frame(maxWidth: .infinity)
    }
}

#if DEBUG
    #Preview("Populated") {
        NavigationStack {
            PresetGalleryPage(model: PresetGalleryModel())
        }
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            PresetGalleryPage(model: PresetGalleryModel(dataSource: EmptyPresetGalleryDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            PresetGalleryPage(model: PresetGalleryModel(dataSource: FailingPresetGalleryDataSource()))
        }
        .teslaSyncTheme()
    }
#endif
