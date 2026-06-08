//
//  SavingsSlide.Models.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  Domain value type ported from the web source's data contract
//  (web/src/api/types.ts `YearReview`, the slice the slide reads: `gas_savings`
//  + `total_charging_cost`) plus the snake-case decode adapter the production
//  source uses to project the cached DTO. Pure Foundation — no SwiftUI, no Shared
//  xcframework — so the file host-compiles and the cached→projection adapter is
//  unit-testable in isolation.
//

import Foundation

// MARK: - YearReviewSavings (web `YearReview` savings slice)

/// The slice of the web `YearReview` payload the savings slide renders. The web
/// component takes the whole `YearReview` prop but reads only these two money
/// fields (`gas_savings`, `total_charging_cost`); modeling just them keeps the
/// projection focused and the decode adapter total. Both default to zero so a
/// partial payload degrades to a "$0 saved" slide rather than dropping the
/// surface.
public struct YearReviewSavings: Equatable, Sendable {
    /// Estimated money saved vs. an equivalent gas car (web `data.gas_savings`).
    public let gasSavings: Double
    /// Total spent charging over the review window (web `data.total_charging_cost`).
    public let totalChargingCost: Double

    public init(gasSavings: Double = 0, totalChargingCost: Double = 0) {
        self.gasSavings = gasSavings
        self.totalChargingCost = totalChargingCost
    }
}

// MARK: - Decode adapter (snake-case DTO → value type)

public extension YearReviewSavings {
    private struct DTO: Decodable {
        let gasSavings: Double?
        let totalChargingCost: Double?
    }

    /// Decodes one `/analytics/year-review` object (snake-case JSON). Tolerates
    /// the full `YearReview` payload — only the two money fields are read — and a
    /// missing field decodes to zero (web reads `data.gas_savings` /
    /// `data.total_charging_cost` directly, which are non-optional numbers).
    static func decode(fromJSONString json: String) -> YearReviewSavings? {
        guard let data = json.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let dto = try? decoder.decode(DTO.self, from: data) else { return nil }
        return YearReviewSavings(
            gasSavings: dto.gasSavings ?? 0,
            totalChargingCost: dto.totalChargingCost ?? 0
        )
    }
}
