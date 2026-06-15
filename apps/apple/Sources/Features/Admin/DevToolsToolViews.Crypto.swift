import SwiftUI

// MARK: - UUID generator (web `UuidGeneratorTool`)

struct DevToolsUuidTool: View {
    @State private var uuids: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSButton("devtools.action.generate", size: .small) {
                uuids = Array(([DevToolsUtilities.generateUUID()] + uuids).prefix(10))
            }
            ForEach(uuids, id: \.self) { uuid in
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: uuid)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Color.TS.accent)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    DevToolsCopyButton(value: uuid)
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(
                    Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
            }
        }
    }
}

// MARK: - SHA-256 hash (web `HashCalculatorTool`)

struct DevToolsHashTool: View {
    @State private var input = ""
    @State private var result = ""

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextArea(text: $input, label: "devtools.field.hashInput", minHeight: 72)
            TSButton("devtools.action.computeSha256", size: .small) {
                result = input.isEmpty ? "" : DevToolsUtilities.sha256Hex(input)
            }
            if !result.isEmpty {
                DevToolsOutputBlock(label: "devtools.field.sha256", value: result, tone: .danger)
            }
        }
    }
}

// MARK: - Timestamp converter (web `TimestampTool`)

struct DevToolsTimestampTool: View {
    @State private var unixInput = ""
    @State private var isoInput = ""

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                currentRow(now: context.date)
            }
            unixField
            isoField
        }
    }

    private func currentRow(now: Date) -> some View {
        HStack(spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: "\(DevToolsUtilities.currentUnix(now))")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: DevToolsUtilities.iso8601(now))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
            TSButton("devtools.action.now", variant: .ghost, size: .small) {
                unixInput = "\(DevToolsUtilities.currentUnix(now))"
                isoInput = DevToolsUtilities.iso8601(now)
            }
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }

    private var unixField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSTextField("devtools.field.unixHint", text: $unixInput, label: "devtools.field.unixTimestamp")
            if let decoded = DevToolsUtilities.decodeUnix(unixInput, now: Date()) {
                DevToolsResultRow(label: "devtools.field.iso", value: decoded.iso, tone: .info)
                DevToolsResultRow(label: "devtools.field.relative", value: decoded.relative, tone: .info)
            }
        }
    }

    private var isoField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSTextField("devtools.field.isoHint", text: $isoInput, label: "devtools.field.isoTimestamp")
            if let decoded = DevToolsUtilities.decodeISO(isoInput, now: Date()) {
                DevToolsResultRow(label: "devtools.field.unix", value: "\(decoded.unix)", tone: .info)
                DevToolsResultRow(label: "devtools.field.relative", value: decoded.relative, tone: .info)
            }
        }
    }
}
