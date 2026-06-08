//
//  LegacyAlertStudioRedirect.Previews.swift
//  TeslaSync — P4 feature view · 0186 · LegacyAlertStudioRedirect (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (redirecting / resolved with & without
//  forwarded params / empty / error / stale / offline), so the legacy Alert Studio redirect can be
//  eyeballed in Xcode without the live router.
//

#if DEBUG
    import SwiftUI

    private enum LegacyAlertStudioRedirectPreviewData {
        /// A representative inbound location with a draft restore link + an email CTA (the very deep links
        /// the web source's header calls out), so the forwarded-parameter note renders.
        static let deepLink = RedirectLocation(
            path: LegacyAlertStudioRedirectConfig.webSourcePath,
            rawQuery: "draft=42&utm_source=email"
        )

        @MainActor
        static func model(_ update: LegacyAlertStudioRedirectUpdate) -> LegacyAlertStudioRedirectModel {
            LegacyAlertStudioRedirectModel(
                source: InMemoryLegacyAlertStudioRedirectSource(initial: update),
                copy: .fallback
            )
        }

        static func resolved(
            _ location: RedirectLocation = deepLink,
            connection: RedirectConnection = .live
        ) -> LegacyAlertStudioRedirectUpdate {
            LegacyAlertStudioRedirectUpdate(status: .resolved(location), connection: connection, updatedAt: Date())
        }
    }

    private struct LegacyAlertStudioRedirectPreviewStage: View {
        let model: LegacyAlertStudioRedirectModel

        var body: some View {
            ScrollView {
                LegacyAlertStudioRedirect(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Resolved (forwarding params)") {
        LegacyAlertStudioRedirectPreviewStage(
            model: LegacyAlertStudioRedirectPreviewData.model(LegacyAlertStudioRedirectPreviewData.resolved())
        )
    }

    #Preview("Resolved (no params)") {
        LegacyAlertStudioRedirectPreviewStage(
            model: LegacyAlertStudioRedirectPreviewData.model(
                LegacyAlertStudioRedirectPreviewData.resolved(RedirectLocation())
            )
        )
    }

    #Preview("Redirecting") {
        LegacyAlertStudioRedirectPreviewStage(
            model: LegacyAlertStudioRedirectPreviewData.model(
                LegacyAlertStudioRedirectUpdate(status: .resolving)
            )
        )
    }

    #Preview("Empty (no location)") {
        LegacyAlertStudioRedirectPreviewStage(
            model: LegacyAlertStudioRedirectPreviewData.model(
                LegacyAlertStudioRedirectUpdate(status: .unavailable)
            )
        )
    }

    #Preview("Error") {
        LegacyAlertStudioRedirectPreviewStage(
            model: LegacyAlertStudioRedirectPreviewData.model(
                LegacyAlertStudioRedirectUpdate(status: .failed("Couldn't read the current route"))
            )
        )
    }

    #Preview("Stale") {
        LegacyAlertStudioRedirectPreviewStage(
            model: LegacyAlertStudioRedirectPreviewData.model(
                LegacyAlertStudioRedirectPreviewData.resolved(connection: .stale)
            )
        )
    }

    #Preview("Offline") {
        LegacyAlertStudioRedirectPreviewStage(
            model: LegacyAlertStudioRedirectPreviewData.model(
                LegacyAlertStudioRedirectPreviewData.resolved(connection: .offline)
            )
        )
    }
#endif
