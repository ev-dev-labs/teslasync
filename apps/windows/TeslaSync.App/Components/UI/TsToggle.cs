using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized on/off switch (mirrors the web <c>Toggle</c>). WinUI's
/// <see cref="ToggleSwitch"/> is sealed, so this hosts one and re-exposes its
/// <see cref="IsOn"/>/<see cref="Header"/> surface plus a <see cref="Toggled"/>
/// event, preserving the inner switch's keyboard and Narrator semantics.
/// </summary>
public partial class TsToggle : ContentControl
{
    private readonly ToggleSwitch _switch = new();

    public static readonly DependencyProperty IsOnProperty = DependencyProperty.Register(
        nameof(IsOn), typeof(bool), typeof(TsToggle),
        new PropertyMetadata(false, OnIsOnChanged));

    public static readonly DependencyProperty HeaderProperty = DependencyProperty.Register(
        nameof(Header), typeof(string), typeof(TsToggle),
        new PropertyMetadata(null, OnHeaderChanged));

    public TsToggle()
    {
        Content = _switch;
        IsTabStop = false;
        _switch.Toggled += (s, e) =>
        {
            if (IsOn != _switch.IsOn)
            {
                IsOn = _switch.IsOn;
            }

            Toggled?.Invoke(this, EventArgs.Empty);
        };
    }

    /// <summary>Raised whenever the on/off state changes.</summary>
    public event EventHandler? Toggled;

    /// <summary>Current on/off state.</summary>
    public bool IsOn
    {
        get => (bool)GetValue(IsOnProperty);
        set => SetValue(IsOnProperty, value);
    }

    /// <summary>Localized header shown beside the switch.</summary>
    public string? Header
    {
        get => (string?)GetValue(HeaderProperty);
        set => SetValue(HeaderProperty, value);
    }

    private static void OnIsOnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var toggle = (TsToggle)d;
        if (toggle._switch.IsOn != (bool)e.NewValue)
        {
            toggle._switch.IsOn = (bool)e.NewValue;
        }
    }

    private static void OnHeaderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var toggle = (TsToggle)d;
        toggle._switch.Header = e.NewValue;
    }
}
