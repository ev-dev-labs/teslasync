import SwiftUI

// MARK: - VIN decoder (web `VinDecoderTool`)

struct DevToolsVinTool: View {
    @State private var vin = ""

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.sm, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextField("devtools.field.vinHint", text: $vin, label: "devtools.field.vin")
            if let decoded = DevToolsUtilities.decodeVIN(vin) {
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
                    DevToolsResultRow(label: "devtools.vin.manufacturer", value: display(decoded.manufacturer))
                    DevToolsResultRow(label: "devtools.vin.model", value: display(decoded.model))
                    DevToolsResultRow(label: "devtools.vin.drive", value: display(decoded.driveType))
                    DevToolsResultRow(label: "devtools.vin.year", value: display(decoded.year))
                    DevToolsResultRow(label: "devtools.vin.plant", value: display(decoded.plant))
                    DevToolsResultRow(label: "devtools.vin.serial", value: display(decoded.serial))
                }
            }
        }
    }

    private func display(_ value: String) -> String {
        value.isEmpty ? String(localized: "devtools.vin.unknown") : value
    }
}

// MARK: - HTTP status lookup (web `HttpStatusTool`)

struct DevToolsHttpTool: View {
    @State private var search = ""

    private var codes: [DevToolsReferenceData.HTTPCode] {
        DevToolsReferenceData.filterHTTPCodes(search)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextField("devtools.field.searchCodes", text: $search)
            ForEach(codes) { code in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                    Text(verbatim: "\(code.code)")
                        .font(Font.TS.label)
                        .foregroundStyle(tone(code.code).color)
                        .padding(.horizontal, TSSpacing.sm)
                        .padding(.vertical, 2)
                        .background(tone(code.code).color.opacity(0.15), in: Capsule())
                        .frame(width: 52, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: code.text)
                            .font(Font.TS.body)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                        Text(verbatim: code.detail)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, TSSpacing.xs)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: "\(code.code) \(code.text). \(code.detail)"))
            }
        }
    }

    private func tone(_ code: Int) -> TSTone {
        switch code {
        case ..<300: .success
        case ..<400: .info
        case ..<500: .warning
        default: .danger
        }
    }
}

// MARK: - Tesla API reference (web `TeslaApiRefTool`)

struct DevToolsTeslaApiTool: View {
    @State private var search = ""

    private var endpoints: [DevToolsTeslaEndpoint] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return DevToolsCatalog.teslaEndpoints }
        return DevToolsCatalog.teslaEndpoints.filter { $0.searchText.contains(query) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextField("devtools.field.searchEndpoints", text: $search)
            ForEach(endpoints) { endpoint in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                    DevToolsMethodBadge(method: endpoint.method)
                        .frame(width: 52, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: endpoint.path)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(Color.TS.textPrimary)
                            .textSelection(.enabled)
                        Text(verbatim: endpoint.detail)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, TSSpacing.xs)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: "\(endpoint.method) \(endpoint.path)"))
            }
        }
    }
}
