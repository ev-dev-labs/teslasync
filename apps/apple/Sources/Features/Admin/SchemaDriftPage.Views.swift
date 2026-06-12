import SwiftUI

// The two populated panels for `SchemaDriftPage` (web `DriftSummary` + `DriftDetails`)
// plus their sub-views. Kept as a dedicated surface (mirroring `DiskForecastPage.Table`)
// so the page file stays focused on chrome + state routing. All copy resolves from
// `Localizable.xcstrings` with the web key names; the schema counts are unit-agnostic
// control-plane values formatted at the display boundary by `SchemaDriftFormat`.

// MARK: - GlassPanel1 — Drift summary (web `DriftSummary`)

/// Web `DriftSummary`: a `GlassPanel` with the drift-status header (title + status
/// badge) and the three count-delta stat cards (Tables / Columns / Indexes Δ).
struct SchemaDriftSummaryPanel: View {
    let report: SchemaDriftReport

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var statColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    var body: some View {
        let drift = report.drift
        return TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(alignment: .center) {
                    TSPanelTitle("admin.schemaDrift.statusTitle")
                    Spacer(minLength: TSSpacing.sm)
                    SchemaDriftStatusBadge(isDrifted: report.isDrifted)
                }
                LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
                    TSMetricCard(
                        title: "admin.schemaDrift.tableDelta",
                        value: SchemaDriftFormat.delta(drift.tableCountDelta),
                        caption: sub(
                            String(localized: "admin.schemaDrift.tableSub"),
                            current: drift.current.tableCount,
                            expected: drift.expected.tableCount
                        )
                    )
                    TSMetricCard(
                        title: "admin.schemaDrift.columnDelta",
                        value: SchemaDriftFormat.delta(drift.columnCountDelta),
                        caption: sub(
                            String(localized: "admin.schemaDrift.columnSub"),
                            current: drift.current.columnCount,
                            expected: drift.expected.columnCount
                        )
                    )
                    TSMetricCard(
                        title: "admin.schemaDrift.indexDelta",
                        value: SchemaDriftFormat.delta(drift.indexCountDelta),
                        caption: sub(
                            String(localized: "admin.schemaDrift.indexSub"),
                            current: drift.current.indexCount,
                            expected: drift.expected.indexCount
                        )
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.schemaDrift.statusTitle"))
    }

    /// Web `{{current}} current · {{expected}} expected` sublabel resolved through the
    /// catalog and returned as a verbatim `LocalizedStringKey` (the counts are
    /// pre-formatted by `fmtNumber`). `template` is the resolved catalog format
    /// (`"%1$@ current · %2$@ expected"`).
    private func sub(_ template: String, current: Int, expected: Int) -> LocalizedStringKey {
        "\(SchemaDriftFormat.countSub(template, current: current, expected: expected))"
    }
}

// MARK: - GlassPanel2 — Fingerprints (web `DriftDetails`)

/// Web `DriftDetails`: a `GlassPanel` titled "Fingerprints" holding the current and
/// expected (seed) fingerprint cards side by side.
struct SchemaDriftDetailsPanel: View {
    let report: SchemaDriftReport

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.lg)]
            : [GridItem(.flexible(), spacing: TSSpacing.lg), GridItem(.flexible(), spacing: TSSpacing.lg)]
    }

    var body: some View {
        let drift = report.drift
        return TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("admin.schemaDrift.fingerprintTitle")
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                    SchemaDriftFingerprintCard(
                        title: "admin.schemaDrift.fingerprintCurrent",
                        fingerprint: drift.current,
                        generatedAt: nil
                    )
                    SchemaDriftFingerprintCard(
                        title: "admin.schemaDrift.fingerprintExpected",
                        fingerprint: drift.expected,
                        generatedAt: drift.expectedGeneratedAt
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.schemaDrift.fingerprintTitle"))
    }
}

// MARK: - Fingerprint card (web `FingerprintCard`)

/// Web `FingerprintCard`: the fingerprint title, the SHA-256 (monospace, em-dash when
/// empty), the three count stats (Tables / Columns / Indexes), and an optional capture
/// timestamp for the seed fingerprint.
struct SchemaDriftFingerprintCard: View {
    let title: LocalizedStringKey
    let fingerprint: SchemaFingerprint
    let generatedAt: String?

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: fingerprint.sha256.isEmpty ? SchemaDriftFormat.emptyValue : fingerprint.sha256)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text("admin.schemaDrift.fingerprintTitle"))
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    SchemaDriftFingerprintStat(label: "admin.schemaDrift.tables", value: fingerprint.tableCount)
                    SchemaDriftFingerprintStat(label: "admin.schemaDrift.columns", value: fingerprint.columnCount)
                    SchemaDriftFingerprintStat(label: "admin.schemaDrift.indexes", value: fingerprint.indexCount)
                }
                if let generatedAt {
                    TSCaption(capturedCaption(generatedAt))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `Captured {{when}}` resolved through the catalog (`"Captured %@"`) with the
    /// display-formatted capture time.
    private func capturedCaption(_ iso: String) -> LocalizedStringKey {
        "\(String(format: String(localized: "admin.schemaDrift.generatedAt"), SchemaDriftFormat.dateTime(iso)))"
    }
}

// MARK: - Fingerprint count stat (web `FingerprintStat`)

/// Web `FingerprintStat`: one count value over its label. Drives the Tables / Columns /
/// Indexes parity items inside each fingerprint card.
struct SchemaDriftFingerprintStat: View {
    let label: LocalizedStringKey
    let value: Int

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: SchemaDriftFormat.number(value))
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            TSCaption(label)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Status badge (web `Badge` with AlertTriangle / CheckCircle2)

/// Web drift-status `Badge`: a tinted chip with a leading icon and label. Drifted maps
/// to the warning tone + triangle (web `AlertTriangle`); clean maps to the success tone
/// + check (web `CheckCircle2`).
struct SchemaDriftStatusBadge: View {
    let isDrifted: Bool

    var body: some View {
        let tone: TSTone = isDrifted ? .warning : .success
        let symbol = isDrifted ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"
        let label: LocalizedStringKey = isDrifted
            ? "admin.schemaDrift.statusDrifted"
            : "admin.schemaDrift.statusClean"
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: symbol).font(.caption2)
            Text(label).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(label))
    }
}
