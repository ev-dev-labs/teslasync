import Foundation

/// Pure display-boundary formatters for the Weekly Digest (web `numberFormat` `fmtNumber` / `fmtInt`
/// + `useFormatting().formatCurrency`). The digest values are already in display units (km, kWh, Wh,
/// minutes, %), so these only format — no SI conversion happens on this legacy surface (web parity,
/// matching the sibling `SummaryHeroCards` formatting layer). Foundation-only + testable.
public enum WeeklyDigestFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits. A non-finite input
    /// formats as `0` (web `safeNumber` coercion), never "nan".
    public static func number(_ value: Double, decimals: Int) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)`.
    public static func int(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Web `formatCurrency(amount, decimals)` → `${currencySymbol}${fmtNumber(amount, decimals)}`
    /// (default symbol `$`, matching the web `useFormatting` fallback + the sibling `SummaryHeroCards`).
    public static func currency(_ amount: Double, decimals: Int, symbol: String = "$") -> String {
        symbol + number(amount, decimals: decimals)
    }

    /// Web `${fmtNumber(value, decimals)}%`.
    public static func percent(_ value: Double, decimals: Int = 1) -> String {
        "\(number(value, decimals: decimals))%"
    }

    /// Web `${fmtInt(floor(totalDuration / 60))}h ${fmtInt(totalDuration % 60)}m` — minutes split into
    /// whole hours + remaining minutes.
    public static func drivingTime(minutes: Double) -> String {
        let safe = minutes.isFinite ? minutes : 0
        let hours = (safe / 60).rounded(.down)
        let remainder = safe.truncatingRemainder(dividingBy: 60)
        return "\(int(hours))h \(int(remainder))m"
    }
}
