import SwiftUI

// Typography components mirroring the web `components/ui` text roles, backed by
// the generated `Font.TS` ramp + `Color.TS` semantic colors. Each takes
// caller-provided content (LocalizedStringKey for prose, String for values) so
// no user-facing strings are hardcoded here.

/// Section/heading text with a configurable level; marked as an accessibility header.
public struct TSHeading: View {
    public enum Level { case h1, h2, h3 }

    private let text: LocalizedStringKey
    private let level: Level

    public init(_ text: LocalizedStringKey, level: Level = .h1) {
        self.text = text
        self.level = level
    }

    private var font: Font {
        switch level {
        case .h1: Font.TS.display
        case .h2: Font.TS.title
        case .h3: Font.TS.section
        }
    }

    public var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Primary page title (largest role).
public struct TSPageTitle: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.display)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Section title within a page.
public struct TSSectionTitle: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.section)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Title for a panel/card.
public struct TSPanelTitle: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Secondary heading / subhead.
public struct TSSubhead: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.bodySm)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

/// Body copy with an optional smaller variant.
public struct TSText: View {
    public enum Variant { case body, small }

    private let text: LocalizedStringKey
    private let variant: Variant

    public init(_ text: LocalizedStringKey, variant: Variant = .body) {
        self.text = text
        self.variant = variant
    }

    public var body: some View {
        Text(text)
            .font(variant == .small ? Font.TS.bodySm : Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
    }
}

/// De-emphasized caption text.
public struct TSCaption: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }
}

/// Helper text shown under form controls.
public struct TSHelperText: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

/// Inline error/validation text.
public struct TSErrorText: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger)
            .accessibilityAddTraits(.isStaticText)
    }
}

/// Field/label text (uppercased tracking role).
public struct TSLabel: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

/// Large numeric metric value (caller pre-formats; rendered verbatim, mono digits).
public struct TSMetricValue: View {
    private let value: String
    public init(_ value: String) {
        self.value = value
    }

    public var body: some View {
        Text(verbatim: value)
            .font(Font.TS.title)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
    }
}

/// Label under a metric value.
public struct TSMetricLabel: View {
    private let text: LocalizedStringKey
    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }
}

/// Inline monospaced code/value chip (rendered verbatim).
public struct TSCode: View {
    private let value: String
    public init(_ value: String) {
        self.value = value
    }

    public var body: some View {
        Text(verbatim: value)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }
}

#if DEBUG
    #Preview("Typography") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSPageTitle("page.title")
            TSSectionTitle("section.title")
            TSText("body.copy")
            TSCaption("caption.text")
            TSMetricValue("42.5")
            TSCode("vehicle_id")
        }
        .padding()
    }
#endif
