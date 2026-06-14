import SwiftUI

/// The success status badge (web `Badge` — `Fail` / `OK` / `—`). The labels are the
/// web's hardcoded status tokens, rendered verbatim like the sibling Disk Forecast
/// severity badge; the tone maps to the shared status tokens.
struct AuditSuccessBadge: View {
    let success: Bool?

    var body: some View {
        let tone = Self.tone(success)
        return Text(verbatim: Self.label(success))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: Self.label(success)))
    }

    /// Web `success === false → danger`, `success === true → success`, else `neutral`.
    static func tone(_ success: Bool?) -> TSTone {
        switch success {
        case .some(true): .success
        case .some(false): .danger
        case .none: .neutral
        }
    }

    /// Web `Fail` / `OK` / `—` (hardcoded status tokens).
    static func label(_ success: Bool?) -> String {
        switch success {
        case .some(true): "OK"
        case .some(false): "Fail"
        case .none: "—"
        }
    }
}

/// Neutral category chip (web `<Badge variant="neutral">{category}</Badge>`). The
/// category is a server token, rendered verbatim.
struct AuditCategoryChip: View {
    let category: String

    var body: some View {
        Text(verbatim: category)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}
