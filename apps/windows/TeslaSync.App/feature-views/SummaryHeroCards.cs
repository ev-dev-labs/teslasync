using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SummaryHeroCards</c> feature surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/SummaryHeroCards.tsx. It is the presentational "Week
/// Summary" composite: assign a <see cref="Model"/> (the web <c>metrics</c> + optional <c>funFact</c> props) and
/// it renders the web composition — a single entrance <see cref="TsFadeIn"/> (web <c>&lt;FadeIn delay={0.05}&gt;</c>)
/// over a <see cref="TsGlassPanel"/> (web <c>&lt;GlassPanel&gt;</c>) holding the <see cref="PanelTitle"/> "Week
/// Summary" heading and the responsive grid of <see cref="HighlightCard"/> tiles. The grid reflows 1 → 2 → 3
/// columns across the web <c>sm</c> / <c>lg</c> breakpoints (web <c>grid-cols-1 sm:grid-cols-2 lg:grid-cols-3</c>)
/// and shows the five always-present metric tiles plus the optional fun-fact tile (web <c>{funFact &amp;&amp; …}</c>).
/// While the parent has not resolved the metrics the surface renders the panel
/// chrome over tokenized skeleton tiles — never a blank box. The view never performs HTTP; all branch selection,
/// trend computation, currency / number formatting and copy resolution happen in the WinUI-free
/// <see cref="SummaryHeroCardsProjection"/>. Every string resolves through the i18n facade, each child tile and the
/// surface carry a Narrator name, the loading grid announces itself through a live region, and the entrance motion
/// is the system-honoured <see cref="TsFadeIn"/>, so reduced-motion is respected by construction.
/// </summary>
public sealed partial class SummaryHeroCards : ContentControl
{
    private const int FadeDelayMs = 50;          // web <FadeIn delay={0.05}>
    private const double PanelPadding = 24;       // web p-6
    private const double SectionSpacing = 16;     // web space-y-4
    private const double CardGap = 16;            // web gap-4
    private const double SmBreakpoint = 640;      // web sm: (1 → 2 columns)
    private const double LgBreakpoint = 1024;     // web lg: (2 → 3 columns)
    private const int MaxColumns = 3;             // web lg:grid-cols-3
    private const int LoadingTiles = 6;           // the five metric tiles plus the fun-fact tile
    private const double SkeletonTileHeight = 120; // a skeleton tile ≈ a populated HighlightCard

    private readonly ILocalizer _localizer;
    private readonly SummaryHeroCardsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _root = new() { DelayMs = FadeDelayMs };
    private readonly TsGlassPanel _panel = new() { Padding = new Thickness(PanelPadding) };
    private readonly StackPanel _body = new() { Spacing = SectionSpacing };
    private readonly PanelTitle _title = new();
    private readonly Grid _grid = new() { ColumnSpacing = CardGap, RowSpacing = CardGap };

    private SummaryHeroCardsModel _model;
    private bool _opened;
    private bool _renderQueued;
    private int _columns = MaxColumns;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SummaryHeroCardsModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SummaryHeroCards(
        ILocalizer localizer,
        SummaryHeroCardsModel? model = null,
        SummaryHeroCardsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SummaryHeroCardsModel.Pending;
        _diagnostics = diagnostics ?? new SummaryHeroCardsDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _title.HorizontalAlignment = HorizontalAlignment.Left;
        _body.Children.Add(_title);
        _body.Children.Add(_grid);
        _panel.Content = _body;
        _root.Content = _panel;
        _root.HorizontalAlignment = HorizontalAlignment.Stretch;
        Content = _root;

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SummaryHeroCards</c>).</summary>
    public static string Slug => SummaryHeroCardsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SummaryHeroCardsModel Model
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
            ScheduleRender();
        }
    }

    // web: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3.
    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => MaxColumns,
        < SmBreakpoint => 1,
        < LgBreakpoint => 2,
        _ => MaxColumns,
    };

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        var display = SummaryHeroCardsProjection.Project(_model, _localizer);

        AutomationProperties.SetName(this, display.AutomationName);
        _title.Value = display.WeekSummaryTitle;

        if (display.State == SummaryHeroCardsState.Loading)
        {
            BuildLoading(display);
        }
        else
        {
            BuildReady(display);
        }
    }

    // ── Ready (the web render: the responsive grid of HighlightCard tiles) ───────────────────────────────
    private void BuildReady(SummaryHeroCardsDisplay display)
    {
        ResetGrid(display.Cards.Count);

        for (int i = 0; i < display.Cards.Count; i++)
        {
            var card = new HighlightCard(_localizer, display.Cards[i])
            {
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Place(card, i);
        }
    }

    // ── Loading (parent still resolving the metrics — skeleton chrome, never a blank box) ────────────────
    private void BuildLoading(SummaryHeroCardsDisplay display)
    {
        ResetGrid(LoadingTiles);

        for (int i = 0; i < LoadingTiles; i++)
        {
            var tile = new TsSkeleton
            {
                BlockHeight = SkeletonTileHeight,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Place(tile, i);
        }

        AutomationProperties.SetName(_grid, display.LoadingLabel);
        LiveRegion.Configure(_grid);
        LiveRegion.Announce(_grid);
    }

    private void ResetGrid(int itemCount)
    {
        _grid.Children.Clear();
        _grid.ColumnDefinitions.Clear();
        _grid.RowDefinitions.Clear();
        AutomationProperties.SetName(_grid, string.Empty);

        for (int c = 0; c < _columns; c++)
        {
            _grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = Math.Max(1, (int)Math.Ceiling(itemCount / (double)_columns));
        for (int r = 0; r < rows; r++)
        {
            _grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }
    }

    private void Place(FrameworkElement tile, int index)
    {
        Grid.SetColumn(tile, index % _columns);
        Grid.SetRow(tile, index / _columns);
        _grid.Children.Add(tile);
    }
}
