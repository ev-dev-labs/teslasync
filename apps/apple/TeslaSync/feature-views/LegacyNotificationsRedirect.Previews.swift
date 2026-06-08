//
//  LegacyNotificationsRedirect.Previews.swift
//  TeslaSync — P4 feature view · 0187 · LegacyNotificationsRedirect (Apple)
//
//  #if DEBUG previews exercising every state the surface renders — the transient
//  "resolving" affordance and the resolved destination for each `tab` branch (the
//  inbox default/fallback, archived + forwarded filters, channels) — so the redirect
//  can be eyeballed in Xcode without a live router.
//

#if DEBUG
    import SwiftUI

    /// A preview-only source that never emits, so the surface stays in `.resolving`.
    @MainActor
    private final class PendingPreviewSource: LegacyNotificationsRedirectSource {
        var onUpdate: (@MainActor (LegacyNotificationsLocation) -> Void)?
        func start() {}
        func stop() {}
    }

    private enum LegacyNotificationsRedirectPreviewData {
        @MainActor
        static func model(search: String) -> LegacyNotificationsRedirectModel {
            LegacyNotificationsRedirectModel(
                source: InMemoryLegacyNotificationsRedirectSource(
                    location: LegacyNotificationsLocation(search: search)
                ),
                router: InMemoryLegacyNotificationsRedirectRouter()
            )
        }

        @MainActor
        static func resolvingModel() -> LegacyNotificationsRedirectModel {
            LegacyNotificationsRedirectModel(
                source: PendingPreviewSource(),
                router: InMemoryLegacyNotificationsRedirectRouter()
            )
        }
    }

    private struct LegacyNotificationsRedirectPreviewStage: View {
        let model: LegacyNotificationsRedirectModel

        var body: some View {
            ScrollView {
                LegacyNotificationsRedirect(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Resolving") {
        LegacyNotificationsRedirectPreviewStage(
            model: LegacyNotificationsRedirectPreviewData.resolvingModel()
        )
    }

    #Preview("Inbox (default / fallback)") {
        LegacyNotificationsRedirectPreviewStage(
            model: LegacyNotificationsRedirectPreviewData.model(search: "")
        )
    }

    #Preview("Archived + forwarded filters") {
        LegacyNotificationsRedirectPreviewStage(
            model: LegacyNotificationsRedirectPreviewData.model(search: "?tab=archived&search=battery&unread=1")
        )
    }

    #Preview("Channels") {
        LegacyNotificationsRedirectPreviewStage(
            model: LegacyNotificationsRedirectPreviewData.model(search: "?tab=channels")
        )
    }
#endif
