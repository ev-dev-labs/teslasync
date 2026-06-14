import SwiftUI

/// The service badge (web `<Badge variant={config.variant}>{config.label}</Badge>`). The
/// label is a verbatim brand string from `ApiLogsServiceCatalog`; the tone maps to the
/// shared status tokens. Rendered verbatim like the sibling Audit Log category chip.
struct ApiLogsServiceBadge: View {
    let service: String

    var body: some View {
        let config = ApiLogsServiceCatalog.service(service)
        return ApiLogsChip(text: config.label, tone: config.tone)
            .accessibilityLabel(Text(verbatim: config.label))
    }
}

/// The HTTP-method badge (web `<Badge variant={METHOD_VARIANTS[method]}>{method}</Badge>`).
/// The method token renders verbatim; the tone maps to the shared status tokens.
struct ApiLogsMethodBadge: View {
    let method: String

    var body: some View {
        ApiLogsChip(
            text: method.isEmpty ? ApiLogsFormat.emptyValue : method,
            tone: ApiLogsServiceCatalog.methodTone(method)
        )
        .accessibilityLabel(Text(verbatim: method))
    }
}

/// The status-code badge (web `<Badge variant={statusBadgeVariant(code)}>{code ?? 'N/A'}</Badge>`).
struct ApiLogsStatusBadge: View {
    let code: Int?

    var body: some View {
        ApiLogsChip(text: Self.label(code), tone: ApiLogsServiceCatalog.statusTone(code))
            .accessibilityLabel(Text(verbatim: Self.label(code)))
    }

    /// Web `log.status_code ?? 'N/A'` (verbatim status token).
    static func label(_ code: Int?) -> String {
        guard let code else { return "N/A" }
        return String(code)
    }
}

/// Shared tinted chip for the verbatim-text badges (web `Badge`). Kept local to the surface
/// so the dynamic, non-localized tokens (service labels, methods, status codes) render
/// without an i18n key, matching the shared `TSBadge` styling.
struct ApiLogsChip: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}
