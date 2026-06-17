//
//  SmartChargeRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Navigation
//
//  Registers the native Smart Charge planner for the `.smartCharge` route so the
//  app shell's route host renders it. The web routes `/smart-charge` and
//  `/charging/schedule` resolve to `.smartCharge` through `AppRouteParser` (the
//  route's `pathSegment` is `smart-charge`; `/charging/schedule` is an alias), so
//  registering here makes the page reachable + deep-linkable from the sidebar,
//  the iPhone "More" list, and universal links. Mirrors the sibling
//  `ChargingListRouteRegistration`: the `@Observable` model is built on the main
//  actor here and captured, so the escaping registry closure never constructs an
//  isolated type.
//

import SwiftUI

enum SmartChargeRouteRegistration {
    @MainActor
    static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any SmartChargeDataSource = SampleSmartChargeDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SmartChargePageModel(dataSource: dataSource)
        registry.register(.smartCharge) {
            SmartChargePage(model: model)
        }
        return registry
    }
}
