import SwiftUI

/// One configured-endpoint row resolved against `version.endpoints` (web GlassPanel #7 row).
private struct FleetAPIConfiguredRow: Identifiable {
    let key: String
    let label: LocalizedStringKey
    let value: String

    var id: String {
        key
    }
}

/// API Endpoints card (web GlassPanel #6/#7): the build-version line and the configured-URL
/// list, or — when the server reports no endpoints — the empty state (web `EmptyState`,
/// `common.noData`).
struct FleetAPIConfiguredPanel: View {
    let model: FleetAPIPageModel

    /// The configured-URL rows in web order, each keyed by its `version.endpoints` key.
    @MainActor private static let endpointLabels: [(key: String, label: LocalizedStringKey)] = [
        ("api", "API (Internal)"),
        ("web", "Web Frontend"),
        ("oauth_callback", "OAuth Callback"),
        ("tesla_api", "Tesla Fleet API")
    ]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                FleetAPIPanelHeader(systemImage: "globe", tone: .accent, title: "API Endpoints") {
                    if let version = model.version {
                        Text(verbatim: version.summary)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("API Endpoints"))
    }

    @ViewBuilder
    private var content: some View {
        if let version = model.version, !version.endpoints.isEmpty {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "link")
                        .font(.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    Text("Configured Endpoints")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                        .textCase(.uppercase)
                }
                VStack(spacing: TSSpacing.sm) {
                    ForEach(rows(for: version)) { row in
                        endpointRow(label: row.label, value: row.value)
                    }
                }
            }
        } else {
            TSEmptyState(title: "common.noData", systemImage: "waveform.path.ecg")
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.lg)
        }
    }

    /// One configured-endpoint row (web GlassPanel #7): label + monospaced URL.
    private func endpointRow(label: LocalizedStringKey, value: String) -> some View {
        HStack(spacing: TSSpacing.md) {
            Text(label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .fleetAPIGlassRow()
    }

    /// Web `[...].map(ep => version.endpoints[ep.key] && ...)` — keeps only configured URLs.
    private func rows(for version: VersionInfo) -> [FleetAPIConfiguredRow] {
        Self.endpointLabels.compactMap { entry in
            guard let value = version.endpoints[entry.key], !value.isEmpty else { return nil }
            return FleetAPIConfiguredRow(key: entry.key, label: entry.label, value: value)
        }
    }
}
