//
//  AIPeriodCompareNarration.Adapter.swift
//  TeslaSync — P4 shared surface · 0037 · AIPeriodCompareNarration (Apple)
//
//  The testable, dependency-free core for the Helix period-compare narration card — the SwiftUI
//  parity of web/src/components/ai/AIPeriodCompareNarration.tsx and the shared `useAiStream` +
//  `AIFeatureCard` + `AiOutputPanel` primitives it composes. Everything here is pure Foundation (no
//  store, no SwiftUI, no bundle) so the request body, the `string | number` vehicle coercion, the
//  optional `daysA` / `daysB` window coercion, and the output / action derivations are unit tested
//  in isolation against the exact web expressions. The SSE frame parser + delta-accumulating stream
//  reducer live in the companion `AIPeriodCompareNarration.Stream.swift` (split for the lint budget).
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the behaviour):
//    • request body         = { vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0 }
//                             plus `days_a` when `daysA` is a finite number >= 0, plus `days_b` when
//                             `daysB` is a finite number >= 0, against POST
//                             /ai/analytics/period-compare/narrate. snake_case; `days_a: 0` (all time)
//                             IS forwarded — presence is distinguished from the backend default.
//    • vehicle coercion      = port of `numericVehicleId = typeof vehicleId === 'number' ? vehicleId :
//                             Number(vehicleId)` over `vehicleId?: string | number`, then the
//                             `Number.isFinite` test. `haveInputs = isFinite && numericVehicleId > 0`.
//    • days coercion         = port of `typeof daysA === 'number' && Number.isFinite(daysA) &&
//                             daysA >= 0` (and the same for `daysB`); 0 is kept ("all time" passthrough),
//                             negatives + non-finite + absent are omitted. Days do NOT affect canStart.
//    • AiOutputPanel branch  = nothing while idle+empty; "Helix error: {message}" in error; the
//                             thinking indicator while streaming before the first delta; else the
//                             accumulated prose.
//

import Foundation

// MARK: - Vehicle coercion (web `typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)`)

/// The native port of the web `string | number` vehicle prop handling. The web `InnerSection`
/// receives `vehicleId?: string | number`, computes `numericVehicleId = typeof vehicleId ===
/// 'number' ? vehicleId : Number(vehicleId)`, and then gates on `Number.isFinite(numericVehicleId) &&
/// numericVehicleId > 0`. This enum reproduces that coercion + the finiteness test so the
/// projection's `canStart` rule and the request body's `?? 0` fallback share one tested source of
/// truth. The resolved value is the canonical `Int?` the rest of the surface binds through (`nil` is
/// the web non-finite case).
public enum PeriodCompareNarrationVehicleID {
    /// The raw prop the parent `PeriodComparePage` surfaces — `string | number | undefined`
    /// (web `vehicleId?: string | number`).
    public enum Raw: Sendable, Equatable {
        case number(Double)
        case text(String)
        case absent
    }

    /// Resolves the raw prop to the finite integer id, or `nil` for the web
    /// `!Number.isFinite(numericVehicleId)` case (a non-numeric string, ±Infinity, NaN, or absent).
    /// A `.number` is taken as-is (web `typeof === 'number'`); a `.text` runs through the JS
    /// `Number(...)` port; `.absent` is `Number(undefined) === NaN`.
    public static func resolve(_ raw: Raw) -> Int? {
        let numeric: Double = switch raw {
        case let .number(value): value
        case let .text(text): jsNumber(text)
        case .absent: .nan
        }
        guard numeric.isFinite, numeric >= Double(Int.min), numeric <= Double(Int.max) else {
            return nil
        }
        return Int(numeric)
    }

    /// The web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0` rule,
    /// expressed over the already-resolved id (`nil` ⇒ non-finite ⇒ `false`). This is the single
    /// `canStart` source of truth the projection consumes.
    public static func canStart(_ resolvedID: Int?) -> Bool {
        (resolvedID ?? 0) > 0
    }

    /// Convenience: resolve the raw prop and apply the `canStart` rule in one step.
    public static func canStart(raw: Raw) -> Bool {
        canStart(resolve(raw))
    }

    /// A pragmatic port of JS `Number(string)` for the id forms the parent surfaces: leading/trailing
    /// whitespace is trimmed, an empty/whitespace string is `0` (JS `Number('') === 0`), a parseable
    /// numeric string is its value, and anything else is `NaN` (JS `Number('abc') === NaN`).
    private static func jsNumber(_ text: String) -> Double {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return 0 }
        return Double(trimmed) ?? .nan
    }
}

// MARK: - Days coercion (web `typeof daysA === 'number' && Number.isFinite(daysA) && daysA >= 0`)

/// The native port of the optional trailing-day-window props (`daysA?: number`, `daysB?: number`).
/// Unlike `vehicleId`, these are plain `number | undefined` — never `string`. The web includes the
/// field in the body only when it is a finite number `>= 0`; crucially `0` ("all time") IS forwarded
/// (presence is distinguished from the backend default), while negatives, NaN/±Infinity, and absent
/// values are omitted. The resolved value is the canonical `Int?` the request binds through (`nil`
/// means "omit the field"). Days never affect `canStart`.
public enum PeriodCompareNarrationDays {
    /// The raw prop the parent `PeriodComparePage` surfaces — `number | undefined`.
    public enum Raw: Sendable, Equatable {
        case number(Double)
        case absent
    }

    /// Resolves the raw window to an included integer day-count, or `nil` to omit the field. Mirrors
    /// `typeof days === 'number' && Number.isFinite(days) && days >= 0`: `.absent` and non-finite are
    /// omitted, negatives are omitted, and `0` is preserved (the "all time" passthrough the wiring
    /// contract asserts). Day windows are integers in the period selector, so a finite value is taken
    /// as its integer count.
    public static func resolve(_ raw: Raw) -> Int? {
        guard case let .number(value) = raw else { return nil }
        guard value.isFinite, value >= 0, value <= Double(Int.max) else { return nil }
        return Int(value)
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

/// The period-compare narrate stream request — the native mirror of the web
/// `useAiStream({ url: '/ai/analytics/period-compare/narrate', body: { vehicle_id, days_a?, days_b? } })`.
/// `vehicleID` is optional so the web non-finite → `0` coercion is reproduced exactly; `daysA` /
/// `daysB` are the already-resolved `Int?` windows (`nil` ⇒ the field is omitted). Unlike the cabin
/// card there ARE optional `days_a` / `days_b` fields — and `days_a: 0` is forwarded, not swallowed.
public struct PeriodCompareNarrationRequest: Sendable, Equatable {
    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    public static let path = "/ai/analytics/period-compare/narrate"

    public var vehicleID: Int?
    public var daysA: Int?
    public var daysB: Int?

    public init(vehicleID: Int?, daysA: Int? = nil, daysB: Int? = nil) {
        self.vehicleID = vehicleID
        self.daysA = daysA
        self.daysB = daysB
    }

    /// The snake_case JSON body. `vehicle_id` is always present (`vehicleID ?? 0` mirrors the web
    /// `vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0`); `days_a` / `days_b`
    /// are present only when their resolved window is non-`nil` (the web conditional spread), so
    /// `days_a: 0` is forwarded while an absent window is omitted entirely.
    public var body: [String: Int] {
        var out: [String: Int] = ["vehicle_id": vehicleID ?? 0]
        if let daysA { out["days_a"] = daysA }
        if let daysB { out["days_b"] = daysB }
        return out
    }

    /// The encoded request body, with keys sorted so the bytes are deterministic under test.
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render. It carries
/// no localized prose (that is applied at the projection boundary, P1/S10), so the branch logic is
/// asserted in isolation against the web `hasAnything` / error / thinking / prose order.
public enum PeriodCompareNarrationOutputKind: Sendable, Equatable {
    /// Web `!hasAnything` (idle, no text, never started) → the panel renders nothing; natively a
    /// friendly hint (the P4 "never a blank box" rule).
    case empty
    /// Web `text === '' && state === 'streaming'` → the thinking indicator.
    case thinking
    /// Web fallthrough → the accumulated prose.
    case prose(String)
    /// Web `state === 'error'` → "Helix error: {message}". `message` is the raw stream error
    /// (empty when the frame carried none; the localized "unknown" is applied in the projection).
    case failed(message: String)
}

/// Derives the output-panel branch from a stream snapshot — the exact `AiOutputPanel` order:
/// error → (empty+streaming) thinking → prose, with the leading `!hasAnything` guard mapping the
/// untouched idle stream to `.empty`.
public enum PeriodCompareNarrationOutput {
    public static func derive(_ snapshot: PeriodCompareNarrationStreamSnapshot) -> PeriodCompareNarrationOutputKind {
        let hasAnything = !snapshot.text.isEmpty
            || snapshot.state == .streaming
            || snapshot.state == .error
            || snapshot.state == .done
        if !hasAnything { return .empty }
        if snapshot.state == .error { return .failed(message: snapshot.error ?? "") }
        if snapshot.text.isEmpty, snapshot.state == .streaming { return .thinking }
        return .prose(snapshot.text)
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

/// The Ask-Helix action's derived flags — the native port of the `AIFeatureCard` button contract:
/// the visible label flips on `isStreaming`, and the control is disabled when `!canStart` or while
/// streaming (web `disabled = !canStart || isStreaming`).
public struct PeriodCompareNarrationAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart = isFinite(vehicleId) && vehicleId > 0`) and the
    /// stream state.
    public static func derive(
        canStart: Bool,
        state: PeriodCompareNarrationStreamState
    ) -> PeriodCompareNarrationAction {
        let streaming = state == .streaming
        return PeriodCompareNarrationAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum PeriodCompareNarrationAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
