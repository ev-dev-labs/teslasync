import SwiftUI

// MARK: - Loading skeleton (web `Skeleton` loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the header,
/// overview, and list blocks under SwiftUI redaction (the manifest's `loading →
/// redacted(reason:)`).
struct ChargingListSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            block(height: 64)
            block(height: 200)
            block(height: 160)
            ForEach(0 ..< 4, id: \.self) { _ in block(height: 72) }
        }
        .chargingRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("charging.list.title"))
    }

    private func block(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func chargingRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
