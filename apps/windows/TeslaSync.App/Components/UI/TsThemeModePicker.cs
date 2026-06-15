using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Settings;
using TeslaSync.App.SharedSurfaces.ThemeProviderSurface;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Accent-theme + display-mode picker — the native port of the web <c>ThemePicker</c> / mode selector
/// (<c>web/src/components/ui/ThemeProvider.tsx</c>). Presents the five accent palettes (plus the custom
/// pair) and the seven display modes as swatch buttons, reads the current selection from
/// <see cref="AppSettingsHost"/> and persists changes back through it; the shell's <c>ThemeApplier</c> then
/// republishes the resolved palette across the whole app. Self-contained — it depends only on the app
/// settings host and the shared <see cref="ThemeCatalog"/>/<see cref="ModeCatalog"/>, never on server data.
/// </summary>
public sealed partial class TsThemeModePicker : ContentControl
{
    private readonly List<(string Id, Border Chip)> _accentChips = new();
    private readonly List<(string Id, Border Chip)> _modeChips = new();

    /// <summary>Builds the picker, resolving its two section labels through the optional localizer.</summary>
    /// <param name="localizer">The i18n facade; when null the English fallbacks are used.</param>
    public TsThemeModePicker(ILocalizer? localizer = null)
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        string accentLabel = localizer?.GetString("settings.appearance.theme.accent", "Accent colour") ?? "Accent colour";
        string modeLabel = localizer?.GetString("settings.appearance.theme.mode", "Display mode") ?? "Display mode";

        var root = new StackPanel { Spacing = 12 };
        root.Children.Add(new Caption { Value = accentLabel });
        root.Children.Add(BuildAccentPicker());
        root.Children.Add(new Caption { Value = modeLabel });
        root.Children.Add(BuildModePicker());
        Content = root;
    }

    private StackPanel BuildAccentPicker()
    {
        _accentChips.Clear();
        string selected = AppSettingsHost.Current.AccentThemeId;
        return BuildSwatchRows(
            ThemeCatalog.Ids,
            perRow: 3,
            id =>
            {
                ColorTheme theme = ThemeCatalog.Resolve(id, ThemeCatalog.DefaultCustomPrimary, ThemeCatalog.DefaultCustomAccent);
                string webId = ThemeCatalog.ToWireId(id);
                return BuildSwatch(
                    webId,
                    theme.Name,
                    theme.Primary,
                    string.Equals(webId, selected, StringComparison.OrdinalIgnoreCase),
                    _accentChips,
                    OnAccentPicked);
            });
    }

    private StackPanel BuildModePicker()
    {
        _modeChips.Clear();
        string selected = AppSettingsHost.Current.ColorModeId;
        return BuildSwatchRows(
            ModeCatalog.Ids,
            perRow: 4,
            id =>
            {
                ModeTheme mode = ModeCatalog.Get(id);
                string webId = ModeCatalog.ToWireId(id);
                return BuildSwatch(
                    webId,
                    mode.Name,
                    mode.Background,
                    string.Equals(webId, selected, StringComparison.OrdinalIgnoreCase),
                    _modeChips,
                    OnModePicked);
            });
    }

    private void OnAccentPicked(string id)
    {
        _ = AppSettingsHost.Service.UpdateAsync(s => s with { AccentThemeId = id });
        UpdateSwatchSelection(_accentChips, id);
    }

    private void OnModePicked(string id)
    {
        _ = AppSettingsHost.Service.UpdateAsync(s => s with { ColorModeId = id });
        UpdateSwatchSelection(_modeChips, id);
    }

    private static void UpdateSwatchSelection(List<(string Id, Border Chip)> chips, string selectedId)
    {
        foreach ((string id, Border chip) in chips)
        {
            bool isSelected = string.Equals(id, selectedId, StringComparison.OrdinalIgnoreCase);
            chip.BorderBrush = isSelected ? DisplayTokens.Accent : DisplayTokens.Border;
            chip.BorderThickness = new Thickness(isSelected ? 3 : 1);
        }
    }

    private static StackPanel BuildSwatchRows<T>(IReadOnlyList<T> items, int perRow, Func<T, UIElement> build)
    {
        var outer = new StackPanel { Spacing = 8 };
        StackPanel? row = null;
        for (int i = 0; i < items.Count; i++)
        {
            if (i % perRow == 0)
            {
                row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                outer.Children.Add(row);
            }

            row!.Children.Add(build(items[i]));
        }

        return outer;
    }

    private static Button BuildSwatch(
        string id,
        string name,
        string colorHex,
        bool selected,
        List<(string Id, Border Chip)> registry,
        Action<string> onPick)
    {
        var chip = new Border
        {
            Width = 44,
            Height = 44,
            CornerRadius = new CornerRadius(10),
            Background = DisplayPrimitives.HexBrush(colorHex),
            BorderBrush = selected ? DisplayTokens.Accent : DisplayTokens.Border,
            BorderThickness = new Thickness(selected ? 3 : 1),
        };
        registry.Add((id, chip));

        var stack = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
        stack.Children.Add(chip);
        stack.Children.Add(new Caption { Value = name, HorizontalAlignment = HorizontalAlignment.Center });

        var button = new Button
        {
            Content = stack,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(6),
            MinWidth = 72,
        };
        AutomationProperties.SetName(button, name);
        button.Click += (_, _) => onPick(id);
        return button;
    }
}
