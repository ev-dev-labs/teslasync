//
//  GuardedLink.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  The SwiftUI surface — the public API of the navigation-guard link, the parity of the web
//  `components/feedback/GuardedLink.tsx`. The view binds through `GuardedLinkModel` (P1/S8) for the
//  resolved link + live guard state and the once-only `view.opened` telemetry (P1/S11); no router and
//  no networking live here. Chrome is token-driven (P1/S9) and every string resolves through the
//  P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the guard feed is being read → skeleton link chrome.
//    • empty   — no destination (web `to` empty) → friendly empty state (the native improvement over a
//                broken/blank link), never a blank box.
//    • error   — the guard feed failed with no usable destination → a retryable error tile (web
//                `QueryError` peer).
//    • data    — the tappable link: a primary tap runs the guard-or-navigate flow (web
//                `confirmIfDirty()` → `navigate`), and a context action opens in a new window/scene
//                (the web modifier-click / `target="_blank"` guard bypass). When a guard is dirty the
//                surface raises the unsaved-changes confirmation (web `<ConfirmDialog>`).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the link with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - GuardedLink (the shared surface)

/// The navigation-guard link — the SwiftUI parity of the web `GuardedLink`. Renders every state plus
/// the P4 leaf freshness states, binding through `GuardedLinkModel`, and presents the unsaved-changes
/// confirmation when a registered guard is dirty.
public struct GuardedLink<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        GuardedLinkSurface.slug
    }

    @State private var model: GuardedLinkModel
    private let content: () -> Content

    public init(model: GuardedLinkModel, @ViewBuilder label: @escaping () -> Content) {
        _model = State(initialValue: model)
        content = label
    }

    /// Convenience initializer for the controlled-prop usage — the parity of the web parent mounting
    /// `<GuardedLink to={…} replace state relative>{children}</GuardedLink>`. The `navigator` performs
    /// the navigation (the web `useNavigate`); the guard state (`isDirty` + `guardMessage`) mirrors the
    /// web `useNavigationGuardContext`.
    public init(
        destination: GuardedDestination,
        options: GuardedNavigationOptions = GuardedNavigationOptions(),
        isDirty: Bool = false,
        guardMessage: String? = nil,
        connection: GuardedLinkConnection = .live,
        navigator: any GuardedNavigator,
        @ViewBuilder label: @escaping () -> Content
    ) {
        let source = StaticNavigationGuardSource(
            destination: destination,
            options: options,
            isDirty: isDirty,
            guardMessage: guardMessage,
            connection: connection
        )
        _model = State(initialValue: GuardedLinkModel(source: source, navigator: navigator))
        content = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            stateContent
            if model.connection != .live {
                GuardedLinkFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .confirmationDialog(
            Text(verbatim: GuardedLinkStrings.string("forms.unsavedTitle", "Unsaved changes")),
            isPresented: confirmPresented,
            titleVisibility: .visible,
            presenting: model.confirmRequest
        ) { _ in
            Button(role: .destructive) {
                model.confirmDiscard()
            } label: {
                Text(verbatim: GuardedLinkStrings.string("forms.discard", "Discard changes"))
            }
            Button(role: .cancel) {
                model.cancelConfirm()
            } label: {
                Text(verbatim: GuardedLinkStrings.string("forms.keepEditing", "Keep editing"))
            }
        } message: { request in
            Text(verbatim: request.message)
        }
    }

    /// Drives the unsaved-changes dialog from the model's `confirmRequest`; dismissal keeps editing.
    private var confirmPresented: Binding<Bool> {
        Binding(
            get: { model.confirmRequest != nil },
            set: { presented in
                if !presented { model.cancelConfirm() }
            }
        )
    }

    @ViewBuilder
    private var stateContent: some View {
        switch model.phase {
        case .loading:
            GuardedLinkLoadingView()
        case .empty:
            GuardedLinkEmptyView()
        case let .error(message):
            GuardedLinkErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.data {
                GuardedLinkButton(data: data, onActivate: { model.activate($0) }, content: content)
            }
        }
    }
}

// MARK: - Text-label convenience

public extension GuardedLink where Content == Text {
    /// Convenience for a plain localized link label — the common case of a text-only `<GuardedLink>`.
    init(
        _ titleKey: LocalizedStringKey,
        destination: GuardedDestination,
        options: GuardedNavigationOptions = GuardedNavigationOptions(),
        isDirty: Bool = false,
        guardMessage: String? = nil,
        connection: GuardedLinkConnection = .live,
        navigator: any GuardedNavigator
    ) {
        self.init(
            destination: destination,
            options: options,
            isDirty: isDirty,
            guardMessage: guardMessage,
            connection: connection,
            navigator: navigator
        ) {
            Text(titleKey)
        }
    }
}
