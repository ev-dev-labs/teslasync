using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>QuickStatsGrid</c> feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx. It is the presentational responsive
/// grid of live-state tiles: assign a <see cref="Model"/> (the web <c>state</c> + <c>status</c> props, folded
/// into a SI <see cref="QuickVehicleSnapshot"/>) and it renders the web composition — the eight always-present
/// metric tiles (Battery, Range, Odometer, Speed, Inside Temp, Outside Temp, Power, State) — each as a
/// <see cref="TsMetricCard"/> (the native counterpart of the web <c>&lt;MetricCard&gt;</c>) carrying its web
/// <c>color</c> on the accent rail and, for the Speed tile, the driving/parked <c>subtitle</c> on the caption
/// line. The tiles enter through a single <see cref="TsFadeIn"/> (the native mapping of the web grid's mount),
/// and the grid reflows 2 → 3 → 4 columns across the web <c>sm</c> / <c>lg</c> breakpoints
/// (<c>grid-cols-2 sm:grid-cols-3 lg:grid-cols-4</c>). While the parent has not handed down the live state the
/// surface renders tokenized <see cref="TsSkeleton"/> chrome — never a blank box. SI is converted to the user's
/// units only here (web <c>useUnits</c>) via the WinUI-free <see cref="QuickStatsGridProjection"/>; the view
/// never performs HTTP. Every string resolves through the i18n facade, every tile and the surface carry a
/// Narrator name, the loading grid announces itself through a live region, and the entrance motion is the
/// system-honoured <see cref="TsFadeIn"/>, so reduced-motion is respected by construction.
/// </summary>
public sealed partial class QuickStatsGrid : ContentControl
{
    private const double NarrowBreakpoint = 640;   // web Tailwind `sm:` (grid-cols-2 → grid-cols-3)
    private const double WideBreakpoint = 1024;     // web Tailwind `lg:` (grid-cols-3 → grid-cols-4)
    private const int DefaultColumns = 4;           // pre-measure default (the lg layout)
    private const double TileGap = 12;              // web `gap-3`
    private const double SkeletonTileHeight = 84;   // a skeleton tile ≈ a populated compact metric tile

    private readonly ILocalizer _localizer;
    private readonly QuickStatsGridDiagnostics _diagnostics;

    private QuickStatsGridModel _model;
    private UnitPref _units;
    private bool _opened;
    private int _columns = DefaultColumns;

    /// <summary>Creates the surface over its i18n facade, an initial model, the user's units, and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="model">The initial render model; defaults to <see cref="QuickStatsGridModel.Pending"/>.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public QuickStatsGrid(
        ILocalizer localizer,
        QuickStatsGridModel? model = null,
        UnitPref? units = null,
        QuickStatsGridDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? QuickStatsGridModel.Pending;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new QuickStatsGridDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>QuickStatsGrid</c>).</summary>
    public static string Slug => QuickStatsGridRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the grid.</summary>
    public QuickStatsGridModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the tiles in the new units.</summary>
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = ColumnsForWidth(e.NewSize.Width);
        if (desired != _columns)
        {
            _columns = desired;
            Render();
        }
    }

    // web: grid-cols-2 / sm:grid-cols-3 / lg:grid-cols-4.
    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => DefaultColumns,
        < NarrowBreakpoint => 2,
        < WideBreakpoint => 3,
        _ => 4,
    };

    private void Render()
    {
        var display = QuickStatsGridProjection.Project(_model, _units, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State == QuickStatsGridState.Loading
            ? BuildLoading(display)
            : BuildReady(display);
    }

    // ── Loading (parent still resolving the live state — skeleton chrome, never a blank box) ─────────────
    private Grid BuildLoading(QuickStatsGridDisplay display)
    {
        var grid = BuildGrid(QuickStatsGridProjection.TileCount);
        for (int i = 0; i < QuickStatsGridProjection.TileCount; i++)
        {
            var tile = new TsSkeleton
            {
                BlockHeight = SkeletonTileHeight,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Place(grid, tile, i);
        }

        AutomationProperties.SetName(grid, display.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    // ── Ready (the web render: the eight metric tiles entering through a fade) ───────────────────────────
    private TsFadeIn BuildReady(QuickStatsGridDisplay display)
    {
        var grid = BuildGrid(display.Cards.Count);
        for (int i = 0; i < display.Cards.Count; i++)
        {
            Place(grid, BuildTile(display.Cards[i]), i);
        }

        return new TsFadeIn
        {
            Content = grid,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    private static TsMetricCard BuildTile(QuickStat card)
    {
        var tile = new TsMetricCard
        {
            Label = card.Label,
            Value = card.Value,
            AccentBrushKey = card.AccentBrushKey,
            // web `subtitle` → the muted caption line; only the Speed tile carries one (driving/parked).
            DeltaText = card.Subtitle ?? string.Empty,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        // Override the TsMetricCard default name so the Speed tile's subtitle is also announced.
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private Grid BuildGrid(int itemCount)
    {
        var grid = new Grid { ColumnSpacing = TileGap, RowSpacing = TileGap };
        for (int c = 0; c < _columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = Math.Max(1, (int)Math.Ceiling(itemCount / (double)_columns));
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }

    private void Place(Grid grid, FrameworkElement tile, int index)
    {
        Grid.SetColumn(tile, index % _columns);
        Grid.SetRow(tile, index / _columns);
        grid.Children.Add(tile);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new QuickStatsGridAutomationPeer(this);

    private sealed class QuickStatsGridAutomationPeer(QuickStatsGrid owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
