import SwiftUI

/// Redacted shimmer skeleton block (web `Skeleton`). Shimmer respects Reduce Motion.
public struct TSSkeleton: View {
    private let width: CGFloat?
    private let height: CGFloat
    private let cornerRadius: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmer = false

    public init(width: CGFloat? = nil, height: CGFloat = 14, cornerRadius: CGFloat = TSRadius.sm) {
        self.width = width
        self.height = height
        self.cornerRadius = cornerRadius
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geo in
                        LinearGradient(
                            colors: [.clear, Color.TS.surface.opacity(0.7), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geo.size.width * 0.4)
                        .offset(x: shimmer ? geo.size.width : -geo.size.width * 0.4)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { shimmer = true }
            }
            .accessibilityHidden(true)
    }
}

/// Stat-card skeleton (web `StatSkeleton`).
public struct TSStatSkeleton: View {
    public init() {}
    public var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 80, height: 10)
                TSSkeleton(width: 120, height: 24)
            }
        }
    }
}

/// Chart skeleton block (web `ChartSkeleton`).
public struct TSChartSkeleton: View {
    private let height: CGFloat
    public init(height: CGFloat = 180) {
        self.height = height
    }

    public var body: some View {
        TSSkeleton(height: height, cornerRadius: TSRadius.md)
    }
}

/// Page header skeleton (web `PageHeaderSkeleton`).
public struct TSPageHeaderSkeleton: View {
    public init() {}
    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 220, height: 28)
            TSSkeleton(width: 320, height: 12)
        }
    }
}

/// Grid of stat skeletons (web `StatGridSkeleton`).
public struct TSStatGridSkeleton: View {
    private let count: Int
    public init(count: Int = 4) {
        self.count = count
    }

    public var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2),
            spacing: TSSpacing.md
        ) {
            ForEach(0 ..< count, id: \.self) { _ in TSStatSkeleton() }
        }
    }
}

/// Titled chart block skeleton (web `ChartBlockSkeleton`).
public struct TSChartBlockSkeleton: View {
    public init() {}
    public var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 160, height: 16)
                TSChartSkeleton()
            }
        }
    }
}

/// Table skeleton with rows (web `TableSkeleton`).
public struct TSTableSkeleton: View {
    private let rows: Int
    public init(rows: Int = 6) {
        self.rows = rows
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< rows, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 24, height: 24, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 80, height: 12)
                }
            }
        }
    }
}

/// Whole-page load skeleton (web `PageLoadSkeleton`).
public struct TSPageLoadSkeleton: View {
    public init() {}
    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSPageHeaderSkeleton()
            TSStatGridSkeleton()
            TSChartBlockSkeleton()
        }
    }
}
