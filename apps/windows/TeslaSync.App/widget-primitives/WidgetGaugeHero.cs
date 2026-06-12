using System.ComponentModel;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// Native WinUI port of the web <c>WidgetGaugeHero</c> shared widget primitive
/// (web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx): a vertically-stacked, centred composition of
/// a <c>TsRadialGauge</c> (the native <c>RadialGauge</c>), an optional centred row of supporting stat tiles, and
/// optional caller-supplied <see cref="Footer"/> content (the web <c>children</c>). Mirroring the web source, the
/// stats row renders only on the standard footprint when at least one stat exists, and the footer renders only on
/// the standard footprint (both gated by <c>!compact</c>); the gauge always renders so the surface is never a
/// blank box. All composition and branching is decided by the UI-thread-free
/// <see cref="WidgetGaugeHeroViewModel"/> + <see cref="WidgetGaugeHeroProjection"/>, so this view is a thin
/// renderer that also emits the P1/S11 <c>view.opened</c> diagnostic once, when it is first loaded.
/// </summary>
public sealed partial class WidgetGaugeHero : ContentControl
{
    private readonly WidgetGaugeHeroViewModel _viewModel;
    private readonly WidgetGaugeHeroDiagnostics _diagnostics;
    private readonly StackPanel _root;
    private object? _footer;
    private bool _opened;

    /// <summary>Creates an empty primitive (gauge 0 / 100); set <see cref="Gauge"/> to populate it.</summary>
    public WidgetGaugeHero()
        : this(new GaugeHeroConfig(0, 100, string.Empty, string.Empty))
    {
    }

    /// <summary>Creates the primitive over its gauge config, optional stats, footprint and diagnostics sink.</summary>
    /// <param name="gauge">The gauge configuration (required).</param>
    /// <param name="stats">Optional supporting stats shown beneath the gauge on the standard footprint.</param>
    /// <param name="compact">True on a compact footprint: smaller gauge, no stats, no footer.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public WidgetGaugeHero(
        GaugeHeroConfig gauge,
        IReadOnlyList<GaugeHeroStat>? stats = null,
        bool compact = false,
        WidgetGaugeHeroDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(gauge);
        _viewModel = new WidgetGaugeHeroViewModel(gauge, stats, compact);
        _diagnostics = diagnostics ?? new WidgetGaugeHeroDiagnostics();

        _root = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Rebuild();
    }

    /// <summary>The gauge configuration; assigning re-projects and re-renders.</summary>
    public GaugeHeroConfig Gauge
    {
        get => _viewModel.Gauge;
        set => _viewModel.Gauge = value;
    }

    /// <summary>The supporting stats; assigning re-projects and re-renders.</summary>
    public IReadOnlyList<GaugeHeroStat> Stats
    {
        get => _viewModel.Stats;
        set => _viewModel.Stats = value;
    }

    /// <summary>The compact footprint flag; assigning re-projects and re-renders.</summary>
    public bool Compact
    {
        get => _viewModel.Compact;
        set => _viewModel.Compact = value;
    }

    /// <summary>Caller-supplied content rendered beneath the stats on the standard footprint (web <c>children</c>).</summary>
    public object? Footer
    {
        get => _footer;
        set
        {
            _footer = value;
            Rebuild();
        }
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(WidgetGaugeHeroViewModel.Display))
        {
            Rebuild();
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

    private void Rebuild()
    {
        var display = _viewModel.Display;
        _root.Children.Clear();

        _root.Children.Add(BuildGauge(display));

        if (display.ShowStats && display.Stats.Count > 0)
        {
            _root.Children.Add(BuildStats(display.Stats));
        }

        if (display.ShowChildren && _footer is not null)
        {
            _root.Children.Add(new ContentPresenter
            {
                Content = _footer,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }
    }

    private static TsRadialGauge BuildGauge(GaugeHeroDisplay display)
    {
        var gauge = new TsRadialGauge
        {
            Value = display.GaugeValue,
            Max = display.GaugeMax,
            Label = display.GaugeLabel,
            Unit = display.GaugeUnit,
            Diameter = display.GaugeDiameter,
            Decimals = display.GaugeDecimals,
            Role = display.GaugeRole,
            ColorIndex = display.GaugeColorIndex,
        };

        // Outer Narrator name mirrors the web RadialGauge readout (label + value + unit); the gauge's own inner
        // glyphs stay decorative via TsRadialGauge.
        AutomationProperties.SetName(gauge, display.GaugeAutomationName);
        return gauge;
    }

    private static StackPanel BuildStats(IReadOnlyList<GaugeHeroStatDisplay> stats)
    {
        // Web: flex flex-wrap items-center justify-center gap-x-4 gap-y-1 — a centred row of auto-width tiles.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var stat in stats)
        {
            row.Children.Add(BuildStatTile(stat));
        }

        return row;
    }

    private static StackPanel BuildStatTile(GaugeHeroStatDisplay stat)
    {
        // Web tile: flex min-w-0 flex-col items-center text-center — a truncating label (xs, secondary) over a
        // value (sm, semibold, primary) with an optional inline unit (xs, normal, secondary).
        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        value.Inlines.Add(new Run
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        });
        if (stat.Unit is { Length: > 0 } unit)
        {
            value.Inlines.Add(new Run
            {
                Text = " " + unit,
                FontSize = 12,
                FontWeight = FontWeights.Normal,
                Foreground = DisplayTokens.TextSecondary,
            });
        }

        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var tile = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        tile.Children.Add(label);
        tile.Children.Add(value);
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }
}
