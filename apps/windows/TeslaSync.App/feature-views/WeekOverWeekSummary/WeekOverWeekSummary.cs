using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Week-over-Week Comparison surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx. It mirrors the web
/// <c>FadeIn</c> + <c>GlassPanel</c> chrome wrapping a titled, responsive grid of six metric
/// <c>StatCard</c>s (Distance, Drives, Energy, Cost, Efficiency, CO₂ Saved), each carrying a week-over-week
/// trend chip whose arrow + signed percentage + good/bad tint reproduce the web <c>trendFor</c> result. The
/// web component is presentational; the native feature-view owns its weekly-digest read and therefore renders
/// the full state matrix the P2 contract mandates — a loading skeleton, the populated card grid, a friendly
/// empty surface when the digest has no data, an explicit retry surface on hard failure, plus stale and
/// offline freshness chips. All data flows through the shared <see cref="WeekOverWeekSummaryViewModel"/>; the
/// view never performs HTTP. Every string resolves through the i18n facade and every card carries a Narrator
/// name.
/// </summary>
public sealed partial class WeekOverWeekSummary : ContentControl, IDisposable
{
    private const int CardCount = 6;
    private const double FadeInDelayMs = 300; // web FadeIn delay={0.3}
    private const double SmBreakpoint = 640;   // web sm: → 2 columns
    private const double LgBreakpoint = 1024;  // web lg: → 3 columns

    private const string UpArrow = "\u2191";   // web ↑
    private const string DownArrow = "\u2193"; // web ↓
    private const string FlatArrow = "\u2014"; // web —

    private readonly WeekOverWeekSummaryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly WeekOverWeekSummaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly Grid _root = new() { RowSpacing = 16 };
    private readonly Grid _header = new();
    private readonly TextBlock _title = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency symbol and diagnostics.</summary>
    public WeekOverWeekSummary(
        IWeekOverWeekSummarySource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        WeekOverWeekSummaryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WeekOverWeekSummaryDiagnostics();
        _viewModel = new WeekOverWeekSummaryViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>week-over-week-summary</c>).</summary>
    public static string SurfaceId => WeekOverWeekSummaryRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public WeekOverWeekSummaryViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the cost card; reassigning re-projects the metrics.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="WeekOverWeekSummarySource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to <paramref name="vehicleId"/> (the web
    /// page's selected / first vehicle).
    /// </summary>
    public static WeekOverWeekSummary Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        string? currencySymbol = null,
        WeekOverWeekSummaryDiagnostics? diagnostics = null)
    {
        var source = new WeekOverWeekSummarySource(api, engine, options, vehicleId);
        return new WeekOverWeekSummary(source, localizer, currencySymbol, diagnostics);
    }

    private void BuildChrome()
    {
        _title.FontSize = 18;
        _title.FontWeight = FontWeights.Bold;
        _title.Foreground = DisplayTokens.TextPrimary;
        _title.VerticalAlignment = VerticalAlignment.Center;
        _title.TextTrimming = TextTrimming.CharacterEllipsis;

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_freshness, 1);
        _header.Children.Add(_title);
        _header.Children.Add(_freshness);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Padding = new Thickness(24); // web p-6
        _panel.Content = _root;
        _fade.Content = _panel;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.PreviousSize.Width != e.NewSize.Width && _viewModel.Display.HasData)
        {
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        _title.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _freshness.Visibility = _viewModel.State == WeekOverWeekSummaryState.Loading
            ? Visibility.Collapsed
            : Visibility.Visible;
        _bodyHost.Child = BuildBody();
    }

    private UIElement BuildBody() => _viewModel.State switch
    {
        WeekOverWeekSummaryState.Loading => BuildLoading(),
        WeekOverWeekSummaryState.Error => BuildError(),
        WeekOverWeekSummaryState.Empty => BuildEmpty(),
        _ => BuildGrid(_viewModel.Display),
    };

    private Grid BuildGrid(WeekOverWeekDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Cards.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Cards.Count; i++)
        {
            var tile = BuildCardTile(display.Cards[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildCardTile(WeekOverWeekCard card)
    {
        var glyph = new FontIcon
        {
            Glyph = card.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = card.Label,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(label, 0);
        Grid.SetColumn(glyph, 1);
        headerRow.Children.Add(label);
        headerRow.Children.Add(glyph);

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        valueRow.Children.Add(new TextBlock
        {
            Text = card.Value,
            FontSize = 22,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        });

        if (!string.IsNullOrEmpty(card.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = card.Unit,
                FontSize = 13,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(0, 0, 0, 2),
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(headerRow);
        column.Children.Add(valueRow);
        column.Children.Add(BuildTrendChip(card.Trend));

        var tile = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(14, 12, 14, 12),
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private static StackPanel BuildTrendChip(WeekOverWeekTrend trend)
    {
        string arrow = trend.Direction switch
        {
            WeekOverWeekTrendDirection.Up => UpArrow,
            WeekOverWeekTrendDirection.Down => DownArrow,
            _ => FlatArrow,
        };

        // web: trend.positive ? green : direction === 'flat' ? muted : red
        Brush brush = trend.Positive
            ? DisplayTokens.Brush("TsColorSuccessBrush")
            : trend.Direction == WeekOverWeekTrendDirection.Flat
                ? DisplayTokens.TextMuted
                : DisplayTokens.Brush("TsColorDangerBrush");

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 3,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TextBlock { Text = arrow, FontSize = 12, Foreground = brush });
        row.Children.Add(new TextBlock { Text = trend.Value, FontSize = 12, Foreground = brush });
        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private Grid BuildLoading()
    {
        const int columns = 3;
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(CardCount / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < CardCount; i++)
        {
            var tile = new TsSkeleton { BlockHeight = 84 };
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 3,
        < SmBreakpoint => 1,
        < LgBreakpoint => 2,
        _ => 3,
    };

    protected override AutomationPeer OnCreateAutomationPeer() => new WeekOverWeekSummaryAutomationPeer(this);

    private sealed class WeekOverWeekSummaryAutomationPeer(WeekOverWeekSummary owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((WeekOverWeekSummary)Owner).ViewModel.Title
                : name;
        }
    }
}
