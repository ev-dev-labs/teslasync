import SwiftUI

/// The adaptive rotation-status table for `SecretRotationPage` (web `DataTable`): a
/// columnar grid on macOS / iPad regular width and per-secret cards on compact iPhone
/// width. Reproduces the six web columns — Kind (+ target id), Last rotated (+ relative),
/// Age in days, Expires (+ days remaining), Warn / critical thresholds, and the severity
/// badge. Kept as a dedicated surface (mirroring `DiskForecastPage.Table`) so the page
/// file stays focused on chrome + states. All copy resolves from `Localizable.xcstrings`.
struct SecretRotationTable: View {
    let rows: [SecretRotationStatus]

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

    var body: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                ForEach(rows) { secretCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("admin.secretRotation.colKind").gridColumnAlignment(.leading)
                header("admin.secretRotation.colRotated").gridColumnAlignment(.leading)
                header("admin.secretRotation.colAge").gridColumnAlignment(.trailing)
                header("admin.secretRotation.colExpiry").gridColumnAlignment(.leading)
                header("admin.secretRotation.colThresholds").gridColumnAlignment(.trailing)
                header("admin.secretRotation.colSeverity").gridColumnAlignment(.trailing)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(6)
            ForEach(rows) { row in
                GridRow {
                    kindCell(row)
                    rotatedCell(row)
                    numericCell(SecretRotationFormat.number(row.ageDays))
                    expiryCell(row)
                    numericCell(SecretRotationFormat.thresholds(warnDays: row.warnDays, criticalDays: row.criticalDays))
                    SecretRotationSeverityBadge(severity: row.severity)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(6)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Cells

    private func kindCell(_ row: SecretRotationStatus) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: Self.kindLabel(row.kind))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            if let targetID = row.targetID, !targetID.isEmpty {
                Text(verbatim: targetID)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private func rotatedCell(_ row: SecretRotationStatus) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: SecretRotationFormat.dateTime(row.lastRotated))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: SecretRotationFormat.relative(row.lastRotated))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    @ViewBuilder
    private func expiryCell(_ row: SecretRotationStatus) -> some View {
        if let expiresAt = row.expiresAt {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: SecretRotationFormat.dateTime(expiresAt))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                if let days = row.daysToExpiry {
                    Text(verbatim: Self.daysToExpiryText(days))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        } else {
            Text(verbatim: SecretRotationFormat.emptyValue)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private func numericCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    // MARK: - Compact (iPhone) cards

    private func secretCard(_ row: SecretRotationStatus) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    kindCell(row)
                    Spacer(minLength: TSSpacing.sm)
                    SecretRotationSeverityBadge(severity: row.severity)
                }
                stackedRow(
                    "admin.secretRotation.colRotated",
                    primary: SecretRotationFormat.dateTime(row.lastRotated),
                    secondary: SecretRotationFormat.relative(row.lastRotated)
                )
                labeledRow("admin.secretRotation.colAge", SecretRotationFormat.number(row.ageDays))
                expiryRow(row)
                labeledRow(
                    "admin.secretRotation.colThresholds",
                    SecretRotationFormat.thresholds(warnDays: row.warnDays, criticalDays: row.criticalDays)
                )
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func labeledRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    private func stackedRow(_ label: LocalizedStringKey, primary: String, secondary: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: primary)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                if let secondary, !secondary.isEmpty {
                    Text(verbatim: secondary)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @ViewBuilder
    private func expiryRow(_ row: SecretRotationStatus) -> some View {
        if let expiresAt = row.expiresAt {
            stackedRow(
                "admin.secretRotation.colExpiry",
                primary: SecretRotationFormat.dateTime(expiresAt),
                secondary: row.daysToExpiry.map(Self.daysToExpiryText)
            )
        } else {
            labeledRow("admin.secretRotation.colExpiry", SecretRotationFormat.emptyValue)
        }
    }

    // MARK: - Verbatim status / interpolated cell strings (web maps + i18next `{{token}}`)

    /// Web `KIND_LABELS` map (a hardcoded friendly-name map, rendered verbatim like the
    /// sibling page's status tokens; unknown kinds fall back to the raw server value).
    static func kindLabel(_ raw: String) -> String {
        switch raw {
        case "tesla_refresh_token": "Tesla refresh token"
        case "mqtt_mtls_cert": "MQTT mTLS certificate"
        case "database_password": "Database password"
        case "session_jwk": "Session JWK"
        case "app_signing_key": "App signing key"
        case "authentik_secret": "Authentik client secret"
        default: raw
        }
    }

    /// Resolves `admin.secretRotation.daysToExpiry` ("%lldd remaining") with the count.
    static func daysToExpiryText(_ days: Int) -> String {
        String(format: String(localized: "admin.secretRotation.daysToExpiry"), days)
    }
}

/// The severity badge (web `Badge` + `SEVERITY_VARIANT` / `SEVERITY_LABEL`). The label
/// tokens are the web's hardcoded status map (OK / Rotate soon / Overdue / —), rendered
/// verbatim like the sibling Disk Forecast severity badge; the tone maps to the shared
/// status tokens.
struct SecretRotationSeverityBadge: View {
    let severity: SecretRotationSeverity

    var body: some View {
        let tone = Self.tone(severity)
        return Text(verbatim: Self.label(severity))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: Self.label(severity)))
    }

    /// Web `SEVERITY_VARIANT` (ok→success, warn→warning, critical→danger, unknown→neutral).
    static func tone(_ severity: SecretRotationSeverity) -> TSTone {
        switch severity {
        case .ok: .success
        case .warn: .warning
        case .critical: .danger
        case .unknown: .neutral
        }
    }

    /// Web `SEVERITY_LABEL` (a hardcoded status-token map).
    static func label(_ severity: SecretRotationSeverity) -> String {
        switch severity {
        case .ok: "OK"
        case .warn: "Rotate soon"
        case .critical: "Overdue"
        case .unknown: "—"
        }
    }
}
