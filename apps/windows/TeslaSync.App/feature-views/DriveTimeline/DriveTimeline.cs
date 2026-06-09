using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>DriveTimeline</c> feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/DriveTimeline.tsx. It is a pure presentational strip: assign a
/// <see cref="Model"/> (the web <c>drive</c> prop) and it renders exactly one of two branches —
/// <see cref="DriveTimelineState.Ready"/> (the web composition: a three-column legend of the green start flag +
/// start time, the muted duration, and the red end flag + end time / "In progress" label, above an
/// emerald→cyan progress bar set over a translucent track) or <see cref="DriveTimelineState.Empty"/> (the panel
/// chrome over a friendly stand-in when no drive is bound, never a blank box). The whole strip fades in through
/// <see cref="TsFadeIn"/> (the web <c>FadeIn</c>, honouring the OS reduce-motion setting) inside a tokenized
/// <see cref="TsGlassPanel"/> (the web <c>GlassPanel</c>); all branch selection, time / duration formatting and
/// copy resolution happen in the WinUI-free <see cref="DriveTimelineProjection"/>. Every string resolves through
/// the i18n facade, the decorative flag glyphs are hidden from Narrator, and the surface carries a composed
/// Narrator name in each state.
/// </summary>
public sealed partial class DriveTimeline : ContentControl
{
    private const double PanelPadding = 16;     // web GlassPanel p-4
    private const double RowSpacing = 8;        // web mb-2 between the legend and the bar
    private const double IconTextSpacing = 4;   // web gap-1 between a flag and its time
    private const double LabelFontSize = 12;    // web text-xs
    private const double FlagIconSize = 12;     // web h-3 w-3
    private const double TrackHeight = 12;      // web h-3
    private const double TrackRadius = 999;     // web rounded-full
    private const string EmptyGlyph = "\uE7C3"; // Segoe Fluent — empty document

    // Web text-green-400 / text-red-400 flag + time tints (semantic success / danger tokens).
    private const string StartBrushKey = "TsColorSuccessBrush";
    private const string EndBrushKey = "TsColorDangerBrush";
    private const string TrackBrushKey = "TsColorSurfaceGlassBrush";

    // Web bg-gradient-to-r from-emerald-500 to-cyan-400 (emerald TsChartBatteryBrush → cyan TsChartRegenBrush).
    private const string GradientFromKey = "TsChartBatteryBrush";
    private const string GradientToKey = "TsChartRegenBrush";
    private static readonly Windows.UI.Color GradientFromFallback = Windows.UI.Color.FromArgb(0xFF, 0x10, 0xB9, 0x81);
    private static readonly Windows.UI.Color GradientToFallback = Windows.UI.Color.FromArgb(0xFF, 0x06, 0xB6, 0xD4);

    private readonly ILocalizer _localizer;
    private readonly DriveTimelineDiagnostics _diagnostics;

    private DriveTimelineModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="DriveTimelineModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DriveTimeline(
        ILocalizer localizer,
        DriveTimelineModel? model = null,
        DriveTimelineDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DriveTimelineModel.Empty;
        _diagnostics = diagnostics ?? new DriveTimelineDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DriveTimeline</c>).</summary>
    public static string Slug => DriveTimelineRegistration.Slug;

    /// <summary>The render model (the drive); reassigning re-projects and re-renders the surface.</summary>
    public DriveTimelineModel Model
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
        var display = DriveTimelineProjection.Project(_model, _localizer);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State == DriveTimelineState.Empty
            ? BuildEmpty(display)
            : BuildReady(display);
    }

    // ── Ready (the web FadeIn > GlassPanel composition) ──────────────────────────────────────────────────
    private static TsFadeIn BuildReady(DriveTimelineDisplay display)
    {
        var column = new StackPanel { Spacing = RowSpacing };
        column.Children.Add(BuildLegend(display));
        column.Children.Add(BuildTrack());

        return Wrap(new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = column,
        });
    }

    private static Grid BuildLegend(DriveTimelineDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var start = FlagGroup(display.StartText, DisplayTokens.Brush(StartBrushKey), HorizontalAlignment.Left);
        var duration = new TextBlock
        {
            Text = display.DurationText,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var end = FlagGroup(display.EndText, DisplayTokens.Brush(EndBrushKey), HorizontalAlignment.Right);

        Grid.SetColumn(start, 0);
        Grid.SetColumn(duration, 1);
        Grid.SetColumn(end, 2);
        grid.Children.Add(start);
        grid.Children.Add(duration);
        grid.Children.Add(end);
        return grid;
    }

    private static StackPanel FlagGroup(string text, Brush tint, HorizontalAlignment alignment)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = IconTextSpacing,
            HorizontalAlignment = alignment,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = DriveTimelineRegistration.FlagGlyph,
            FontSize = FlagIconSize,
            Foreground = tint,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — the time text beside it and the surface Narrator name carry the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        row.Children.Add(icon);
        row.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = LabelFontSize,
            Foreground = tint,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return row;
    }

    private static Border BuildTrack()
    {
        // Web: a rounded translucent track (bg surface-2) hosting a full-width emerald→cyan gradient bar.
        var bar = new Border
        {
            CornerRadius = new CornerRadius(TrackRadius),
            Background = BuildGradient(),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };

        return new Border
        {
            Height = TrackHeight,
            CornerRadius = new CornerRadius(TrackRadius),
            Background = DisplayTokens.Brush(TrackBrushKey),
            Child = bar,
        };
    }

    private static LinearGradientBrush BuildGradient()
    {
        var brush = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0.5),
            EndPoint = new Windows.Foundation.Point(1, 0.5),
        };
        brush.GradientStops.Add(new GradientStop { Color = ResolveColor(GradientFromKey, GradientFromFallback), Offset = 0 });
        brush.GradientStops.Add(new GradientStop { Color = ResolveColor(GradientToKey, GradientToFallback), Offset = 1 });
        return brush;
    }

    private static Windows.UI.Color ResolveColor(string key, Windows.UI.Color fallback) =>
        DisplayTokens.Brush(key) is SolidColorBrush b ? b.Color : fallback;

    // ── Empty (no drive bound — friendly stand-in, never a blank box) ────────────────────────────────────
    private static TsFadeIn BuildEmpty(DriveTimelineDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = EmptyGlyph,
            Message = display.EmptyMessage,
        };

        var panel = Wrap(new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = empty,
        });

        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return panel;
    }

    private static TsFadeIn Wrap(UIElement content) => new() { Content = content };
}
