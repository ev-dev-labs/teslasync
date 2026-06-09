//
//  LegacyAlertRulesRedirect.Previews.swift
//  TeslaSync — P4 feature view · 0184 · LegacyAlertRulesRedirect (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (redirecting / resolved with & without
//  forwarded params / empty / error / stale / offline), so the legacy Alert Rules redirect can be
//  eyeballed in Xcode without the live router.
//

#if DEBUG
    import SwiftUI

    private enum LegacyAlertRulesRedirectPreviewData {
        /// A representative inbound location with a rule deep link + an email CTA (the very deep links a
        /// saved dashboard / external system would carry), so the forwarded-parameter note renders.
        static let deepLink = AlertRulesRedirectLocation(
            path: LegacyAlertRulesRedirectConfig.webSourcePath,
            rawQuery: "rule_id=42&utm_source=email"
        )

        @MainActor
        static func model(_ update: LegacyAlertRulesRedirectUpdate) -> LegacyAlertRulesRedirectModel {
            LegacyAlertRulesRedirectModel(
                source: InMemoryLegacyAlertRulesRedirectSource(initial: update),
                copy: .fallback
            )
        }

        static func resolved(
            _ location: AlertRulesRedirectLocation = deepLink,
            connection: AlertRulesRedirectConnection = .live
        ) -> LegacyAlertRulesRedirectUpdate {
            LegacyAlertRulesRedirectUpdate(status: .resolved(location), connection: connection, updatedAt: Date())
        }
    }

    private struct LegacyAlertRulesRedirectPreviewStage: View {
        let model: LegacyAlertRulesRedirectModel

        var body: some View {
            ScrollView {
                LegacyAlertRulesRedirect(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Resolved (forwarding params)") {
        LegacyAlertRulesRedirectPreviewStage(
            model: LegacyAlertRulesRedirectPreviewData.model(LegacyAlertRulesRedirectPreviewData.resolved())
        )
    }

    #Preview("Resolved (no params)") {
        LegacyAlertRulesRedirectPreviewStage(
            model: LegacyAlertRulesRedirectPreviewData.model(
                LegacyAlertRulesRedirectPreviewData.resolved(AlertRulesRedirectLocation())
            )
        )
    }

    #Preview("Redirecting") {
        LegacyAlertRulesRedirectPreviewStage(
            model: LegacyAlertRulesRedirectPreviewData.model(
                LegacyAlertRulesRedirectUpdate(status: .resolving)
            )
        )
    }

    #Preview("Empty (no location)") {
        LegacyAlertRulesRedirectPreviewStage(
            model: LegacyAlertRulesRedirectPreviewData.model(
                LegacyAlertRulesRedirectUpdate(status: .unavailable)
            )
        )
    }

    #Preview("Error") {
        LegacyAlertRulesRedirectPreviewStage(
            model: LegacyAlertRulesRedirectPreviewData.model(
                LegacyAlertRulesRedirectUpdate(status: .failed("Couldn't read the current route"))
            )
        )
    }

    #Preview("Stale") {
        LegacyAlertRulesRedirectPreviewStage(
            model: LegacyAlertRulesRedirectPreviewData.model(
                LegacyAlertRulesRedirectPreviewData.resolved(connection: .stale)
            )
        )
    }

    #Preview("Offline") {
        LegacyAlertRulesRedirectPreviewStage(
            model: LegacyAlertRulesRedirectPreviewData.model(
                LegacyAlertRulesRedirectPreviewData.resolved(connection: .offline)
            )
        )
    }
#endif
