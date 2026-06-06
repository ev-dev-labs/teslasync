import Foundation
import SwiftUI

// Formatters that don't need the KMP facade (no SI unit conversion): currency,
// plain numbers, percentages, dates, SI-native electrical units, and ranges.
// Each renders an em dash for nil/non-finite input (never "nan").

/// Currency amount (web `Currency`).
public struct TSCurrency: View {
    private let amount: Double?
    private let code: String

    public init(_ amount: Double?, code: String = "USD") {
        self.amount = amount
        self.code = code
    }

    public var body: some View {
        Text(verbatim: Self.format(amount, code: code)).monospacedDigit()
    }

    static func format(_ amount: Double?, code: String) -> String {
        guard let amount, amount.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        return formatter.string(from: NSNumber(value: amount)) ?? "—"
    }
}

/// Grouped decimal number (web `FormattedNumber`).
public struct TSFormattedNumber: View {
    private let value: Double?
    private let fractionDigits: Int

    public init(_ value: Double?, fractionDigits: Int = 0) {
        self.value = value
        self.fractionDigits = fractionDigits
    }

    public var body: some View {
        Text(verbatim: Self.format(value, fractionDigits: fractionDigits)).monospacedDigit()
    }

    static func format(_ value: Double?, fractionDigits: Int) -> String {
        guard let value, value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? "—"
    }
}

/// Percentage from a 0...1 fraction (web `Percentage`).
public struct TSPercentage: View {
    private let fraction: Double?

    public init(_ fraction: Double?) {
        self.fraction = fraction
    }

    public var body: some View {
        Text(verbatim: Self.format(fraction)).monospacedDigit()
    }

    static func format(_ fraction: Double?) -> String {
        guard let fraction, fraction.isFinite else { return "—" }
        return String(format: "%.0f%%", fraction * 100)
    }
}

/// Voltage (SI volts, no conversion) (web `Voltage`).
public struct TSVoltage: View {
    private let volts: Double?

    public init(_ volts: Double?) {
        self.volts = volts
    }

    public var body: some View {
        Text(verbatim: Self.unitValue(volts, suffix: "V")).monospacedDigit()
    }

    static func unitValue(_ value: Double?, suffix: String) -> String {
        guard let value, value.isFinite else { return "—" }
        return "\(String(format: "%.1f", value)) \(suffix)"
    }
}

/// Current (SI amps, no conversion) (web `Current`).
public struct TSCurrent: View {
    private let amps: Double?

    public init(_ amps: Double?) {
        self.amps = amps
    }

    public var body: some View {
        Text(verbatim: TSVoltage.unitValue(amps, suffix: "A")).monospacedDigit()
    }
}

/// Localized date/time (web `DateTime`).
public struct TSDateTime: View {
    private let date: Date?
    private let dateStyle: DateFormatter.Style
    private let timeStyle: DateFormatter.Style

    public init(_ date: Date?, dateStyle: DateFormatter.Style = .medium, timeStyle: DateFormatter.Style = .short) {
        self.date = date
        self.dateStyle = dateStyle
        self.timeStyle = timeStyle
    }

    public var body: some View {
        Text(verbatim: formatted)
    }

    private var formatted: String {
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.dateStyle = dateStyle
        formatter.timeStyle = timeStyle
        return formatter.string(from: date)
    }
}

/// A min–max range of two pre-formatted values (web `Range`).
public struct TSRange: View {
    private let lower: String
    private let upper: String

    public init(lower: String, upper: String) {
        self.lower = lower
        self.upper = upper
    }

    public var body: some View {
        Text(verbatim: "\(lower) – \(upper)")
            .monospacedDigit()
            .accessibilityLabel(Text("range.fromTo \(lower) \(upper)"))
    }
}
