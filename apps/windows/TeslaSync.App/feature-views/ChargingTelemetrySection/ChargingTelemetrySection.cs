using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChargingTelemetrySection</c> feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx. It is a presentational
/// section: assign a <see cref="Model"/> (the web <c>chargingTelemetry</c> prop, plus the parent's lifecycle
/// status) and it renders inside a <see cref="TsGlassPanel"/> a persistent header (the green lightning glyph +
/// the "Charging Telemetry" title) above one of the contract's states —
/// <see cref="ChargingTelemetrySectionState.Loading"/> (skeleton chrome while the page resolves live telemetry),
/// <see cref="ChargingTelemetrySectionState.Empty"/> (the friendly "No charging telemetry available" surface for
/// the web <c>: &lt;EmptyState /&gt;</c> branch), <see cref="ChargingTelemetrySectionState.Error"/> (a retriable
/// <see cref="TsQueryError"/>), or the populated eight-tile metric grid
/// (<see cref="ChargingTelemetrySectionState.Ready"/> / <see cref="ChargingTelemetrySectionState.Stale"/> /
/// <see cref="ChargingTelemetrySectionState.Offline"/>) — Charger Power, Voltage, Current, Energy Added, Charging
/// State, Battery Level, Charge Rate and Range Added, each a <see cref="TsMetricCard"/> tinted by the web tile
/// colour, with a stale / offline freshness chip layered on the cached reading. The view never performs HTTP; all
/// branch selection, label resolution and SI→display unit conversion happen in the WinUI-free
/// <see cref="ChargingTelemetrySectionProjection"/>. Entrances fade through <see cref="TsFadeIn"/> (honouring
/// reduce-motion), every string resolves through the i18n facade, and the surface plus each tile carry a Narrator
/// name. A failed reading's retry affordance raises <see cref="RetryRequested"/> for the host to act on (the
/// parent owns the query).
/// </summary>
public sealed partial class ChargingTelemetrySection : ContentControl
{
    private const double PanelPadding = 24;       // web p-6
    private const double HeaderToBodyGap = 16;    // web mb-4
    private const double HeaderGap = 8;           // web gap-2
    private const double GridGap = 12;            // web gap-3
    private const double HeaderIconSize = 16;     // web h-4 w-4
    private const double ChipFontSize = 12;
    private const double MetricSkeletonHeight = 64;
    private const int GridColumns = 4;            // web lg:grid-cols-4
    private const int MetricCount = 8;
    private const int FadeDelayMs = 200;
    private const string HeaderAccentBrushKey = "TsColorSuccessBrush"; // web text-[var(--neon-green)] Zap

    private readonly ILocalizer _localizer;
    private readonly ChargingTelemetrySectionDiagnostics _diagnostics;

    private ChargingTelemetrySectionModel _model;
    private UnitPref _units;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, unit preference and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChargingTelemetrySectionModel.Loading"/>.</param>
    /// <param name="units">The user's display preference; defaults to <see cref="UnitPref.Metric"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargingTelemetrySection(
        ILocalizer localizer,
        ChargingTelemetrySectionModel? model = null,
        UnitPref? units = null,
        ChargingTelemetrySectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChargingTelemetrySectionModel.Loading;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new ChargingTelemetrySectionDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChargingTelemetrySection</c>).</summary>
    public static string Slug => ChargingTelemetrySectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChargingTelemetrySectionModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the grid in the new locale / precision / units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _units = value;
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
        ChargingTelemetrySectionDisplay display = ChargingTelemetrySectionProjection.Project(_model, _localizer, _units);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            ChargingTelemetrySectionState.Loading => BuildLoading(display),
            ChargingTelemetrySectionState.Empty => BuildEmpty(display),
            ChargingTelemetrySectionState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web fall-through: header + eight-tile metric grid) ────────────────────
    private static TsFadeIn BuildContent(ChargingTelemetrySectionDisplay display)
    {
        var stack = new StackPanel { Spacing = HeaderToBodyGap };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildMetricsGrid(display));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private static Grid BuildHeader(ChargingTelemetrySectionDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(display.HeaderGlyph, HeaderIconSize, HeaderAccentBrushKey));
        titleRow.Children.Add(new SectionTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        grid.Children.Add(titleRow);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildChip(display);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private static TsBadge BuildChip(ChargingTelemetrySectionDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", ChipFontSize),
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    // web grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 — on the desktop surface the widest (lg) four-up
    // layout wraps the eight tiles into two rows.
    private static Grid BuildMetricsGrid(ChargingTelemetrySectionDisplay display)
    {
        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Metrics.Count / (double)GridColumns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Metrics.Count; i++)
        {
            var card = BuildTile(display.Metrics[i]);
            Grid.SetColumn(card, i % GridColumns);
            Grid.SetRow(card, i / GridColumns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, display.Title);
        return grid;
    }

    private static TsMetricCard BuildTile(ChargingTelemetryMetric metric)
    {
        var card = new TsMetricCard
        {
            Label = metric.Label,
            Value = metric.Value,
            AccentBrushKey = metric.AccentBrushKey,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(card, metric.AutomationName);
        return card;
    }

    // ── Empty (web : <EmptyState /> branch — null chargingTelemetry, under the header) ──────────────────
    private static TsFadeIn BuildEmpty(ChargingTelemetrySectionDisplay display)
    {
        var stack = new StackPanel { Spacing = HeaderToBodyGap };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState
        {
            IconGlyph = display.HeaderGlyph,
            Message = display.EmptyMessage,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────
    private TsFadeIn BuildError(ChargingTelemetrySectionDisplay display)
    {
        var stack = new StackPanel { Spacing = HeaderToBodyGap };
        stack.Children.Add(BuildHeader(display));

        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        stack.Children.Add(error);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // ── Loading (the page is still resolving live telemetry) ───────────────────────────────────────────
    private static TsGlassPanel BuildLoading(ChargingTelemetrySectionDisplay display)
    {
        var stack = new StackPanel { Spacing = HeaderToBodyGap };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = HeaderGap };
        header.Children.Add(new TsSkeleton { BlockWidth = HeaderIconSize, BlockHeight = HeaderIconSize, Radius = 6 });
        header.Children.Add(new TsSkeleton { BlockWidth = 160, BlockHeight = HeaderIconSize });
        stack.Children.Add(header);

        stack.Children.Add(BuildSkeletonGrid());

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        AutomationProperties.SetName(panel, display.LoadingLabel);
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        return panel;
    }

    private static Grid BuildSkeletonGrid()
    {
        var grid = new Grid { ColumnSpacing = GridGap, RowSpacing = GridGap };
        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(MetricCount / (double)GridColumns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < MetricCount; i++)
        {
            var tile = new TsSkeleton { BlockHeight = MetricSkeletonHeight, HorizontalAlignment = HorizontalAlignment.Stretch };
            Grid.SetColumn(tile, i % GridColumns);
            Grid.SetRow(tile, i / GridColumns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    // ── Shared ──────────────────────────────────────────────────────────────────────────────────────────
    private static FontIcon DecorativeIcon(string glyph, double size, string brushKey)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = DisplayTokens.Brush(brushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the surface / tile automation names already convey the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }
}
