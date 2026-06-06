using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Resolves generated design-token resources (see
/// <c>apps/design/generated/windows/Tokens.xaml</c>) for the code-built
/// data-display controls. Centralised so every control tints from the same
/// token keys and light/dark/high-contrast all flow from W1 without ad-hoc
/// hex colours in the control layer.
/// </summary>
internal static class DisplayTokens
{
    /// <summary>Resolve a brush resource key, falling back to a transparent brush.</summary>
    public static Brush Brush(string key)
    {
        if (Application.Current?.Resources is { } res && res.TryGetValue(key, out object? value) && value is Brush b)
        {
            return b;
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    /// <summary>Resolve a <see cref="CornerRadius"/> token, defaulting to <paramref name="fallback"/>.</summary>
    public static CornerRadius Radius(string key, double fallback)
    {
        if (Application.Current?.Resources is { } res && res.TryGetValue(key, out object? value))
        {
            if (value is CornerRadius cr)
            {
                return cr;
            }

            if (value is double d)
            {
                return new CornerRadius(d);
            }
        }

        return new CornerRadius(fallback);
    }

    /// <summary>Primary text brush.</summary>
    public static Brush TextPrimary => Brush("TsColorTextPrimaryBrush");

    /// <summary>Secondary text brush.</summary>
    public static Brush TextSecondary => Brush("TsColorTextSecondaryBrush");

    /// <summary>Muted text brush.</summary>
    public static Brush TextMuted => Brush("TsColorTextMutedBrush");

    /// <summary>Card / panel surface brush.</summary>
    public static Brush Surface => Brush("TsColorSurfaceBrush");

    /// <summary>Hairline border brush.</summary>
    public static Brush Border => Brush("TsColorBorderBrush");

    /// <summary>Accent brush.</summary>
    public static Brush Accent => Brush("TsColorAccentBrush");
}
