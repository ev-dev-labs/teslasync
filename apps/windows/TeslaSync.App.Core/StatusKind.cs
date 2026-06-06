namespace TeslaSync.App.Core;

/// <summary>
/// Semantic status used by <c>TsBadge</c>, <c>TsStatusPill</c> and input
/// validation states. Each member maps to a token-backed brush resource key
/// and a high-contrast-safe system fallback at the WinUI layer.
/// </summary>
public enum StatusKind
{
    Neutral,
    Info,
    Success,
    Warning,
    Danger,
}

/// <summary>
/// Resolves <see cref="StatusKind"/> values to the generated design-token
/// resource keys (see <c>apps/design/generated/windows/Tokens.xaml</c>). Kept
/// here, UI-free, so the mapping is unit-testable without a XAML runtime.
/// </summary>
public static class StatusResources
{
    /// <summary>Theme-aware foreground/accent brush key for a status.</summary>
    public static string AccentBrushKey(StatusKind kind) => kind switch
    {
        StatusKind.Info => "TsColorInfoBrush",
        StatusKind.Success => "TsColorSuccessBrush",
        StatusKind.Warning => "TsColorWarningBrush",
        StatusKind.Danger => "TsColorDangerBrush",
        _ => "TsColorTextSecondaryBrush",
    };

    /// <summary>Theme-aware color (non-brush) key for a status.</summary>
    public static string AccentColorKey(StatusKind kind) => kind switch
    {
        StatusKind.Info => "TsColorInfoColor",
        StatusKind.Success => "TsColorSuccessColor",
        StatusKind.Warning => "TsColorWarningColor",
        StatusKind.Danger => "TsColorDangerColor",
        _ => "TsColorTextSecondaryColor",
    };
}
