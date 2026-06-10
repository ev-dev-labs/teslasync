using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SummaryStatsRow</c> feature surface — a parity port of
/// web/src/features/admin/components/security-access/SummaryStatsRow.tsx. It is a pure presentational row:
/// assign a <see cref="Model"/> (the web <c>isSecure</c> / <c>lastLockChange</c> / <c>sentryUptime</c> /
/// <c>totalEvents</c> props plus the parent's <c>isLoading</c> flag) and it renders the web's responsive grid
/// (<c>grid-cols-1 sm:grid-cols-2 lg:grid-cols-4</c>) of four metric tiles. While the parent fetches it shows
/// four tokenized <see cref="TsSkeleton"/> tiles (web <c>&lt;Skeleton height={88}/&gt;</c>); once resolved it
/// shows the four <see cref="TsMetricCard"/> tiles (web <c>&lt;MetricCard&gt;</c>) — Current Status (secure ⇒
/// success / unsecure ⇒ danger), Last Lock Change (cyan, relative time), Sentry Uptime (blue, percent) and Total
/// Events (purple, count) — entering through a single <see cref="TsFadeIn"/> (the native mapping of the web
/// <c>&lt;FadeIn&gt;</c>, honouring reduce-motion). The view never performs HTTP; all branch selection, label and
/// value resolution and relative-time formatting happen in the WinUI-free <see cref="SummaryStatsRowProjection"/>.
/// Every string resolves through the i18n facade, each tile and the surface carry a Narrator name, and the
/// loading grid announces itself through a live region.
/// </summary>
public sealed partial class SummaryStatsRow : ContentControl
{
    private const double SkeletonTileHeight = 88; // web <Skeleton height={88}/>
    private const double TileGap = 16;            // web gap-4
    private const double SmBreakpoint = 600;      // web sm: — two columns at/above this width
    private const double LgBreakpoint = 960;      // web lg: — four columns at/above this width

    private readonly ILocalizer _localizer;
    private readonly SummaryStatsRowDiagnostics _diagnostics;

    private SummaryStatsRowModel _model;
    private bool _opened;
    private int _columns = SummaryStatsRowProjection.TileCount;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SummaryStatsRowModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SummaryStatsRow(
        ILocalizer localizer,
        SummaryStatsRowModel? model = null,
        SummaryStatsRowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SummaryStatsRowModel.Pending;
        _diagnostics = diagnostics ?? new SummaryStatsRowDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SummaryStatsRow</c>).</summary>
    public static string Slug => SummaryStatsRowRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SummaryStatsRowModel Model
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = ColumnsForWidth(e.NewSize.Width);
        if (desired != _columns)
        {
            _columns = desired;
            Render();
        }
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        // web: grid-cols-1 sm:grid-cols-2 lg:grid-cols-4.
        <= 0 => SummaryStatsRowProjection.TileCount,
        < SmBreakpoint => 1,
        < LgBreakpoint => 2,
        _ => SummaryStatsRowProjection.TileCount,
    };

    private void Render()
    {
        var display = SummaryStatsRowProjection.Project(_model, _localizer, DateTimeOffset.Now);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State == SummaryStatsRowState.Loading
            ? BuildLoading(display)
            : BuildReady(display);
    }

    // ── Loading (parent still fetching the security history) ─────────────────────────────────────────────
    private Grid BuildLoading(SummaryStatsRowDisplay display)
    {
        var grid = BuildGrid();
        for (int i = 0; i < SummaryStatsRowProjection.TileCount; i++)
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

    // ── Ready (the web render: FadeIn over the four metric tiles) ────────────────────────────────────────
    private TsFadeIn BuildReady(SummaryStatsRowDisplay display)
    {
        var grid = BuildGrid();
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

    private static TsMetricCard BuildTile(SummaryStat card)
    {
        var tile = new TsMetricCard
        {
            Label = card.Label,
            Value = card.Value,
            AccentBrushKey = card.AccentBrushKey,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private Grid BuildGrid()
    {
        var grid = new Grid { ColumnSpacing = TileGap, RowSpacing = TileGap };
        for (int c = 0; c < _columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(SummaryStatsRowProjection.TileCount / (double)_columns);
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
}
