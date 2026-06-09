//
//  ResponseViewer.Previews.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  Xcode previews for each surface state (loaded 2xx / loaded error / empty /
//  loading) plus the standalone snippet panel. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum ResponseViewerPreviewData {
        static let jsonResponse = ApiResponse(
            status: 200,
            statusText: "OK",
            headers: [
                "Content-Type": "application/json",
                "X-Request-Id": "8f3a-22c1",
                "Cache-Control": "no-store"
            ],
            bodyText: "{\"id\":42,\"display_name\":\"Model 3\",\"battery\":{\"level\":78,\"range_m\":410000}}",
            durationMs: 128,
            size: 2048,
            contentType: "application/json"
        )

        static let errorResponse = ApiResponse(
            status: 404,
            statusText: "Not Found",
            headers: ["Content-Type": "application/json"],
            bodyText: "{\"error\":\"vehicle not found\",\"code\":\"NOT_FOUND\"}",
            durationMs: 56,
            size: 96,
            contentType: "application/json"
        )

        static let history = [
            HistoryEntry(method: "GET", path: "/api/v1/vehicles", status: 200, durationMs: 128, timestamp: "12:01:04"),
            HistoryEntry(method: "POST", path: "/api/v1/drives", status: 201, durationMs: 240, timestamp: "12:00:51"),
            HistoryEntry(method: "DELETE", path: "/api/v1/alerts/7", status: 404, durationMs: 60, timestamp: "12:00:12")
        ]
    }

    #Preview("Loaded · 200") {
        ScrollView {
            ResponseViewer(
                response: ResponseViewerPreviewData.jsonResponse,
                loading: false,
                history: ResponseViewerPreviewData.history,
                onReplay: { _ in }
            )
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Loaded · 404") {
        ScrollView {
            ResponseViewer(
                response: ResponseViewerPreviewData.errorResponse,
                loading: false,
                history: ResponseViewerPreviewData.history,
                onReplay: { _ in }
            )
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ResponseViewer(response: nil, loading: false, history: [], onReplay: { _ in })
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ResponseViewer(
            response: nil,
            loading: true,
            history: ResponseViewerPreviewData.history,
            onReplay: { _ in }
        )
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Snippet panel") {
        ScrollView {
            ResponseSnippetPanel(
                method: "POST",
                url: "https://teslasync.local/api/v1/drives",
                body: "{\"vehicle_id\":42}"
            )
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }
#endif
