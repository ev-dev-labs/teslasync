//
//  RequestBuilder.swift
//  TeslaSync — P4 feature view · 0040 · RequestBuilder (Apple)
//
//  The composable API-playground request builder — the SwiftUI parity of
//  features/admin/components/RequestBuilder.tsx. Binds through `RequestBuilderModel`
//  (P1/S8) and renders, top to bottom, the URL bar + send control, the destructive
//  confirm banner, the endpoint summary, the path / query / body sections that the web
//  source conditionally shows, and the always-present authentication panel. No
//  networking lives here — sending hands a `SendRequest` to the host.
//

import SwiftUI

/// The request builder surface (web `RequestBuilder`). State lives in
/// `RequestBuilderModel`; the host supplies the endpoint, the loading flag, and the
/// `onSend` callback when constructing the model.
public struct RequestBuilder: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RequestBuilderSurface.slug

    @State private var model: RequestBuilderModel

    public init(model: RequestBuilderModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: TSSpacing.lg) {
            RequestURLBar(
                method: model.endpoint.method,
                displayURL: model.displayURL,
                isLoading: model.isLoading,
                onSend: model.send
            )

            if model.confirmOpen {
                RequestConfirmBanner(
                    method: model.endpoint.method,
                    onConfirm: model.send,
                    onCancel: model.cancel
                )
            }

            if hasSummary {
                RequestEndpointSummary(
                    summary: model.endpoint.summary,
                    description: model.endpoint.description
                )
            }

            if !model.pathParameters.isEmpty {
                RequestSectionPanel(titleKey: "playground.pathParams", titleFallback: "Path Parameters") {
                    parameterRows(
                        model.pathParameters,
                        required: { _ in true },
                        prompt: RequestBuilderAdapter.pathPrompt
                    )
                }
            }

            if !model.queryParameters.isEmpty {
                RequestSectionPanel(titleKey: "playground.queryParams", titleFallback: "Query Parameters") {
                    parameterRows(
                        model.queryParameters,
                        required: \.required,
                        prompt: RequestBuilderAdapter.queryPrompt
                    )
                }
            }

            if let requestBody = model.endpoint.requestBody {
                RequestSectionPanel(
                    titleKey: "playground.requestBody",
                    titleFallback: "Request Body",
                    accessory: requestBody.contentType
                ) {
                    RequestBodyEditor(text: $model.body)
                }
            }

            RequestAuthPanel(apiKey: $model.apiKey)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { model.start() }
        .accessibilityElement(children: .contain)
    }

    /// Whether the summary block has anything to show (web `endpoint.summary` /
    /// `description !== summary` guards) — avoids a phantom gap when both are empty.
    private var hasSummary: Bool {
        let summary = model.endpoint.summary
        let description = model.endpoint.description
        return !summary.isEmpty || (!description.isEmpty && description != summary)
    }

    /// Builds the editor rows for a parameter group, wiring each field to its entry in
    /// `model.params` (the web `params[p.name]` controlled inputs).
    private func parameterRows(
        _ parameters: [EndpointParameter],
        required: (EndpointParameter) -> Bool,
        prompt: (EndpointParameter) -> String
    ) -> some View {
        ForEach(parameters) { parameter in
            RequestParameterRow(
                name: parameter.name,
                required: required(parameter),
                promptText: prompt(parameter),
                value: Binding(
                    get: { model.params[parameter.name] ?? "" },
                    set: { model.params[parameter.name] = $0 }
                )
            )
        }
    }
}
