//
//  AIPreheatPrecoolRecommender.Request.swift
//  TeslaSync — P4 shared surface · 0040 · AIPreheatPrecoolRecommender (Apple)
//
//  The Foundation-only request core for the Helix preheat / precool recommender — the `string |
//  number` vehicle coercion, the five-field snake_case draft body, and the five-part `canStart`
//  gate, split out of the adapter so each file stays within the house file-length budget. Everything
//  here is pure Foundation (no store, no SwiftUI, no bundle) so the web `? … : fallback` body
//  defaults (`vehicle_id … : 0`, `depart_by … : ''`, temperatures `… : 0`, `target … : 21`) and the
//  `haveInputs` gate are unit tested in isolation against the exact web expressions.
//

import Foundation

// MARK: - Vehicle coercion (web `typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)`)

/// The native port of the web `string | number` vehicle prop handling. The web `InnerSection`
/// receives `vehicleId?: string | number`, computes `numericVehicleId = typeof vehicleId ===
/// 'number' ? vehicleId : Number(vehicleId)`, and then gates on `Number.isFinite(numericVehicleId) &&
/// numericVehicleId > 0`. This enum reproduces that coercion + the finiteness test so the request
/// body's `?? 0` fallback and the gate's `> 0` rule share one tested source of truth. The resolved
/// value is the canonical `Int?` the rest of the surface binds through (`nil` is the web non-finite
/// case).
public enum PreheatPrecoolVehicleID {
    /// The raw prop the parent `ClimateControlPage` surfaces — `string | number | undefined`
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

    /// A pragmatic port of JS `Number(string)` for the id forms the parent surfaces: leading/trailing
    /// whitespace is trimmed, an empty/whitespace string is `0` (JS `Number('') === 0`), a parseable
    /// numeric string is its value, and anything else is `NaN` (JS `Number('abc') === NaN`).
    private static func jsNumber(_ text: String) -> Double {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return 0 }
        return Double(trimmed) ?? .nan
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

/// The preheat / precool draft stream request — the native mirror of the web
/// `useAiStream({ url: '/ai/climate/schedule/draft', body: { vehicle_id, depart_by,
/// current_cabin_temp_c, outside_temp_c, target_cabin_temp_c } })`. Every field is an already-resolved
/// typed optional so the web `Number.isFinite ? … : 0` / `typeof === 'string' ? … : ''` /
/// `target … : 21` fallbacks are reproduced exactly at the encoding boundary, and the five-part
/// `canStart` gate reads off the same values.
public struct PreheatPrecoolRequest: Sendable, Equatable {
    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    public static let path = "/ai/climate/schedule/draft"

    /// The web default cabin target — `target = isFinite(targetCabinTempC) ? targetCabinTempC : 21`.
    public static let defaultTargetCabinTempC = 21.0

    /// Resolved finite vehicle id (web `numericVehicleId`); `nil` is the non-finite case → body `0`.
    public var vehicleID: Int?
    /// The departure timestamp string; `nil` is the web non-string case → body `''`.
    public var departBy: String?
    /// Latest cabin temperature in °C; `nil` is the non-number / non-finite case → body `0`.
    public var currentCabinTempC: Double?
    /// Latest outside temperature in °C; `nil` is the non-number / non-finite case → body `0`.
    public var outsideTempC: Double?
    /// Target cabin temperature in °C; `nil` falls back to `defaultTargetCabinTempC` (web `21`).
    public var targetCabinTempC: Double?

    public init(
        vehicleID: Int? = nil,
        departBy: String? = nil,
        currentCabinTempC: Double? = nil,
        outsideTempC: Double? = nil,
        targetCabinTempC: Double? = nil
    ) {
        self.vehicleID = vehicleID
        self.departBy = departBy
        self.currentCabinTempC = currentCabinTempC
        self.outsideTempC = outsideTempC
        self.targetCabinTempC = targetCabinTempC
    }

    // MARK: Resolved body values (web body `? … : fallback`)

    /// `vehicle_id` — web `Number.isFinite(numericVehicleId) ? numericVehicleId : 0`.
    public var resolvedVehicleID: Int {
        vehicleID ?? 0
    }

    /// `depart_by` — web `typeof departBy === 'string' ? departBy : ''`.
    public var resolvedDepartBy: String {
        departBy ?? ""
    }

    /// `current_cabin_temp_c` — web `isFinite(currentCabinTempC) ? currentCabinTempC : 0`.
    public var resolvedCurrentCabinTempC: Double {
        currentCabinTempC ?? 0
    }

    /// `outside_temp_c` — web `isFinite(outsideTempC) ? outsideTempC : 0`.
    public var resolvedOutsideTempC: Double {
        outsideTempC ?? 0
    }

    /// `target_cabin_temp_c` — web `isFinite(targetCabinTempC) ? targetCabinTempC : 21`.
    public var resolvedTargetCabinTempC: Double {
        targetCabinTempC ?? Self.defaultTargetCabinTempC
    }

    // MARK: canStart gate (web `haveInputs`)

    /// Web `haveVehicle = Number.isFinite(numericVehicleId) && numericVehicleId > 0` (a finite id
    /// `<= 0` and the non-finite `nil` both fail).
    public var haveVehicle: Bool {
        resolvedVehicleID > 0
    }

    /// Web `haveDepart = typeof departBy === 'string' && departBy.length > 0`.
    public var haveDepart: Bool {
        departBy?.isEmpty == false
    }

    /// Web `haveCabin = typeof currentCabinTempC === 'number' && Number.isFinite(currentCabinTempC)`.
    public var haveCabin: Bool {
        currentCabinTempC != nil
    }

    /// Web `haveOutside = typeof outsideTempC === 'number' && Number.isFinite(outsideTempC)`.
    public var haveOutside: Bool {
        outsideTempC != nil
    }

    /// Web `haveInputs = haveVehicle && haveDepart && haveCabin && haveOutside` (the target defaults,
    /// so it is deliberately NOT part of the gate).
    public var canStart: Bool {
        haveVehicle && haveDepart && haveCabin && haveOutside
    }

    // MARK: Encoding

    /// The snake_case JSON body — `JSONEncoder` is used (not `JSONSerialization`) so the `Double`
    /// fields serialise with the shortest round-trippable form (`21.0` → `21`, `18.3` → `18.3`),
    /// matching JS `JSON.stringify` number formatting. Keys are sorted for deterministic bytes.
    public func encodedBody() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(PreheatPrecoolDraftPayload(self))
    }
}

// MARK: - Encodable payload (web body shape)

/// The `Encodable` projection carrying the resolved request values under the web's snake_case keys.
/// File-scoped (not nested in `PreheatPrecoolRequest`) so the `CodingKeys` enum stays within the
/// one-level type-nesting budget.
private struct PreheatPrecoolDraftPayload: Encodable {
    let currentCabinTempC: Double
    let departBy: String
    let outsideTempC: Double
    let targetCabinTempC: Double
    let vehicleID: Int

    init(_ request: PreheatPrecoolRequest) {
        currentCabinTempC = request.resolvedCurrentCabinTempC
        departBy = request.resolvedDepartBy
        outsideTempC = request.resolvedOutsideTempC
        targetCabinTempC = request.resolvedTargetCabinTempC
        vehicleID = request.resolvedVehicleID
    }

    enum CodingKeys: String, CodingKey {
        case currentCabinTempC = "current_cabin_temp_c"
        case departBy = "depart_by"
        case outsideTempC = "outside_temp_c"
        case targetCabinTempC = "target_cabin_temp_c"
        case vehicleID = "vehicle_id"
    }
}
