import SwiftUI

// The page chrome bits for the Route Efficiency surface that aren't data panels: the date-range
// control (web `RangePicker`) and the redacted loading scaffold (web `PageContainer loading`). The
// data panels live in `RouteEfficiencyPage.Panels.swift`; the comparison chart in
// `RouteEfficiencyPage.Charts.swift`.

// MARK: - Date range control (web `RangePicker`)

/// The date-range filter (web `RangePicker`): native start/end `DatePicker`s that report the new
/// window back to the model. SwiftUI announces each selected date, so no redundant text label.
struct RouteEfficiencyRangeControl: View {
    let startDate: Date
    let endDate: Date
    let onChange: (Date, Date) -> Void

    @State private var start: Date
    @State private var end: Date

    init(startDate: Date, endDate: Date, onChange: @escaping (Date, Date) -> Void) {
        self.startDate = startDate
        self.endDate = endDate
        self.onChange = onChange
        _start = State(initialValue: startDate)
        _end = State(initialValue: endDate)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DatePicker(selection: $start, in: ...end, displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: start) { _, newValue in onChange(newValue, end) }
            Text(verbatim: "–")
                .foregroundStyle(Color.TS.textMuted)
            DatePicker(selection: $end, in: start..., displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: end) { _, newValue in onChange(start, newValue) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("routeEfficiency.col.route"))
    }
}

// MARK: - Loading skeleton (web PageContainer `loading`)

/// The redacted loading scaffold (web `PageContainer loading` → Skeleton): blocks mirroring the
/// summary, comparison chart, route-card grid, and metrics panels.
struct RouteEfficiencySkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            block(height: 120)
            block(height: 260)
            grid(count: 4, height: 150)
            block(height: 180)
        }
        .redacted(reason: .placeholder) // parity:allow SwiftUI redaction API, not a stub
        .accessibilityElement()
        .accessibilityLabel(Text("routeEfficiency.title"))
    }

    private func block(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(height: height)
    }

    private func grid(count: Int, height: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: height)
            }
        }
    }
}
