using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Themes;

/// <summary>
/// Verification control for the generated design tokens. Beyond the compile-time
/// guarantee that every referenced token key exists, <see cref="FindMissingTokens"/>
/// resolves representative tokens across the Light, Dark (Default) and
/// HighContrast theme dictionaries so a smoke check can assert an empty result.
/// </summary>
public sealed partial class TokenVerification : UserControl
{
    private static readonly string[] InvariantKeys =
    [
        "TsTypeBodyFontSize",
        "TsRadiusMd",
        "TsChart01Brush",
        "TsSpaceLg",
        "TsMaterialRootBackdrop",
    ];

    private static readonly string[] ThemeNames = ["Default", "Light", "HighContrast"];

    private static readonly string[] ThemedKeys =
    [
        "TsColorBgBrush",
        "TsColorAccentBrush",
        "TsColorTextPrimaryBrush",
        "TsMaterialOverlayBrush",
        "TsAppRootBackgroundBrush",
    ];

    public TokenVerification()
    {
        InitializeComponent();
    }

    /// <summary>
    /// Returns the keys that fail to resolve. An empty list means the token
    /// system is wired correctly for every theme.
    /// </summary>
    public static IReadOnlyList<string> FindMissingTokens()
    {
        var missing = new List<string>();
        ResourceDictionary app = Application.Current.Resources;

        foreach (string key in InvariantKeys)
        {
            if (!ContainsDeep(app, key))
            {
                missing.Add($"invariant:{key}");
            }
        }

        foreach (string theme in ThemeNames)
        {
            foreach (string key in ThemedKeys)
            {
                if (!ContainsTheme(app, theme, key))
                {
                    missing.Add($"{theme}:{key}");
                }
            }
        }

        return missing;
    }

    private static bool ContainsDeep(ResourceDictionary dictionary, string key)
    {
        if (dictionary.ContainsKey(key))
        {
            return true;
        }

        foreach (ResourceDictionary merged in dictionary.MergedDictionaries)
        {
            if (ContainsDeep(merged, key))
            {
                return true;
            }
        }

        return false;
    }

    private static bool ContainsTheme(ResourceDictionary dictionary, string theme, string key)
    {
        if (dictionary.ThemeDictionaries.TryGetValue(theme, out object? value) &&
            value is ResourceDictionary themed &&
            ContainsDeep(themed, key))
        {
            return true;
        }

        foreach (ResourceDictionary merged in dictionary.MergedDictionaries)
        {
            if (ContainsTheme(merged, theme, key))
            {
                return true;
            }
        }

        return false;
    }
}
