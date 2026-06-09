using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;

namespace TeslaSync.App.FeatureViews.WeeklyDigest;

/// <summary>
/// The native WinUI 3 <c>BatteryPill</c> feature surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/BatteryPill.tsx. It is a pure presentational control:
/// assign a <see cref="Model"/> (the web <c>level</c> / <c>label</c> props) and it renders the web layout — a
/// tokenized <see cref="TsGlassPanel"/> holding a tier-coloured battery <see cref="FontIcon"/>, a caption +
/// bold percentage column, and a right-aligned progress bar whose fill width and colour track the level. The
/// view never performs HTTP; the colour-tier selection, the <c>fmtInt</c> percentage formatting and the
/// clamped bar fraction all happen in the WinUI-free <see cref="BatteryPillProjection"/>. The accent brush is
/// the generated design token for the tier (so light / dark / high-contrast all flow from the token set), the
/// decorative icon and bar are hidden from Narrator, and the surface carries a single composed Narrator name.
/// The surface is anonymous in the web source (it renders no <c>t()</c> strings — the caption is a prop and the
/// only literal is the unit "%"), so there are no i18n keys to resolve.
/// </summary>
public sealed partial class BatteryPill : ContentControl
{
    private const double IconFontSize = 20;   // web `h-5 w-5`
    private const double LabelFontSize = 12;  // web `text-xs`
    private const double ValueFontSize = 14;  // web `text-sm`
    private const double BarTrackWidth = 64;  // web `w-16`
    private const double BarHeight = 8;       // web `h-2`
    private const double RowSpacing = 12;     // web `gap-3`
    private const double PanelPaddingX = 16;  // web `px-4`
    private const double PanelPaddingY = 12;  // web `py-3`

    private readonly BatteryPillDiagnostics _diagnostics;

    private BatteryPillModel _model;
    private bool _opened;

    /// <summary>Creates the surface over an initial model and (optional) diagnostics.</summary>
    /// <param name="model">The initial render model; defaults to <see cref="BatteryPillModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryPill(
        BatteryPillModel? model = null,
        BatteryPillDiagnostics? diagnostics = null)
    {
        _model = model ?? BatteryPillModel.Empty;
        _diagnostics = diagnostics ?? new BatteryPillDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>BatteryPill</c>).</summary>
    public static string Slug => BatteryPillRegistration.Slug;

    /// <summary>The render model (level / label); reassigning re-projects and re-renders the surface.</summary>
    public BatteryPillModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = BatteryPillProjection.Project(_model);
        Brush accent = DisplayTokens.Brush(display.AccentBrushKey);

        // Web `flex items-center gap-3`, with the bar pushed right by `ml-auto`: a three-column grid whose
        // trailing star column right-aligns the bar.
        var grid = new Grid { ColumnSpacing = RowSpacing, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = BatteryPillRegistration.BatteryGlyph,
            FontSize = IconFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        // Web `flex flex-col`: the caption over the bold, tier-coloured value.
        var textColumn = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(new TextBlock
        {
            Text = display.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextSecondary,
        });
        textColumn.Children.Add(new TextBlock
        {
            Text = display.PercentText,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
        });
        AutomationProperties.SetAccessibilityView(textColumn, AccessibilityView.Raw);
        Grid.SetColumn(textColumn, 1);
        grid.Children.Add(textColumn);

        grid.Children.Add(BuildBar(display.BarFraction, accent));

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPaddingX, PanelPaddingY, PanelPaddingX, PanelPaddingY),
            Content = grid,
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = panel;
    }

    // Web `<span class="ml-auto h-2 w-16 ... bg-[var(--surface-2)]"><span style="width:…; background:…"/></span>`:
    // a fixed-width rounded track with a left-anchored fill whose width is the clamped level fraction.
    private static Border BuildBar(double fraction, Brush accent)
    {
        CornerRadius pill = DisplayTokens.Radius("TsRadiusPill", 999);

        var fill = new Border
        {
            Width = BarTrackWidth * fraction,
            Height = BarHeight,
            CornerRadius = pill,
            Background = accent,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var track = new Border
        {
            Width = BarTrackWidth,
            Height = BarHeight,
            CornerRadius = pill,
            Background = DisplayTokens.Brush("TsColorBorderBrush"),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            Child = fill,
        };

        // Decorative — the surface's Narrator name already carries the label and percentage.
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        Grid.SetColumn(track, 2);
        return track;
    }
}
