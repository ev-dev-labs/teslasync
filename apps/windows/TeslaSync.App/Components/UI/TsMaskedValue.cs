using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Reveals a sensitive value on demand (mirrors the web <c>MaskedValue</c>).
/// Renders the <see cref="MaskedValueFormatter"/> output by default; an eye toggle
/// reveals the raw value and a 30-second timer automatically re-masks it. An
/// optional inline copy affordance places the raw value on the clipboard without
/// revealing it on screen.
/// </summary>
public partial class TsMaskedValue : ContentControl
{
    private const int AutoHideSeconds = 30;

    private readonly TextBlock _display = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _reveal = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE7B3" };
    private readonly TsCopyButton _copy = new();
    private readonly DispatcherTimer _autoHide = new() { Interval = TimeSpan.FromSeconds(AutoHideSeconds) };
    private bool _revealed;

    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(TsMaskedValue), new PropertyMetadata(null, OnVisualChanged));

    public static readonly DependencyProperty VariantProperty = DependencyProperty.Register(
        nameof(Variant), typeof(MaskVariant), typeof(TsMaskedValue),
        new PropertyMetadata(MaskVariant.Token, OnVisualChanged));

    public static readonly DependencyProperty ShowLastProperty = DependencyProperty.Register(
        nameof(ShowLast), typeof(int), typeof(TsMaskedValue), new PropertyMetadata(4, OnVisualChanged));

    public static readonly DependencyProperty AllowCopyProperty = DependencyProperty.Register(
        nameof(AllowCopy), typeof(bool), typeof(TsMaskedValue), new PropertyMetadata(false, OnVisualChanged));

    public static readonly DependencyProperty RevealLabelProperty = DependencyProperty.Register(
        nameof(RevealLabel), typeof(string), typeof(TsMaskedValue), new PropertyMetadata(null, OnVisualChanged));

    public TsMaskedValue()
    {
        IsTabStop = false;
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        panel.Children.Add(_display);
        panel.Children.Add(_reveal);
        panel.Children.Add(_copy);
        Content = panel;

        _reveal.Click += (s, e) => ToggleReveal();
        _autoHide.Tick += (s, e) => SetRevealed(false);
        Render();
    }

    /// <summary>The raw sensitive value. Never shown until the user reveals it.</summary>
    public string? Value
    {
        get => (string?)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    public MaskVariant Variant
    {
        get => (MaskVariant)GetValue(VariantProperty);
        set => SetValue(VariantProperty, value);
    }

    /// <summary>Number of trailing characters to keep visible for tail-mask variants.</summary>
    public int ShowLast
    {
        get => (int)GetValue(ShowLastProperty);
        set => SetValue(ShowLastProperty, value);
    }

    /// <summary>When <c>true</c>, shows a copy button that copies the raw value.</summary>
    public bool AllowCopy
    {
        get => (bool)GetValue(AllowCopyProperty);
        set => SetValue(AllowCopyProperty, value);
    }

    /// <summary>Localized accessible name for the reveal toggle.</summary>
    public string? RevealLabel
    {
        get => (string?)GetValue(RevealLabelProperty);
        set => SetValue(RevealLabelProperty, value);
    }

    private static void OnVisualChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsMaskedValue)d).Render();

    private void ToggleReveal() => SetRevealed(!_revealed);

    private void SetRevealed(bool revealed)
    {
        _revealed = revealed;
        if (revealed)
        {
            _autoHide.Start();
        }
        else
        {
            _autoHide.Stop();
        }

        Render();
    }

    private void Render()
    {
        _display.Text = _revealed
            ? Value ?? "\u2014"
            : MaskedValueFormatter.Mask(Value, Variant, ShowLast);

        _reveal.IconGlyph = _revealed ? "\uE7B3" : "\uED1A";
        _copy.ValueToCopy = Value;
        _copy.Visibility = AllowCopy ? Visibility.Visible : Visibility.Collapsed;

        if (!string.IsNullOrEmpty(RevealLabel))
        {
            AutomationProperties.SetName(_reveal, RevealLabel);
            ToolTipService.SetToolTip(_reveal, RevealLabel);
        }
    }
}
