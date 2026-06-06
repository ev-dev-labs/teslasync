namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Canonical severity used by <c>TsSeverityBadge</c> / <c>TsStatusDot</c>
/// (port of the web <c>Severity</c> union). Any incoming wire string is mapped
/// onto one of these via <see cref="SeverityLevels.Normalize"/>.
/// </summary>
public enum SeverityLevel
{
    Info,
    Warn,
    Critical,
    Success,
}

/// <summary>Presentation tokens for a severity (port of web <c>severityTokens</c>).</summary>
/// <param name="Level">The canonical level.</param>
/// <param name="Label">Lower-case canonical label ("info", "warn", "critical", "success").</param>
/// <param name="IconGlyph">Segoe Fluent / MDL2 glyph approximating the web Lucide icon.</param>
/// <param name="AccentBrushKey">Token brush key for the icon / accent.</param>
public readonly record struct SeverityTokens(SeverityLevel Level, string Label, string IconGlyph, string AccentBrushKey);

/// <summary>Severity normalization + token lookup (port of web <c>tokens.ts</c>).</summary>
public static class SeverityLevels
{
    /// <summary>
    /// Map any incoming string (including legacy 'warning', 'error', 'fatal',
    /// 'ok' aliases) onto the canonical <see cref="SeverityLevel"/>. Null / empty
    /// and anything unrecognised fall back to <see cref="SeverityLevel.Info"/>.
    /// </summary>
    public static SeverityLevel Normalize(string? s)
    {
        if (string.IsNullOrWhiteSpace(s))
        {
            return SeverityLevel.Info;
        }

        string v = s.Trim().ToLowerInvariant();
        return v switch
        {
            "warning" or "warn" => SeverityLevel.Warn,
            "error" or "fatal" or "critical" => SeverityLevel.Critical,
            "ok" or "success" => SeverityLevel.Success,
            "info" => SeverityLevel.Info,
            _ => SeverityLevel.Info,
        };
    }

    /// <summary>Look up presentation tokens for a canonical level.</summary>
    public static SeverityTokens Tokens(SeverityLevel level) => level switch
    {
        // Segoe Fluent / MDL2 glyphs: Info, Warning, ErrorBadge, Completed.
        SeverityLevel.Info => new(level, "info", "\uE946", "TsColorInfoBrush"),
        SeverityLevel.Warn => new(level, "warn", "\uE7BA", "TsColorWarningBrush"),
        SeverityLevel.Critical => new(level, "critical", "\uEA39", "TsColorDangerBrush"),
        SeverityLevel.Success => new(level, "success", "\uE930", "TsColorSuccessBrush"),
        _ => new(SeverityLevel.Info, "info", "\uE946", "TsColorInfoBrush"),
    };

    /// <summary>Convenience: normalize a wire string straight to its tokens.</summary>
    public static SeverityTokens TokensFor(string? wire) => Tokens(Normalize(wire));
}
