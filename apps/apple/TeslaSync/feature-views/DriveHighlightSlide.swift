//
//  DriveHighlightSlide.swift
//  TeslaSync — P4 feature view · 0062 · DriveHighlightSlide (Apple)
//
//  The composable Year-in-Review "drive highlight" slide — the SwiftUI parity of
//  features/analytics/components/review/DriveHighlightSlide.tsx. Binds through `DriveHighlightSlideModel`
//  (no networking in the view); renders every state from the web story shell around the slide (loading /
//  empty / error / stale / offline / content). The content body reproduces the web leaf: a spring-in
//  emoji, the uppercased label, and a frosted card with the route, a three-up stat grid (distance /
//  duration / efficiency), and the date. The empty body reproduces the web `!drive` branch (the emoji +
//  "No drive data for this year").
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension DriveHighlightSlideStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so the
    /// model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - DriveHighlightSlide (the feature view)

/// The composable drive-highlight slide — the SwiftUI parity of
/// `features/analytics/components/review/DriveHighlightSlide.tsx`. Renders every state from the web
/// source, binding through `DriveHighlightSlideModel` (P1/S8). No networking lives here.
public struct DriveHighlightSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DriveHighlightSlideSurface.slug

    @State private var model: DriveHighlightSlideModel

    public init(model: DriveHighlightSlideModel) {
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
            DriveHighlightSlideLoadingView()
        case .empty:
            DriveHighlightSlideEmptyView(emoji: model.emoji)
        case let .error(message):
            DriveHighlightSlideErrorView(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                DriveHighlightSlideContent(
                    projection: projection,
                    emoji: model.emoji,
                    connection: model.connection,
                    isFetching: model.isFetching
                )
            } else {
                DriveHighlightSlideEmptyView(emoji: model.emoji)
            }
        }
    }
}
