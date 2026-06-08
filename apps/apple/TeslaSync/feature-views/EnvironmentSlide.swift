//
//  EnvironmentSlide.swift
//  TeslaSync — P4 feature view · 0063 · EnvironmentSlide (Apple)
//
//  The composable Year-in-Review "environment" slide — the SwiftUI parity of
//  features/analytics/components/review/EnvironmentSlide.tsx. Binds through `EnvironmentSlideModel`
//  (no networking in the view); renders every state from the web story shell around the slide
//  (loading / empty / error / stale / offline / content). The content body reproduces the web leaf:
//  a spring-in globe, the "CO₂ offset" label, a green animated kilogram figure, the planted-trees
//  caption, and a staggered grid of tree glyphs with a "+N more" overflow chip.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension EnvironmentSlideStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - EnvironmentSlide (the feature view)

/// The composable environment slide — the SwiftUI parity of
/// `features/analytics/components/review/EnvironmentSlide.tsx`. Renders every state from the web
/// source, binding through `EnvironmentSlideModel` (P1/S8). No networking lives here.
public struct EnvironmentSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = EnvironmentSlideSurface.slug

    @State private var model: EnvironmentSlideModel

    public init(model: EnvironmentSlideModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, TSSpacing.x3xl)
            .padding(.vertical, TSSpacing.x2xl)
            .onAppear {
                model.start()
                model.autoRefreshIfStale()
            }
            .onDisappear { model.stop() }
            .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            EnvironmentSlideLoadingView()
        case .empty:
            EnvironmentSlideEmptyView()
        case let .error(message):
            EnvironmentSlideErrorView(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                EnvironmentSlideContent(
                    projection: projection,
                    connection: model.connection,
                    isFetching: model.isFetching
                )
            } else {
                EnvironmentSlideEmptyView()
            }
        }
    }
}
