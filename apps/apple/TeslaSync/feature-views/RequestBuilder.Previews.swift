//
//  RequestBuilder.Previews.swift
//  TeslaSync — P4 feature view · 0040 · RequestBuilder (Apple)
//
//  Xcode previews — one per branch the web source produces: a GET with path + query
//  params, a POST with a request body, the destructive confirm row, the in-flight
//  ("Sending…") send control, and a minimal endpoint with no params/body. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentRequestBuilderTelemetry: RequestBuilderTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample endpoints covering the source's conditional branches.
    private enum RequestBuilderPreviewData {
        static let telemetry = SilentRequestBuilderTelemetry()

        static let getWithParams = ParsedEndpoint(
            method: .get,
            path: "/vehicles/{vehicleID}/telemetry",
            summary: "Fetch vehicle telemetry",
            description: "Returns the latest telemetry frame for the vehicle.",
            parameters: [
                EndpointParameter(
                    name: "vehicleID",
                    location: .path,
                    required: true,
                    type: "string",
                    description: "Vehicle identifier"
                ),
                EndpointParameter(
                    name: "limit",
                    location: .query,
                    required: false,
                    type: "integer",
                    defaultValue: "50"
                ),
                EndpointParameter(
                    name: "signal",
                    location: .query,
                    required: false,
                    type: "string",
                    description: "Signal name filter"
                )
            ]
        )

        static let postWithBody = ParsedEndpoint(
            method: .post,
            path: "/alerts/rules",
            summary: "Create an alert rule",
            requestBody: RequestBody(
                contentType: "application/json",
                example: .object([
                    RequestJSONMember("name", .string("Low battery")),
                    RequestJSONMember("threshold", .number("20")),
                    RequestJSONMember("enabled", .bool(true))
                ])
            )
        )

        static let minimal = ParsedEndpoint(method: .get, path: "/system/version", summary: "API version")
    }

    #Preview("GET · params") {
        RequestBuilder(
            model: RequestBuilderModel(
                endpoint: RequestBuilderPreviewData.getWithParams,
                telemetry: RequestBuilderPreviewData.telemetry
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("POST · body") {
        RequestBuilder(
            model: RequestBuilderModel(
                endpoint: RequestBuilderPreviewData.postWithBody,
                telemetry: RequestBuilderPreviewData.telemetry
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("POST · confirm") {
        let model = RequestBuilderModel(
            endpoint: RequestBuilderPreviewData.postWithBody,
            telemetry: RequestBuilderPreviewData.telemetry
        )
        model.send() // opens the destructive confirm row
        return RequestBuilder(model: model)
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("GET · sending") {
        RequestBuilder(
            model: RequestBuilderModel(
                endpoint: RequestBuilderPreviewData.getWithParams,
                loading: true,
                telemetry: RequestBuilderPreviewData.telemetry
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("GET · minimal") {
        RequestBuilder(
            model: RequestBuilderModel(
                endpoint: RequestBuilderPreviewData.minimal,
                telemetry: RequestBuilderPreviewData.telemetry
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }
#endif
