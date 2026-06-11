using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A custom value formatter — the native analogue of the web <c>valueFormatter</c> prop on
/// <c>ChartTooltip</c> (web/src/components/charts/ChartTooltip.tsx). Receives the raw value plus the series
/// name and optional unit and returns the rendered string. When a host supplies one it fully replaces the
/// default number/unit composition (exactly as the web prop replaces <c>defaultValueFormatter</c>, including
/// its unit span), so the surface renders the returned text verbatim with no separate dimmed unit.
/// </summary>
public delegate string ChartTooltipValueFormatter(object? value, string name, string? unit);

/// <summary>
/// A custom label formatter — the native analogue of the web <c>labelFormatter</c> prop on
/// <c>ChartTooltip</c>. Receives the active label (the recharts category / x value) and returns the rendered
/// header string, replacing the default ISO-detection logic.
/// </summary>
public delegate string ChartTooltipLabelFormatter(object? label);

/// <summary>
/// Renders a parsed timestamp to a display string — the native seam for the web <c>formatDateTime</c> call
/// the default label formatter makes (web/src/lib/dateFormat.ts). The production default
/// (<see cref="ChartTooltipFormatting.FormatTimestamp"/>) is locale + local-timezone aware, mirroring the web
/// helper; tests inject a deterministic formatter so the ISO-detection routing is verified without a
/// timezone dependency.
/// </summary>
public delegate string ChartTooltipTimestampFormatter(DateTimeOffset value);

/// <summary>
/// One entry of the tooltip payload — the native port of the web <c>TooltipPayload</c> interface
/// (web/src/components/charts/ChartTooltip.tsx). Recharts hands the custom tooltip an array of these for the
/// hovered domain position; each carries the series <see cref="Name"/>, the raw <see cref="Value"/>
/// (<c>unknown</c> in the web source, so <see cref="object"/> here), the optional <see cref="Unit"/> suffix,
/// the series <see cref="Color"/> / <see cref="Fill"/> (line/area vs bar) and the <see cref="DataKey"/>
/// recharts attaches.
/// </summary>
public readonly record struct ChartTooltipPoint(
    string Name,
    object? Value,
    string? Unit = null,
    string? Color = null,
    string? Fill = null,
    object? DataKey = null)
{
    /// <summary>
    /// The swatch colour for this row — the web <c>p.color || p.fill</c> truthy fallback (an empty colour
    /// falls through to the fill), so a line/area series uses its stroke colour and a bar series its fill.
    /// </summary>
    public string? SwatchColorHex => string.IsNullOrEmpty(Color) ? Fill : Color;
}

/// <summary>
/// Pure formatting helpers for the chart tooltip — the native port of the module-level functions in
/// <c>web/src/components/charts/ChartTooltip.tsx</c> (<c>isIsoTimestamp</c>, <c>defaultLabelFormatter</c>,
/// <c>defaultValueFormatter</c>) together with the <c>fmtNumber</c> / <c>formatDateTime</c> behaviour the web
/// component delegates to (web/src/lib/numberFormat.ts, web/src/lib/dateFormat.ts). Kept static and
/// side-effect-free so every branch is unit-testable without a view-model or a UI thread; the
/// <see cref="ChartTooltipProjection"/> and the WinUI view both render from these.
/// </summary>
public static class ChartTooltipFormatting
{
    /// <summary>
    /// Default fraction digits for a numeric value — the web <c>fmtNumber</c> global precision default
    /// (<c>_globalPrecision = 2</c> in web/src/lib/numberFormat.ts).
    /// </summary>
    public const int DefaultPrecision = 2;

    /// <summary>
    /// The em-dash returned for an ISO-looking but unparseable label — the web <c>formatDateTime</c> fallback
    /// (<c>FALLBACK = '—'</c> in web/src/lib/dateFormat.ts) for an invalid date.
    /// </summary>
    public const string EmDashFallback = "\u2014";

    /// <summary>
    /// Whether <paramref name="value"/> looks like an ISO 8601 timestamp — the native port of the web
    /// heuristic <c>ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/</c> (web/src/components/charts/ChartTooltip.tsx).
    /// Requires at least <c>YYYY-MM-DDTHH:MM</c> so plain date strings ("Apr 4") and clock labels ("14:30")
    /// do not trip the date formatter. Implemented as a positional digit/separator check to avoid a regex
    /// dependency while matching the web pattern exactly.
    /// </summary>
    public static bool LooksLikeIsoTimestamp(string? value)
    {
        if (value is null || value.Length < 16)
        {
            return false;
        }

        ReadOnlySpan<char> s = value;
        return IsDigit(s[0]) && IsDigit(s[1]) && IsDigit(s[2]) && IsDigit(s[3])
            && s[4] == '-'
            && IsDigit(s[5]) && IsDigit(s[6])
            && s[7] == '-'
            && IsDigit(s[8]) && IsDigit(s[9])
            && s[10] == 'T'
            && IsDigit(s[11]) && IsDigit(s[12])
            && s[13] == ':'
            && IsDigit(s[14]) && IsDigit(s[15]);
    }

    /// <summary>
    /// Format a number with locale-aware grouping and a fixed fraction-digit count — the native port of the
    /// web <c>fmtNumber</c> (web/src/lib/numberFormat.ts): non-finite input collapses to zero (the web
    /// <c>safeNumber</c>), the precision is clamped to 0..20, and en-US / invariant grouping is used (the web
    /// default locale). At the default precision <c>1234.5</c> renders as <c>"1,234.50"</c>.
    /// </summary>
    public static string FormatNumber(double value, int precision = DefaultPrecision)
    {
        double safe = double.IsNaN(value) || double.IsInfinity(value) ? 0d : value;
        int digits = Math.Clamp(precision, 0, 20);

        // Match the web fmtNumber / Intl.NumberFormat default rounding (halfExpand = round half away from
        // zero), which differs from .NET's banker's rounding in "N" formatting at the .5 boundary.
        double rounded = digits <= 15 ? Math.Round(safe, digits, MidpointRounding.AwayFromZero) : safe;
        return rounded.ToString("N" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Render an ISO timestamp to the web <c>formatDateTime</c> shape ("Apr 4, 2026, 2:30 AM") in the local
    /// time zone — the production default behind <see cref="ChartTooltipTimestampFormatter"/>. Locale-stable
    /// (invariant month names) and timezone-aware (local), mirroring the web helper's browser-locale +
    /// browser-timezone default.
    /// </summary>
    public static string FormatTimestamp(DateTimeOffset value) =>
        value.ToLocalTime().ToString("MMM d, yyyy, h:mm tt", CultureInfo.InvariantCulture);

    /// <summary>
    /// The default value text for a payload point — the <c>formatted</c> half of the web
    /// <c>defaultValueFormatter</c>: a numeric value goes through <see cref="FormatNumber"/> (web
    /// <c>fmtNumber</c>), anything else through <c>String(value ?? '')</c>. The unit is carried separately by
    /// the projection so the view can render it dimmed (the web <c>opacity-60</c> span).
    /// </summary>
    public static string DefaultValue(object? value)
    {
        if (TryGetNumber(value, out double number))
        {
            return FormatNumber(number);
        }

        return value?.ToString() ?? string.Empty;
    }

    /// <summary>
    /// The default header text for the tooltip — the native port of the web <c>defaultLabelFormatter</c>: a
    /// null label is empty, an ISO-timestamp string is rendered through <paramref name="timestampFormatter"/>
    /// (the web <c>formatDateTime</c>; an unparseable-but-ISO-looking value yields <see cref="EmDashFallback"/>),
    /// and anything else passes through <c>String(label)</c> verbatim — preserving the existing "HH:MM" string
    /// and numeric labels other charts rely on.
    /// </summary>
    public static string DefaultLabel(object? label, ChartTooltipTimestampFormatter timestampFormatter)
    {
        ArgumentNullException.ThrowIfNull(timestampFormatter);

        if (label is null)
        {
            return string.Empty;
        }

        if (label is string text && LooksLikeIsoTimestamp(text))
        {
            return DateTimeOffset.TryParse(
                text,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out DateTimeOffset parsed)
                ? timestampFormatter(parsed)
                : EmDashFallback;
        }

        return Convert.ToString(label, CultureInfo.InvariantCulture) ?? string.Empty;
    }

    private static bool IsDigit(char c) => c is >= '0' and <= '9';

    private static bool TryGetNumber(object? value, out double number)
    {
        switch (value)
        {
            case double d: number = d; return true;
            case float f: number = f; return true;
            case int i: number = i; return true;
            case long l: number = l; return true;
            case short s: number = s; return true;
            case byte b: number = b; return true;
            case sbyte sb: number = sb; return true;
            case uint ui: number = ui; return true;
            case ushort us: number = us; return true;
            case ulong ul: number = ul; return true;
            case decimal m: number = (double)m; return true;
            default: number = 0d; return false;
        }
    }
}
