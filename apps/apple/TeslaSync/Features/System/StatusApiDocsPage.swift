//
//  StatusApiDocsPage.swift
//  TeslaSync — P7 System · StatusApiDocsPage (Apple)
//
//  SwiftUI parity of web/src/features/system/pages/StatusApiDocsPage.tsx — Status API
//  documentation for external integrations (Grafana, Uptime Kuma, Home Assistant). Static
//  page with no API sources. Adaptive layout for macOS/iOS, all strings from
//  Localizable.xcstrings, design tokens from P2 (Color.TS, Font.TS, TSSpacing, TSRadius).
//
// swiftlint:disable file_length

import SwiftUI

// MARK: - View Model

@Observable
final class StatusApiDocsPageModel {
    var title: String {
        String(localized: "docs.statusApi.title", defaultValue: "Status API")
    }

    var subtitle: String {
        String(localized: "docs.statusApi.subtitle", defaultValue: "Stable contract for external integrations")
    }

    var overviewTitle: String {
        String(localized: "docs.statusApi.overview.title", defaultValue: "Overview")
    }

    var overviewParagraph1: String {
        String(
            localized: "docs.statusApi.overview.paragraph1",
            defaultValue: """
            All endpoints are mounted under /api/v1/status and inherit the same \
            authentication as the rest of the API. If you proxy this with ForwardAuth \
            (Authelia, Authentik, Tinyauth, etc.), the proxy handles auth — otherwise \
            pass an API key in the standard Authorization: Bearer … header.
            """
        )
    }

    var overviewParagraph2: String {
        String(
            localized: "docs.statusApi.overview.paragraph2",
            defaultValue: """
            Designed for: Grafana (JSON datasource), Uptime Kuma (HTTP(s) JSON Query monitor), \
            Home Assistant (REST sensor), Healthchecks.io (synthetic monitor), or any other \
            system that consumes JSON over HTTP.
            """
        )
    }

    var overviewParagraph3: String {
        String(
            localized: "docs.statusApi.overview.paragraph3",
            defaultValue: """
            The shape is additive-only — new fields may appear, but existing field types and \
            names won't change without a major version bump.
            """
        )
    }

    var footerNote: String {
        String(
            localized: "docs.statusApi.footer.note",
            defaultValue: """
            Need an additional endpoint or field? Open an issue on the project repo — the API \
            surface is intentionally small, but additive changes are welcome.
            """
        )
    }

    let endpoints: [EndpointDefinition] = [
        EndpointDefinition(
            method: "GET",
            path: "/api/v1/status",
            queryParams: nil,
            descriptionKey: "docs.statusApi.endpoints.status.description",
            descriptionDefault: """
            Overall snapshot — answers 'is it healthy right now?' in a single round-trip. \
            Includes counts, version, resources, maintenance, and a list of active incidents.
            """,
            exampleJSON: """
            {"status":"operational","generated_at":"2025-01-15T14:32:11Z",\
            "version":{"build":"1.4.2","go_version":"go1.22.5",\
            "started_at":"2025-01-10T08:00:00Z"},\
            "counts":{"components_total":8,"components_healthy":8,\
            "components_degraded":0,"components_unhealthy":0},\
            "resources":{"goroutines":142,"uptime_seconds":458321.4,\
            "go_version":"go1.22.5"},"incidents":[]}
            """
        ),
        EndpointDefinition(
            method: "GET",
            path: "/api/v1/status/components",
            queryParams: nil,
            descriptionKey: "docs.statusApi.endpoints.components.description",
            descriptionDefault: """
            Per-component health array — useful for surfacing individual subsystem status \
            (database, mqtt, tesla, telemetry, etc.) in your own dashboard.
            """,
            exampleJSON: """
            {"generated_at":"2025-01-15T14:32:11Z",\
            "counts":{"components_total":3,"components_healthy":3,\
            "components_degraded":0,"components_unhealthy":0},\
            "components":[{"name":"database","status":"healthy",\
            "consecutive_failures":0,"last_check_at":"2025-01-15T14:32:08Z"},\
            {"name":"mqtt","status":"healthy","consecutive_failures":0,\
            "last_check_at":"2025-01-15T14:32:08Z"},\
            {"name":"tesla","status":"healthy","consecutive_failures":0,\
            "last_check_at":"2025-01-15T14:32:08Z"}]}
            """
        ),
        EndpointDefinition(
            method: "GET",
            path: "/api/v1/status/resources",
            queryParams: nil,
            descriptionKey: "docs.statusApi.endpoints.resources.description",
            descriptionDefault: """
            Runtime resources only (goroutines, uptime, Go version). Light enough to poll at high frequency.
            """,
            exampleJSON: """
            {"generated_at":"2025-01-15T14:32:11Z",\
            "resources":{"goroutines":142,"uptime_seconds":458321.4,\
            "go_version":"go1.22.5"}}
            """
        ),
        EndpointDefinition(
            method: "GET",
            path: "/api/v1/status/uptime",
            queryParams: "window=24h | 7d | 30d | 90d | 1y",
            descriptionKey: "docs.statusApi.endpoints.uptime.description",
            descriptionDefault: """
            Uptime percentage over the requested window. Until per-component heartbeat history \
            is wired, the percentage is derived from the current snapshot — the historical_source \
            field signals which is in play.
            """,
            exampleJSON: """
            {"window":"30d","uptime_percent":100,"healthy_count":8,\
            "total_count":8,"generated_at":"2025-01-15T14:32:11Z",\
            "historical_source":"current_snapshot",\
            "note":"Per-window uptime requires the heartbeat history \
            backend (planned). This value reflects the current snapshot only."}
            """
        ),
        EndpointDefinition(
            method: "GET",
            path: "/api/v1/status/incidents",
            queryParams: "active=1 | limit=N",
            descriptionKey: "docs.statusApi.endpoints.incidents.description",
            descriptionDefault: """
            Active incidents list. Pass active=1 to filter to incidents whose resolved_at is NULL.
            """,
            exampleJSON: """
            {"count":1,"incidents":[{"id":17,\
            "title":"MQTT broker reconnect storm","status":"monitoring",\
            "severity":"minor","source":"manual",\
            "affected_components":["mqtt"],\
            "started_at":"2025-01-15T13:55:00Z",\
            "updated_at":"2025-01-15T14:20:00Z","updates":[{"at":\
            "2025-01-15T13:55:00Z","status":"investigating",\
            "message":"Incident opened.","author":"operator"},{"at":\
            "2025-01-15T14:10:00Z","status":"identified",\
            "message":"Cause: TLS cert rotation gap.","author":"operator"},\
            {"at":"2025-01-15T14:20:00Z","status":"monitoring",\
            "message":"Cert rotated; watching.","author":"operator"}]}]}
            """
        ),
        EndpointDefinition(
            method: "GET",
            path: "/api/v1/status/live",
            queryParams: nil,
            descriptionKey: "docs.statusApi.endpoints.live.description",
            descriptionDefault: """
            Server-Sent Events stream. Pushes a status event with the full snapshot every 30 seconds. \
            Heartbeat events emitted every 25s so reverse proxies don't garbage-collect the connection \
            mid-flight. Browsers consume this via EventSource(). For curl: -N --no-buffer.
            """,
            exampleJSON: """
            {"note":"event: status\\ndata: <full StatusSnapshot JSON>\\n\\n"}
            """
        )
    ]

    init() {}
}

// MARK: - Model Types

struct EndpointDefinition: Identifiable {
    let id = UUID()
    let method: String
    let path: String
    let queryParams: String?
    let descriptionKey: String
    let descriptionDefault: String
    let exampleJSON: String
}

// MARK: - Top-Level Surface

public struct StatusApiDocsPage: View {
    @State private var viewModel = StatusApiDocsPageModel()
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                pageHeader
                overviewPanel
                endpointList
                footerPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 800)
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(viewModel.title)
    }

    @ViewBuilder
    private var pageHeader: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(viewModel.title)
                .font(.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)

            Text(viewModel.subtitle)
                .font(.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var overviewPanel: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "server.rack")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(viewModel.overviewTitle)
                        .font(.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                .accessibilityElement(children: .combine)

                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    Text(viewModel.overviewParagraph1)
                        .font(.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(viewModel.overviewParagraph2)
                        .font(.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(alignment: .top, spacing: TSSpacing.xs) {
                        Image(systemName: "chevron.left.forwardslash.chevron.right")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.TS.statusWarning.opacity(0.8))
                            .frame(width: 14, height: 14)
                            .accessibilityHidden(true)

                        Text(viewModel.overviewParagraph3)
                            .font(.TS.bodySm)
                            .foregroundStyle(Color.TS.statusWarning.opacity(0.8))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .groupBoxStyle(GlassPanelStyle())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Overview")
    }

    @ViewBuilder
    private var endpointList: some View {
        ForEach(viewModel.endpoints) { endpoint in
            endpointCard(for: endpoint)
        }
    }

    private func endpointCard(for endpoint: EndpointDefinition) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                endpointHeader(endpoint)
                endpointDescription(endpoint)
                endpointExample(endpoint)
            }
        }
        .groupBoxStyle(GlassPanelStyle())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(endpoint.method) \(endpoint.path)")
    }

    @ViewBuilder
    private func endpointHeader(_ endpoint: EndpointDefinition) -> some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Text(endpoint.method)
                .font(.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs / 2)
                .background(Color.TS.statusInfo.opacity(0.15))
                .cornerRadius(TSRadius.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm)
                        .stroke(Color.TS.statusInfo.opacity(0.3), lineWidth: 1)
                )
                .accessibilityLabel("HTTP method \(endpoint.method)")

            Text(endpoint.path)
                .font(.system(size: 13, weight: .regular, design: .monospaced))
                .foregroundStyle(Color.TS.accent.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)

            if let queryParams = endpoint.queryParams {
                Text("?\(queryParams)")
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func endpointDescription(_ endpoint: EndpointDefinition) -> some View {
        Text(String(
            localized: LocalizedStringKey(endpoint.descriptionKey),
            defaultValue: String.LocalizationValue(endpoint.descriptionDefault)
        ))
        .font(.TS.bodySm)
        .foregroundStyle(Color.TS.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func endpointExample(_ endpoint: EndpointDefinition) -> some View {
        DisclosureGroup {
            Text(endpoint.exampleJSON)
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.TS.surface)
                .cornerRadius(TSRadius.md)
                .accessibilityLabel("Example response JSON")
        } label: {
            Text(String(
                localized: "docs.statusApi.endpoints.exampleResponse",
                defaultValue: "Example response"
            ))
            .font(.system(size: 12, weight: .regular))
            .foregroundStyle(Color.TS.textMuted)
        }
        .accentColor(Color.TS.textMuted)
    }

    private var footerPanel: some View {
        GroupBox {
            Text(viewModel.footerNote)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .groupBoxStyle(GlassPanelStyle())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Footer note")
    }
}

// MARK: - Glass Panel Style

private struct GlassPanelStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            configuration.label
            configuration.content
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass)
        .cornerRadius(TSRadius.lg)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg)
                .stroke(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Design Tokens

enum TSSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let x2xl: CGFloat = 24
}

enum TSRadius {
    static let sm: CGFloat = 4
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
}

// MARK: - Previews

#Preview("StatusApiDocsPage — Light") {
    NavigationStack {
        StatusApiDocsPage()
    }
    .preferredColorScheme(.light)
}

#Preview("StatusApiDocsPage — Dark") {
    NavigationStack {
        StatusApiDocsPage()
    }
    .preferredColorScheme(.dark)
}

#Preview("StatusApiDocsPage — Compact") {
    NavigationStack {
        StatusApiDocsPage()
    }
    .environment(\.horizontalSizeClass, .compact)
}
