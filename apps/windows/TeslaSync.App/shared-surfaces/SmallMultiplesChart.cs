using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>SmallMultiplesChart</c> shared surface — a parity port of
/// web/src/components/charts/SmallMultiplesChart.tsx. It is a controlled, presentational grid: bound to an
/// <see cref="ISmallMultiplesChartSource"/> (the P1/S8 seam standing in for the web <c>data</c> / <c>series</c> /
/// layout / <c>onCellClick</c> props), it lays one titled mini-chart cell per series out across a responsive
/// <see cref="VariableSizedWrapGrid"/> (the same native grid idiom the atomic <c>TsSmallMultiplesChart</c> uses;
/// WinUI realizes only the visible cells, the native analogue of the web IntersectionObserver lazy-mount). Each
/// cell shows the series colour dot + label tinted from the brand chart palette, then either a
/// <see cref="TsMiniChart"/> line (web <c>hasData</c>) or the localized "No data" body, plus the formatted x-domain
/// start/end captions (the native binding of the web <c>useDateFormat().formatTime</c> x-axis ticks). When a
/// drill-in handler is supplied each cell is an accessible button carrying its label as the Narrator name (web
/// interactive cell <c>role="button"</c>); otherwise cells are labelled groups. When there are no series the
/// surface shows a single friendly "No data" state rather than a blank box. All state lives in the UI-thread-free
/// <see cref="SmallMultiplesChartViewModel"/>; this view only owns the WinUI wiring — it observes the holder,
/// marshals re-renders onto its captured <see cref="DispatcherQueue"/> and emits the <c>view.opened</c> diagnostic
/// once on load.
/// </summary>
public sealed partial class SmallMultiplesChart : ContentControl, IDisposable
{
    private const double CellGap = 12;                 // web gap-3
    private const double CardPadding = 8;              // web p-2
    private const double CardSpacing = 4;              // web title→body gap
    private const double TitleSpacing = 6;             // web gap-1.5
    private const double DotSize = 8;                  // web h-2 w-2
    private const double LabelFontSize = 12;           // web text-[11px], rounded up for system scale
    private const double BodyFontSize = 12;            // web text-[10px] no-data label, rounded up
    private const double RangeFontSize = 11;           // web axis tick text
    private const double HeaderFooterAllowance = 64;   // title row + range caption + padding + spacing

    private readonly SmallMultiplesChartViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();

    private readonly VariableSizedWrapGrid _grid = new()
    {
        Orientation = Orientation.Horizontal,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TsEmptyState _empty = new()
    {
        Visibility = Visibility.Collapsed,
    };

    private bool _renderQueued;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its chart seam, the localizer, an optional time formatter and diagnostics.</summary>
    /// <param name="source">The chart data/config seam (P1/S8) the grid binds to.</param>
    /// <param name="localizer">The i18n facade the empty-cell label resolves through.</param>
    /// <param name="timeFormatter">The x-axis time formatter (web <c>useDateFormat</c>); null uses the shared default.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SmallMultiplesChart(
        ISmallMultiplesChartSource source,
        ILocalizer localizer,
        ISmallMultiplesTimeFormatter? timeFormatter = null,
        SmallMultiplesChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SmallMultiplesChartViewModel(source, localizer, timeFormatter, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _root;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SmallMultiplesChart</c>).</summary>
    public static string Slug => SmallMultiplesChartRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SmallMultiplesChartViewModel ViewModel => _viewModel;

    /// <summary>Detach from the view-model and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SmallMultiplesChartAutomationPeer(this);

    private void BuildChrome()
    {
        _root.Children.Add(_grid);
        _root.Children.Add(_empty);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        AutomationProperties.SetAutomationId(this, SmallMultiplesChartRegistration.RootAutomationId);

        if (_viewModel.IsEmpty)
        {
            // web grid with no series renders an empty container; the native surface keeps the region meaningful
            // with a single friendly "No data" state rather than a blank box.
            _grid.Children.Clear();
            _grid.Visibility = Visibility.Collapsed;
            _empty.Message = _viewModel.NoDataLabel;
            _empty.Visibility = Visibility.Visible;
            return;
        }

        _empty.Visibility = Visibility.Collapsed;
        _grid.Visibility = Visibility.Visible;
        _grid.MaximumRowsOrColumns = _viewModel.Columns is { } columns && columns > 0 ? columns : -1;
        _grid.ItemWidth = _viewModel.CellMinWidth + CellGap;
        _grid.ItemHeight = _viewModel.CellHeight + HeaderFooterAllowance + CellGap;

        _grid.Children.Clear();
        string noData = _viewModel.NoDataLabel;
        bool interactive = _viewModel.IsInteractive;
        foreach (var cell in _viewModel.Cells)
        {
            _grid.Children.Add(BuildCell(cell, noData, interactive));
        }
    }

    private FrameworkElement BuildCell(SmallMultiplesCell cell, string noData, bool interactive)
    {
        var stack = new StackPanel { Spacing = CardSpacing };
        stack.Children.Add(BuildTitleRow(cell));
        stack.Children.Add(cell.HasData ? BuildChartBody(cell) : BuildNoDataBody(noData));
        if (cell.HasData && cell.RangeStartLabel is not null && cell.RangeEndLabel is not null)
        {
            stack.Children.Add(BuildRangeCaption(cell));
        }

        var card = new Border
        {
            Child = stack,
            Padding = new Thickness(CardPadding),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        var cellMargin = new Thickness(0, 0, CellGap, CellGap);
        if (!interactive)
        {
            card.Margin = cellMargin;
            AutomationProperties.SetName(card, cell.Label);
            return card;
        }

        // web interactive cell: role="button", Enter/Space activates, drill-in on click. A base WinUI Button gives
        // keyboard activation, focus visuals and the Invoke automation pattern for free.
        var button = new Button
        {
            Content = card,
            Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Margin = cellMargin,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(button, cell.Label);
        ToolTipService.SetToolTip(button, cell.Label);
        string key = cell.Key;
        button.Click += (_, _) => _viewModel.SelectCell(key);
        return button;
    }

    private static StackPanel BuildTitleRow(SmallMultiplesCell cell)
    {
        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleSpacing,
        };

        var brush = DisplayTokens.Brush(cell.ColorBrushKey);
        titleRow.Children.Add(DisplayPrimitives.Dot(brush, DotSize));

        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = LabelFontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = brush,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTipService.SetToolTip(label, cell.Label);
        titleRow.Children.Add(label);
        return titleRow;
    }

    private TsMiniChart BuildChartBody(SmallMultiplesCell cell)
    {
        var series = new ChartSeries(cell.Key, cell.Points)
        {
            Kind = ChartSeriesKind.Line,
            ColorIndex = cell.ColorIndex,
        };

        return new TsMiniChart
        {
            Series = series,
            Height = _viewModel.CellHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    private Border BuildNoDataBody(string noData)
    {
        return new Border
        {
            Height = _viewModel.CellHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Child = new TextBlock
            {
                Text = noData,
                FontSize = BodyFontSize,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            },
        };
    }

    private static Grid BuildRangeCaption(SmallMultiplesCell cell)
    {
        var footer = new Grid();
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var start = new TextBlock
        {
            Text = cell.RangeStartLabel,
            FontSize = RangeFontSize,
            Foreground = DisplayTokens.TextMuted,
        };
        Grid.SetColumn(start, 0);
        footer.Children.Add(start);

        var end = new TextBlock
        {
            Text = cell.RangeEndLabel,
            FontSize = RangeFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(end, 1);
        footer.Children.Add(end);
        return footer;
    }

    /// <summary>
    /// Exposes the surface as an accessible group of cells so Narrator announces the grouping that wraps the
    /// per-series cells (each cell carries its own series label as its name).
    /// </summary>
    private sealed class SmallMultiplesChartAutomationPeer : FrameworkElementAutomationPeer
    {
        public SmallMultiplesChartAutomationPeer(SmallMultiplesChart owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
