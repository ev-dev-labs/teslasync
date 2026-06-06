using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Text;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Tokenized status pill: a leading state dot plus the (capitalised) status text.
/// Mirrors the web <c>StatusBadge</c>. The dot colour follows a semantic accent
/// key so the pill stays legible under forced-colors / high contrast.
/// </summary>
public sealed partial class TsStatusBadge : ContentControl
{
    /// <summary>The status text (e.g. a vehicle FSM state).</summary>
    public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(
        nameof(Status), typeof(string), typeof(TsStatusBadge), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Token brush key driving the dot colour (default accent).</summary>
    public static readonly DependencyProperty AccentBrushKeyProperty = DependencyProperty.Register(
        nameof(AccentBrushKey), typeof(string), typeof(TsStatusBadge), new PropertyMetadata("TsColorAccentBrush", OnChanged));

    /// <summary>Initialise the pill.</summary>
    public TsStatusBadge()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The status text.</summary>
    public string Status
    {
        get => (string)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    /// <summary>Token brush key for the dot.</summary>
    public string AccentBrushKey
    {
        get => (string)GetValue(AccentBrushKeyProperty);
        set => SetValue(AccentBrushKeyProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStatusBadge)d).Rebuild();

    private void Rebuild()
    {
        var row = DisplayPrimitives.Row(6);
        row.Children.Add(DisplayPrimitives.Dot(DisplayTokens.Brush(AccentBrushKey), 6));
        var label = DisplayPrimitives.Label(Capitalize(Status));
        label.Foreground = DisplayTokens.TextSecondary;
        row.Children.Add(label);
        Content = DisplayPrimitives.Pill(row);
        AutomationLabel(Status);
    }

    private void AutomationLabel(string status) =>
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, status ?? string.Empty);

    private static string Capitalize(string? s)
    {
        if (string.IsNullOrEmpty(s))
        {
            return string.Empty;
        }

        return char.ToUpperInvariant(s[0]) + s[1..];
    }
}

/// <summary>
/// A bare severity-coloured dot (mirrors the web <c>StatusDot</c>). The colour
/// follows the canonical severity tokens; an automation name announces the level.
/// </summary>
public sealed partial class TsStatusDot : ContentControl
{
    /// <summary>Wire-level severity string (normalised internally).</summary>
    public static readonly DependencyProperty SeverityProperty = DependencyProperty.Register(
        nameof(Severity), typeof(string), typeof(TsStatusDot), new PropertyMetadata("info", OnChanged));

    /// <summary>Dot diameter in pixels.</summary>
    public static readonly DependencyProperty DotSizeProperty = DependencyProperty.Register(
        nameof(DotSize), typeof(double), typeof(TsStatusDot), new PropertyMetadata(8.0, OnChanged));

    /// <summary>Initialise the dot.</summary>
    public TsStatusDot()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Wire-level severity.</summary>
    public string Severity
    {
        get => (string)GetValue(SeverityProperty);
        set => SetValue(SeverityProperty, value);
    }

    /// <summary>Dot diameter.</summary>
    public double DotSize
    {
        get => (double)GetValue(DotSizeProperty);
        set => SetValue(DotSizeProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStatusDot)d).Rebuild();

    private void Rebuild()
    {
        var tokens = SeverityLevels.TokensFor(Severity);
        Content = DisplayPrimitives.Dot(DisplayTokens.Brush(tokens.AccentBrushKey), DotSize);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, tokens.Label);
    }
}

/// <summary>
/// Severity chip with a leading Fluent glyph and the canonical level label
/// (mirrors the web <c>SeverityBadge</c>). Colour comes from the severity tokens.
/// </summary>
public sealed partial class TsSeverityBadge : ContentControl
{
    /// <summary>Wire-level severity string (normalised internally).</summary>
    public static readonly DependencyProperty SeverityProperty = DependencyProperty.Register(
        nameof(Severity), typeof(string), typeof(TsSeverityBadge), new PropertyMetadata("info", OnChanged));

    /// <summary>When true (default) the leading glyph is shown.</summary>
    public static readonly DependencyProperty ShowIconProperty = DependencyProperty.Register(
        nameof(ShowIcon), typeof(bool), typeof(TsSeverityBadge), new PropertyMetadata(true, OnChanged));

    /// <summary>Optional label override; when empty the canonical level name is used.</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsSeverityBadge), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the chip.</summary>
    public TsSeverityBadge()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>Wire-level severity.</summary>
    public string Severity
    {
        get => (string)GetValue(SeverityProperty);
        set => SetValue(SeverityProperty, value);
    }

    /// <summary>Whether to render the leading glyph.</summary>
    public bool ShowIcon
    {
        get => (bool)GetValue(ShowIconProperty);
        set => SetValue(ShowIconProperty, value);
    }

    /// <summary>Optional label override.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSeverityBadge)d).Rebuild();

    private void Rebuild()
    {
        var tokens = SeverityLevels.TokensFor(Severity);
        var accent = DisplayTokens.Brush(tokens.AccentBrushKey);
        var row = DisplayPrimitives.Row(6);

        if (ShowIcon)
        {
            row.Children.Add(new FontIcon
            {
                Glyph = tokens.IconGlyph,
                FontSize = 13,
                Foreground = accent,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        string text = string.IsNullOrEmpty(Label) ? tokens.Label : Label;
        row.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        Content = DisplayPrimitives.Pill(row, accent);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, text);
    }
}

/// <summary>
/// FSM domain badge (mirrors the web <c>FSMBadge</c>). Maps an FSM type key to a
/// semantic variant brush and a short label.
/// </summary>
public sealed partial class TsFSMBadge : ContentControl
{
    /// <summary>FSM domain key (e.g. <c>drive_session</c>).</summary>
    public static readonly DependencyProperty TypeProperty = DependencyProperty.Register(
        nameof(Type), typeof(string), typeof(TsFSMBadge), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Initialise the badge.</summary>
    public TsFSMBadge()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The FSM domain key.</summary>
    public string Type
    {
        get => (string)GetValue(TypeProperty);
        set => SetValue(TypeProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFSMBadge)d).Rebuild();

    private void Rebuild()
    {
        bool neutral = FsmType.IsNeutral(Type);
        Brush accent = neutral
            ? DisplayTokens.TextSecondary
            : DisplayTokens.Brush(SeverityLevels.Tokens(FsmType.Variant(Type)).AccentBrushKey);

        var label = new TextBlock
        {
            Text = FsmType.Label(Type),
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Content = DisplayPrimitives.Pill(label, accent);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, FsmType.Label(Type));
    }
}

/// <summary>
/// Diagnostics badge showing the layered live-state source of a signal value
/// (mirrors the web <c>SourceLayerBadge</c>): L1 / L2 / LOG / STALE, with an
/// optional age surfaced in the automation tooltip.
/// </summary>
public sealed partial class TsSourceLayerBadge : ContentControl
{
    /// <summary>Wire source string ("l1"/"l2"/"log"/"stale").</summary>
    public static readonly DependencyProperty SourceProperty = DependencyProperty.Register(
        nameof(Source), typeof(string), typeof(TsSourceLayerBadge), new PropertyMetadata(string.Empty, OnChanged));

    /// <summary>Optional value age in milliseconds (NaN = none).</summary>
    public static readonly DependencyProperty AgeMsProperty = DependencyProperty.Register(
        nameof(AgeMs), typeof(double), typeof(TsSourceLayerBadge), new PropertyMetadata(double.NaN, OnChanged));

    /// <summary>Initialise the badge.</summary>
    public TsSourceLayerBadge()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The wire source string.</summary>
    public string Source
    {
        get => (string)GetValue(SourceProperty);
        set => SetValue(SourceProperty, value);
    }

    /// <summary>Value age in milliseconds (NaN = none).</summary>
    public double AgeMs
    {
        get => (double)GetValue(AgeMsProperty);
        set => SetValue(AgeMsProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSourceLayerBadge)d).Rebuild();

    private void Rebuild()
    {
        var tokens = SourceLayers.TokensFor(Source);
        var accent = DisplayTokens.Brush(tokens.AccentBrushKey);

        var label = new TextBlock
        {
            Text = tokens.Label,
            FontSize = 10,
            FontFamily = new FontFamily("Consolas"),
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Content = DisplayPrimitives.Pill(label, accent);

        string? age = double.IsNaN(AgeMs) ? null : FreshnessLogic.FormatSourceAge(AgeMs);
        string tip = age is null ? tokens.Description : $"{tokens.Description} (age: {age})";
        ToolTipService.SetToolTip(this, tip);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, tip);
    }
}
