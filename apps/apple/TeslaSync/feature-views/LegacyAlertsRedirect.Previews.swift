//
//  LegacyAlertsRedirect.Previews.swift
//  TeslaSync — P4 feature view · 0185 · LegacyAlertsRedirect (Apple)
//
//  #if DEBUG previews exercising every state the surface renders — the transient
//  "resolving" affordance and the resolved destination for each `tab` branch (the
//  alerts default/fallback, the `history` → Inbox route with forwarded filters, and
//  the `preferences` → Quiet Hours route) — so the redirect can be eyeballed in Xcode
//  without a live router.
//

#if DEBUG
    import SwiftUI

    /// A preview-only source that never emits, so the surface stays in `.resolving`.
    @MainActor
    private final class PendingPreviewSource: LegacyAlertsRedirectSource {
        var onUpdate: (@MainActor (LegacyAlertsLocation) -> Void)?
        func start() {}
        func stop() {}
    }

    private enum LegacyAlertsRedirectPreviewData {
        @MainActor
        static func model(search: String) -> LegacyAlertsRedirectModel {
            LegacyAlertsRedirectModel(
                source: InMemoryLegacyAlertsRedirectSource(
                    location: LegacyAlertsLocation(search: search)
                ),
                router: InMemoryLegacyAlertsRedirectRouter()
            )
        }

        @MainActor
        static func resolvingModel() -> LegacyAlertsRedirectModel {
            LegacyAlertsRedirectModel(
                source: PendingPreviewSource(),
                router: InMemoryLegacyAlertsRedirectRouter()
            )
        }
    }

    private struct LegacyAlertsRedirectPreviewStage: View {
        let model: LegacyAlertsRedirectModel

        var body: some View {
            ScrollView {
                LegacyAlertsRedirect(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Resolving") {
        LegacyAlertsRedirectPreviewStage(
            model: LegacyAlertsRedirectPreviewData.resolvingModel()
        )
    }

    #Preview("Alerts (default / fallback)") {
        LegacyAlertsRedirectPreviewStage(
            model: LegacyAlertsRedirectPreviewData.model(search: "")
        )
    }

    #Preview("Inbox (history) + forwarded filters") {
        LegacyAlertsRedirectPreviewStage(
            model: LegacyAlertsRedirectPreviewData.model(search: "?tab=history&filter=open&severity=high")
        )
    }

    #Preview("Quiet Hours (preferences)") {
        LegacyAlertsRedirectPreviewStage(
            model: LegacyAlertsRedirectPreviewData.model(search: "?tab=preferences")
        )
    }
#endif
