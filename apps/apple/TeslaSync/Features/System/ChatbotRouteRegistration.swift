//
//  ChatbotRouteRegistration.swift
//  TeslaSync — P4-APPLE P7 · page:system/Chatbot (Apple) — Navigation
//
//  Registers the native Helix chatbot surface for the `.chatbot` route so the app shell's route
//  host renders it (web `/chatbot`). Mirrors the sibling `*RouteRegistration` enums: the
//  `@Observable` `ChatbotPageModel` is built on the main actor here and captured, so the escaping
//  registry closure never constructs an isolated type. `.chatbot`'s `pathSegment` is `chatbot`,
//  so `AppRouteParser` resolves `/chatbot` to it directly (no alias needed) and it surfaces in
//  the Account sidebar group next to Settings — the web nav's "Settings" section where the
//  "Helix Chat" link lives.
//

import SwiftUI

public enum ChatbotRouteRegistration {
    @MainActor
    public static func registry(base: AppRouteHostRegistry = AppRouteHostRegistry()) -> AppRouteHostRegistry {
        var registry = base
        let model = ChatbotPageModel()
        registry.register(.chatbot) {
            ChatbotPage(model: model)
        }
        return registry
    }
}
