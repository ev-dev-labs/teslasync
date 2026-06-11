//
//  SecuritySection.Previews.swift
//  TeslaSync — P4 feature view · 0298 · SecuritySection (Apple)
//
//  Xcode previews for each surface state (loading / data·secured / data·alert /
//  data·partial / empty / error / stale / offline). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SecuritySectionInput) -> SecuritySectionModel {
        let source = InMemorySecuritySectionSource(initial: input)
        let model = SecuritySectionModel(source: source)
        model.start()
        return model
    }

    /// Everything secured: locked + sentry active, no door open, no window open.
    private let securedReading = SecuritySectionReading(
        isLocked: true,
        sentryMode: true,
        doorState: nil,
        frontDriverWindow: .number(0),
        frontPassengerWindow: .bool(false),
        rearDriverWindow: .number(0),
        rearPassengerWindow: .number(0)
    )

    // Attention: unlocked, sentry off, a door open, and two windows reading open
    // (one numeric percentage, one boolean) — exercises the green↔cyan flips.
    private let alertReading = SecuritySectionReading(
        isLocked: false,
        sentryMode: false,
        doorState: .string("Driver Front Open"),
        frontDriverWindow: .number(42),
        frontPassengerWindow: .bool(true),
        rearDriverWindow: .number(0),
        rearPassengerWindow: .string("0")
    )

    // Partial: only the `state` flags known, no security-event door/window detail.
    private let partialReading = SecuritySectionReading(
        isLocked: true,
        sentryMode: false
    )

    #Preview("Loading") {
        SecuritySection(model: previewModel(SecuritySectionInput(isLoading: true)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · secured") {
        SecuritySection(model: previewModel(SecuritySectionInput(reading: securedReading)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · alert") {
        SecuritySection(model: previewModel(SecuritySectionInput(reading: alertReading)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · partial") {
        SecuritySection(model: previewModel(SecuritySectionInput(reading: partialReading)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SecuritySection(model: previewModel(SecuritySectionInput(reading: nil)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SecuritySection(model: previewModel(
            SecuritySectionInput(errorMessage: "Security request returned 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SecuritySection(model: previewModel(
            SecuritySectionInput(reading: securedReading, connection: .stale)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SecuritySection(model: previewModel(
            SecuritySectionInput(reading: securedReading, connection: .offline)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }
#endif
