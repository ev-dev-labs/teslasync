//
//  CurrencyInput.Previews.swift
//  TeslaSync — P4 shared surface · 0150 · CurrencyInput (Apple)
//
//  Xcode previews for each surface state (ready-populated across USD / EUR-de / GBP, ready-empty,
//  loading, error, stale, offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum CurrencyInputFieldPreviewData {
        /// The documented canonical ariaLabel (the settings tariff field).
        static let label = "Electricity Cost (per kWh)"

        static func input(
            valueMicro: Int?,
            currency: String,
            localeID: String,
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: CurrencyInputFieldConnection = .live,
            isRequired: Bool = false
        ) -> CurrencyInputFieldInput {
            CurrencyInputFieldInput(
                valueMicro: valueMicro,
                currency: currency,
                locale: Locale(identifier: localeID),
                precision: 2,
                ariaLabel: label,
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection,
                isRequired: isRequired
            )
        }
    }

    @MainActor
    private func currencyInputFieldPreviewModel(_ input: CurrencyInputFieldInput) -> CurrencyInputFieldModel {
        let source = InMemoryCurrencyInputFieldSource(initial: input)
        let model = CurrencyInputFieldModel(source: source)
        model.start()
        return model
    }

    #Preview("Ready · USD") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(valueMicro: 1_500_000, currency: "USD", localeID: "en_US")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Empty (required)") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(
                valueMicro: nil, currency: "USD", localeID: "en_US", isRequired: true
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · EUR de-DE") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(valueMicro: 1_500_000, currency: "EUR", localeID: "de_DE")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · GBP en-GB") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(valueMicro: 2_500_000, currency: "GBP", localeID: "en_GB")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(valueMicro: nil, currency: "USD", localeID: "en_US", isLoading: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(
                valueMicro: nil, currency: "USD", localeID: "en_US",
                errorMessage: "The settings request timed out"
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(
                valueMicro: 1_500_000, currency: "USD", localeID: "en_US", connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        CurrencyInputField(model: currencyInputFieldPreviewModel(
            CurrencyInputFieldPreviewData.input(
                valueMicro: 1_500_000, currency: "USD", localeID: "en_US", connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
