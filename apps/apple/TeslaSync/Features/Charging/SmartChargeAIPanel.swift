//
//  SmartChargeAIPanel.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — AI panel
//
//  GlassPanel1 — the opt-in Helix "Draft a schedule" card at the top of the page
//  (web `<AISmartChargeScheduleSuggestion />`). It composes the already-shipped
//  shared surface (P4/0047), seeding it with the page's selected vehicle + rate
//  plan exactly as the web passes those props. The surface is gated by its own
//  `useAiEnabled` peer (renders nothing in off mode — web `withAiFeature` → null)
//  and otherwise streams propose-only; no networking or business logic lives
//  here. Re-seeded via `.id` when the vehicle or rate plan changes.
//

import SwiftUI

struct SmartChargeAIPanel: View {
    let vehicleID: Int64
    let ratePlanID: String

    var body: some View {
        AISmartChargeScheduleSuggestion(model: Self.makeModel(vehicleID: vehicleID, ratePlanID: ratePlanID))
            .id("\(vehicleID)-\(ratePlanID)")
    }

    @MainActor
    private static func makeModel(vehicleID: Int64, ratePlanID: String) -> SmartChargeScheduleModel {
        let input = SmartChargeScheduleInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID > 0 ? Int(vehicleID) : nil,
            ratePlanID: ratePlanID
        )
        return SmartChargeScheduleModel(source: InMemorySmartChargeScheduleSource(initial: input))
    }
}
