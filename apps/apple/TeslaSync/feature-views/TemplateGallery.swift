//
//  TemplateGallery.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  Native, Apple-idiomatic parity of the web `TemplateGallery`
//  (features/dashboard/components/TemplateGallery.tsx).
//
//  A modal surface that swaps in place between a *gallery* — a "Blank" card plus
//  one card per preset, laid out in a fade-in stagger — and a *detail* view for
//  the selected preset, with a dynamic title and a close affordance. It binds a
//  bundled catalog through ``TemplateGalleryModel`` (P1/S8) and switches over the
//  model's ``TemplateGalleryPhase`` so every state renders: loading, the gallery
//  / detail content, a friendly empty state, and an error state with retry —
//  never a blank box. On appear it emits the P1/S11 `view.opened` event.
//
//  Presentation is owned by the caller: present it with ``SwiftUI/View/tsTemplateGallery(isPresented:model:onApply:)``
//  (web `<Modal open onClose>`), or embed the view directly.
//

import Observation
import SwiftUI

// MARK: - Model (P1/S8 binding)

/// The observable state holder for the surface. It resolves the injected
/// ``TemplateGalleryCatalogSource`` into a ``TemplateGalleryPhase`` and owns the
/// in-place selection (web `useState<string | null>`). It performs no
/// networking: the canonical source is bundled and resolves synchronously, so
/// the surface opens already `loaded` — mirroring the web's static catalog
/// import — while `start()` / `refresh()` re-resolve for deferred sources.
@MainActor
@Observable
public final class TemplateGalleryModel {
    /// The current render phase.
    public private(set) var phase: TemplateGalleryPhase
    /// The selected preset id, or `nil` for the gallery grid (web `selectedId`).
    public var selectedID: String?

    @ObservationIgnored private let source: any TemplateGalleryCatalogSource
    @ObservationIgnored private let telemetry: any TemplateGalleryTelemetry

    public init(
        source: any TemplateGalleryCatalogSource = TemplateGalleryCanonicalCatalog(),
        telemetry: any TemplateGalleryTelemetry = OSLogTemplateGalleryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        phase = TemplateGalleryAdapter.phase(from: source.loadCatalog())
    }

    /// The currently selected template, resolved within the loaded set
    /// (web `DASHBOARD_PRESETS.find((p) => p.id === selectedId)`).
    public var selectedTemplate: TemplateGalleryTemplate? {
        phase.template(id: selectedID)
    }

    /// (Re)resolves the catalog. Idempotent for the synchronous canonical source.
    public func start() {
        phase = TemplateGalleryAdapter.phase(from: source.loadCatalog())
    }

    /// Re-resolves the catalog (the error-state retry affordance).
    public func refresh() {
        phase = TemplateGalleryAdapter.phase(from: source.loadCatalog())
    }

    /// Selects a preset for the detail view (web `setSelectedId`).
    public func select(_ id: String?) {
        selectedID = id
    }

    /// Clears the selection (web `setSelectedId(null)`), e.g. on back / close.
    public func clearSelection() {
        selectedID = nil
    }

    /// Emits the P1/S11 `view.opened` diagnostics event.
    public func reportOpen() {
        TemplateGallerySurface.reportOpen(to: telemetry)
    }
}

// MARK: - TemplateGallery

public struct TemplateGallery: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`); the canonical source.
    public nonisolated static let surfaceSlug = TemplateGallerySurface.slug

    @State private var model: TemplateGalleryModel
    private let onApply: (String) -> Void
    private let onClose: () -> Void

    /// - Parameters:
    ///   - model: the bound state holder; defaults to the bundled canonical catalog.
    ///   - onApply: invoked with the chosen preset id, or ``TemplateGallerySurface/blankPresetID``
    ///     for the "Blank" card (web `onApply`).
    ///   - onClose: invoked when the surface is dismissed (web `onClose`).
    public init(
        model: TemplateGalleryModel = TemplateGalleryModel(),
        onApply: @escaping (String) -> Void,
        onClose: @escaping () -> Void
    ) {
        _model = State(initialValue: model)
        self.onApply = onApply
        self.onClose = onClose
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.TS.border)
            ScrollView {
                TSRouteTransition(id: model.selectedID ?? "__gallery__") {
                    content
                        .padding(TSSpacing.lg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .background(Color.TS.surface)
        .task { model.reportOpen() }
    }

    // MARK: Header (web `Modal` title bar — dynamic title + close)

    private var header: some View {
        HStack(spacing: TSSpacing.md) {
            TemplateGalleryStrings.text(titleKey, titleFallback)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .padding(TSSpacing.lg)
    }

    private var closeButton: some View {
        Button {
            model.clearSelection()
            onClose()
        } label: {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TemplateGalleryStrings.text("templates.close", "Close"))
    }

    /// The title key/fallback (web: detail → "Template Preview", else "Dashboard
    /// Templates"). Only a loaded selection shows the detail title.
    private var titleKey: String {
        model.selectedTemplate == nil ? "templates.title" : "templates.detail"
    }

    private var titleFallback: String {
        model.selectedTemplate == nil ? "Dashboard Templates" : "Template Preview"
    }

    // MARK: Content (every phase renders)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TemplateGalleryLoading()
        case let .failed(messageKey, messageFallback):
            TemplateGalleryErrorState(messageKey: messageKey, messageFallback: messageFallback) {
                model.refresh()
            }
        case .empty:
            TemplateGalleryEmptyState()
        case let .loaded(templates):
            loadedContent(templates)
        }
    }

    @ViewBuilder
    private func loadedContent(_ templates: [TemplateGalleryTemplate]) -> some View {
        if let selected = model.selectedTemplate {
            TemplateGalleryDetail(
                projection: TemplateGalleryAdapter.detail(for: selected),
                onApply: {
                    onApply(selected.id)
                    model.clearSelection()
                },
                onBack: { model.clearSelection() }
            )
        } else {
            TemplateGalleryList(
                templates: templates,
                onSelectBlank: {
                    onApply(TemplateGallerySurface.blankPresetID)
                    model.clearSelection()
                },
                onSelect: { model.select($0) }
            )
        }
    }
}

// MARK: - Presenter (web `<Modal open onClose onApply>`)

public extension View {
    /// Presents the ``TemplateGallery`` in a sheet (web `Modal`). Applying a
    /// template (or "Blank") forwards the id and dismisses; the close affordance
    /// dismisses. This keeps presentation with the caller while the surface stays
    /// self-contained and testable.
    func tsTemplateGallery(
        isPresented: Binding<Bool>,
        model: TemplateGalleryModel = TemplateGalleryModel(),
        onApply: @escaping (String) -> Void
    ) -> some View {
        sheet(isPresented: isPresented) {
            TemplateGallery(
                model: model,
                onApply: { presetID in
                    onApply(presetID)
                    isPresented.wrappedValue = false
                },
                onClose: { isPresented.wrappedValue = false }
            )
        }
    }
}
