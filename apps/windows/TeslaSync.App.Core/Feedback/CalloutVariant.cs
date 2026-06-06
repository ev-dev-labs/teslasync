namespace TeslaSync.App.Core.Feedback;

/// <summary>
/// Semantic emphasis for the banner / callout family (mirrors the web
/// <c>CalloutVariant</c> and <c>AlertBanner</c> tones). Drives the accent
/// colour, the leading glyph and the assistive-tech urgency.
/// </summary>
public enum CalloutVariant
{
    /// <summary>Neutral informational message.</summary>
    Info,

    /// <summary>Positive / confirming message.</summary>
    Success,

    /// <summary>Cautionary message that needs attention but is non-blocking.</summary>
    Warning,

    /// <summary>Error / destructive message.</summary>
    Danger,
}

/// <summary>
/// Maps a <see cref="CalloutVariant"/> to the token resource keys, default
/// Segoe Fluent glyph and the UI-Automation live-region urgency. Kept UI-free
/// so the mapping is unit-testable without a XAML runtime.
/// </summary>
public static class CalloutVariants
{
    /// <summary>Theme-aware accent brush key for the variant.</summary>
    public static string AccentBrushKey(CalloutVariant variant) => variant switch
    {
        CalloutVariant.Success => "TsColorSuccessBrush",
        CalloutVariant.Warning => "TsColorWarningBrush",
        CalloutVariant.Danger => "TsColorDangerBrush",
        _ => "TsColorInfoBrush",
    };

    /// <summary>Default leading Segoe Fluent Icons glyph for the variant.</summary>
    public static string Glyph(CalloutVariant variant) => variant switch
    {
        CalloutVariant.Success => "\uE73E", // Completed
        CalloutVariant.Warning => "\uE7BA", // Warning
        CalloutVariant.Danger => "\uEA39", // ErrorBadge
        _ => "\uE946", // Info
    };

    /// <summary>
    /// Whether the variant warrants an assertive (interrupting) live-region
    /// announcement. Danger interrupts; everything else is announced politely.
    /// </summary>
    public static bool IsAssertive(CalloutVariant variant) => variant == CalloutVariant.Danger;
}
