using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Locale-aware timestamp display (mirrors the web <c>format/DateTime</c>). Delegates
/// all rendering to the pure <see cref="DateTimeFormatting"/> behavior port — full,
/// date, time, short and relative variants — so the Windows app shares the exact web
/// display contract. Null / invalid timestamps render the em-dash fallback.
/// </summary>
public sealed partial class TsDateTime : ContentControl
{
    /// <summary>The timestamp to render (null → em dash).</summary>
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(DateTimeOffset?), typeof(TsDateTime), new PropertyMetadata(null, OnChanged));

    /// <summary>The render variant (default <see cref="DateTimeVariant.Full"/>).</summary>
    public static readonly DependencyProperty VariantProperty = DependencyProperty.Register(
        nameof(Variant), typeof(DateTimeVariant), typeof(TsDateTime),
        new PropertyMetadata(DateTimeVariant.Full, OnChanged));

    private readonly TextBlock _text = new() { Foreground = DisplayTokens.TextPrimary };

    /// <summary>Initialise the control.</summary>
    public TsDateTime()
    {
        IsTabStop = false;
        Content = _text;
        Refresh();
    }

    /// <summary>The timestamp.</summary>
    public DateTimeOffset? Value
    {
        get => (DateTimeOffset?)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>The render variant.</summary>
    public DateTimeVariant Variant
    {
        get => (DateTimeVariant)GetValue(VariantProperty);
        set => SetValue(VariantProperty, value);
    }

    /// <summary>Recompute the rendered string against the current wall clock.</summary>
    public void Refresh()
    {
        _text.Text = DateTimeFormatting.Format(Value, Variant, DateTimeOffset.Now);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, _text.Text);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDateTime)d).Refresh();
}
