import SwiftUI

// MARK: - Skeleton (web `DriveDetailSkeleton`)

/// The initial loading state (web `DriveDetailSkeleton`): redacted header + gauge + panel
/// shapes with a centered progress indicator, so the structure is recognizable while the drive
/// loads (ADR-011 — never a blank screen).
struct DriveDetailPageSkeleton: View {
    private let gaugeColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: "Mountain View → Palo Alto")
                    .font(Font.TS.title).fontWeight(.bold)
                Text(verbatim: "Rocinante · Jun 10, 2024")
                    .font(Font.TS.bodySm)
            }
            .driveSkeletonRedaction()
            TSGlassPanel {
                LazyVGrid(columns: gaugeColumns, spacing: TSSpacing.lg) {
                    ForEach(0 ..< 5, id: \.self) { _ in
                        Circle().fill(Color.TS.surface).frame(width: 120, height: 120)
                    }
                }
            }
            ForEach(0 ..< 3, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        Text(verbatim: "Section title").font(Font.TS.panel)
                        Text(verbatim: "A representative line of drive detail content for the skeleton state.")
                            .font(Font.TS.bodySm)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .driveSkeletonRedaction()
                }
            }
            ProgressView()
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("loading"))
        }
        .accessibilityLabel(Text("loading"))
    }
}

// MARK: - Skeleton redaction (manifest `loading → redacted(reason:)`)

private extension View {
    /// Applies the system skeleton redaction for the loading state. Isolated here so the
    /// SwiftUI redaction-reason API token is opted out of the stub scan on one line.
    func driveSkeletonRedaction() -> some View {
        redacted(reason: .placeholder) // parity:allow SwiftUI redaction API, not a stub
    }
}

// MARK: - Date text (web `DateTime` / `formatTime`)

/// Small date/time formatters for the header + timeline (web `DateTime variant=…`). Verbatim
/// device-formatted strings (not localized catalog keys), matching the web's locale-formatted
/// timestamps.
enum DriveDetailDateText {
    static func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
