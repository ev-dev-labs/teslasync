//
//  AILifetimeStatsQA.Adapter.swift
//  TeslaSync — P4 shared surface · 0024 · AILifetimeStatsQA (Apple)
//
//  The testable projection core for the "Ask about your lifetime stats" Helix panel — the
//  SwiftUI parity of components/ai/AILifetimeStatsQA.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the
//  request-body projection (the web `body` useMemo + `trimmedQuestion`), the question /
//  vehicle validity gates (web `haveQuestion` / `haveVehicle`), and the derived `canStart`
//  are all unit tested in isolation without rendering a view.
//
//  Parity note: the web component computes
//    trimmedQuestion = question.trim()
//    body = { vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
//             question: trimmedQuestion }
//    haveVehicle  = Number.isFinite(numericVehicleId) && numericVehicleId > 0
//    haveQuestion = trimmedQuestion.length > 0 && trimmedQuestion.length <= MaxQuestionChars
//    canStart     = haveVehicle && haveQuestion
//  `LifetimeStatsQARequest.project(vehicleID:rawQuestion:)` reproduces that walk exactly, so
//  the POSTed body + the button gate stay faithful to the on-mode SSE wiring contract.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and
/// the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum LifetimeStatsQASurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AILifetimeStatsQA"
    /// The AI feature id (web `withAiFeature('lifetime-stats-qa', …)`).
    public static let featureID = "lifetime-stats-qa"
}

// MARK: - Constants (web `MaxQuestionChars`)

/// Static caps mirrored from the web component. `maxQuestionChars` mirrors the backend
/// handler's `aiLifetimeStatsQAMaxQuestionChars` cap so a parser-rejection 400 never reaches
/// the user — the question field enforces it and `LifetimeStatsQARequest.isQuestionValid`
/// guards it.
public enum LifetimeStatsQAConstants {
    /// Web `MaxQuestionChars = 1024`.
    public static let maxQuestionChars = 1024
}

// MARK: - Request projection (web `body` useMemo + `trimmedQuestion`)

/// The projected POST body for `/ai/analytics/lifetime/qa` — the native mirror of the web
/// `body` useMemo. `question` is already trimmed (web `trimmedQuestion`); the validity gates
/// reproduce the web `haveVehicle` / `haveQuestion` / `canStart` booleans the button reads.
/// The view never builds this directly — the model projects it from the live vehicle scope +
/// the user's prompt before handing it to the source's `startStream`.
public struct LifetimeStatsQARequest: Equatable, Sendable {
    /// The scoped vehicle id (web `vehicle_id`).
    public let vehicleID: Int64
    /// The trimmed question text (web `trimmedQuestion`).
    public let question: String

    public init(vehicleID: Int64, question: String) {
        self.vehicleID = vehicleID
        self.question = question
    }

    /// Native port of the web `body` useMemo: trim the raw prompt (web `question.trim()`) and
    /// pair it with the vehicle scope. The vehicle id is passed through verbatim (web sends
    /// `numericVehicleId`); the `> 0` gate lives in `isVehicleValid`, not the projection, so
    /// the body shape matches the wire contract exactly.
    public static func project(vehicleID: Int64, rawQuestion: String) -> LifetimeStatsQARequest {
        LifetimeStatsQARequest(
            vehicleID: vehicleID,
            question: rawQuestion.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    /// Web `haveVehicle = Number.isFinite(numericVehicleId) && numericVehicleId > 0`. The
    /// native id is always finite, so only the positivity gate remains.
    public var isVehicleValid: Bool {
        vehicleID > 0
    }

    /// Web `haveQuestion = trimmed.length > 0 && trimmed.length <= MaxQuestionChars`.
    public var isQuestionValid: Bool {
        !question.isEmpty && question.count <= LifetimeStatsQAConstants.maxQuestionChars
    }

    /// Web `canStart = haveVehicle && haveQuestion` — the AIFeatureCard button gate.
    public var canStart: Bool {
        isVehicleValid && isQuestionValid
    }
}
