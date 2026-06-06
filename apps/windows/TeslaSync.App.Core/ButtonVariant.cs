namespace TeslaSync.App.Core;

/// <summary>Visual emphasis variants for <c>TsButton</c>, mirroring the web
/// <c>Button</c> component (primary, secondary, subtle, outline, destructive,
/// icon).</summary>
public enum ButtonVariant
{
    Primary,
    Secondary,
    Subtle,
    Outline,
    Destructive,
    Icon,
}

/// <summary>Control sizing scale shared by buttons and inputs.</summary>
public enum ControlSize
{
    Small,
    Medium,
    Large,
}

/// <summary>Maps <see cref="ButtonVariant"/> to the XAML style key applied by
/// <c>TsButton</c>. UI-free so it can be asserted in unit tests.</summary>
public static class ButtonStyles
{
    public static string StyleKey(ButtonVariant variant) => variant switch
    {
        ButtonVariant.Primary => "TsButtonPrimaryStyle",
        ButtonVariant.Secondary => "TsButtonSecondaryStyle",
        ButtonVariant.Subtle => "TsButtonSubtleStyle",
        ButtonVariant.Outline => "TsButtonOutlineStyle",
        ButtonVariant.Destructive => "TsButtonDestructiveStyle",
        ButtonVariant.Icon => "TsButtonIconStyle",
        _ => "TsButtonPrimaryStyle",
    };

    /// <summary>Minimum touch/click height in effective pixels for a size.</summary>
    public static double MinHeight(ControlSize size) => size switch
    {
        ControlSize.Small => 32,
        ControlSize.Large => 48,
        _ => 40,
    };
}
