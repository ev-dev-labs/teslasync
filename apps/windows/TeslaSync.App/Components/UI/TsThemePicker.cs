using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>Theme choice surfaced by <see cref="TsThemePicker"/>.</summary>
public enum ThemeOption
{
    /// <summary>Follow the OS app-theme setting.</summary>
    System,

    /// <summary>Force the light token dictionary.</summary>
    Light,

    /// <summary>Force the dark token dictionary.</summary>
    Dark,

    /// <summary>Honor the system high-contrast palette.</summary>
    HighContrast,
}

/// <summary>
/// Theme switcher (mirrors the web <c>ThemePicker</c>). Presents the available
/// <see cref="ThemeOption"/>s and applies the choice to a target element's
/// <see cref="FrameworkElement.RequestedTheme"/>, defaulting to the window root.
/// High-contrast defers to the OS palette. Option labels are consumer-supplied so
/// the control ships no hardcoded strings.
/// </summary>
public partial class TsThemePicker : ContentControl
{
    private readonly ComboBox _combo = new();
    private bool _syncing;

    public static readonly DependencyProperty SelectedThemeProperty = DependencyProperty.Register(
        nameof(SelectedTheme), typeof(ThemeOption), typeof(TsThemePicker),
        new PropertyMetadata(ThemeOption.System, OnSelectedThemeChanged));

    public static readonly DependencyProperty TargetProperty = DependencyProperty.Register(
        nameof(Target), typeof(FrameworkElement), typeof(TsThemePicker),
        new PropertyMetadata(null, OnSelectedThemeChanged));

    public static readonly DependencyProperty SystemLabelProperty = DependencyProperty.Register(
        nameof(SystemLabel), typeof(string), typeof(TsThemePicker), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty LightLabelProperty = DependencyProperty.Register(
        nameof(LightLabel), typeof(string), typeof(TsThemePicker), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty DarkLabelProperty = DependencyProperty.Register(
        nameof(DarkLabel), typeof(string), typeof(TsThemePicker), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty HighContrastLabelProperty = DependencyProperty.Register(
        nameof(HighContrastLabel), typeof(string), typeof(TsThemePicker), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty AccessibleNameProperty = DependencyProperty.Register(
        nameof(AccessibleName), typeof(string), typeof(TsThemePicker), new PropertyMetadata(null, OnLabelsChanged));

    public TsThemePicker()
    {
        IsTabStop = false;
        for (var i = 0; i < 4; i++)
        {
            _combo.Items.Add(new ComboBoxItem());
        }

        _combo.SelectedIndex = 0;
        _combo.SelectionChanged += OnComboSelectionChanged;
        Content = _combo;
        ApplyLabels();
    }

    /// <summary>Raised after the selected theme is applied.</summary>
    public event EventHandler<ThemeOption>? ThemeChanged;

    public ThemeOption SelectedTheme
    {
        get => (ThemeOption)GetValue(SelectedThemeProperty);
        set => SetValue(SelectedThemeProperty, value);
    }

    /// <summary>Element whose <see cref="FrameworkElement.RequestedTheme"/> is set. Defaults to the window content.</summary>
    public FrameworkElement? Target
    {
        get => (FrameworkElement?)GetValue(TargetProperty);
        set => SetValue(TargetProperty, value);
    }

    public string? SystemLabel
    {
        get => (string?)GetValue(SystemLabelProperty);
        set => SetValue(SystemLabelProperty, value);
    }

    public string? LightLabel
    {
        get => (string?)GetValue(LightLabelProperty);
        set => SetValue(LightLabelProperty, value);
    }

    public string? DarkLabel
    {
        get => (string?)GetValue(DarkLabelProperty);
        set => SetValue(DarkLabelProperty, value);
    }

    public string? HighContrastLabel
    {
        get => (string?)GetValue(HighContrastLabelProperty);
        set => SetValue(HighContrastLabelProperty, value);
    }

    /// <summary>Localized accessible name for the picker.</summary>
    public string? AccessibleName
    {
        get => (string?)GetValue(AccessibleNameProperty);
        set => SetValue(AccessibleNameProperty, value);
    }

    private static void OnSelectedThemeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var picker = (TsThemePicker)d;
        picker._syncing = true;
        picker._combo.SelectedIndex = (int)picker.SelectedTheme;
        picker._syncing = false;
        picker.ApplyTheme();
    }

    private static void OnLabelsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsThemePicker)d).ApplyLabels();

    private void OnComboSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        SelectedTheme = (ThemeOption)Math.Max(0, _combo.SelectedIndex);
    }

    private void ApplyTheme()
    {
        var target = Target ?? ResolveRoot();
        if (target is null)
        {
            ThemeChanged?.Invoke(this, SelectedTheme);
            return;
        }

        target.RequestedTheme = SelectedTheme switch
        {
            ThemeOption.Light => ElementTheme.Light,
            ThemeOption.Dark => ElementTheme.Dark,
            _ => ElementTheme.Default,
        };

        ThemeChanged?.Invoke(this, SelectedTheme);
    }

    private FrameworkElement? ResolveRoot() => XamlRoot?.Content as FrameworkElement;

    private void ApplyLabels()
    {
        SetLabel(0, SystemLabel);
        SetLabel(1, LightLabel);
        SetLabel(2, DarkLabel);
        SetLabel(3, HighContrastLabel);

        if (!string.IsNullOrEmpty(AccessibleName))
        {
            AutomationProperties.SetName(_combo, AccessibleName);
        }
    }

    private void SetLabel(int index, string? label)
    {
        if (index < _combo.Items.Count && _combo.Items[index] is ComboBoxItem item)
        {
            item.Content = label ?? string.Empty;
        }
    }
}
