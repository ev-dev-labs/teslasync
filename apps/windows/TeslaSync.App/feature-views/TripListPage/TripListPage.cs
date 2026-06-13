using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.Notifications;
using TeslaSync.App.Settings;
using TeslaSync.App.SharedSurfaces;
using Windows.Storage;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// The native WinUI 3 <c>TripListPage</c> — a parity port of the web page
/// <c>web/src/features/trips/pages/TripListPage.tsx</c> (route <c>/trips</c>, nav name <c>Trips</c>). It
/// composes the shared <see cref="PageContainer"/> chrome (title + subtitle) around the web page's section
/// stack: the four-up summary metric grid (Total Distance / Energy Used / Total Cost / Total Trips — a skeleton
/// grid while loading); the "Top Trips by Distance" <see cref="TsChartContainer"/> hosting a native horizontal
/// bar chart with CSV / JSON export affordances and an accessible data-table alternative; the "All Trips" glass
/// panel listing each trip as its own glass row (name, date, duration, drive + charge tallies, unit-converted
/// distance, unit-aware energy, efficiency and optional cost) or a friendly empty state; and the client-side
/// pager. The view is a thin renderer — all state selection, formatting and i18n happen in the
/// <see cref="TripListPageViewModel"/> / <see cref="TripListProjection"/>; distances/energy convert at the
/// display boundary only (web <c>useUnits</c>); state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class TripListPage : UserControl, IDisposable
{
    private const double SectionSpacing = 16;
    private const double StatSpacing = 12;
    private const double RowSpacing = 12;
    private const double SkeletonHeight = 84;
    private const double BarRowHeight = 26;
    private const double AvatarSize = 40;

    private readonly TripListPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;
    private bool _ownsSettings;
    private bool _suppressPager;

    private readonly PageContainer _container;

    private readonly Grid _statsHost = new() { ColumnSpacing = StatSpacing, RowSpacing = StatSpacing };

    private readonly TsChartContainer _chart = new();
    private readonly StackPanel _chartBody = new() { Spacing = 8 };
    private readonly TsButton _exportCsv = new() { Variant = ButtonVariant.Subtle, IconGlyph = TripListRegistration.ExportGlyph };
    private readonly TsButton _exportJson = new() { Variant = ButtonVariant.Subtle, IconGlyph = TripListRegistration.ExportGlyph };

    private readonly PanelTitle _listHeading = new();
    private readonly StackPanel _rowsStack = new() { Spacing = RowSpacing };
    private readonly TsEmptyState _listEmpty = new() { IconGlyph = TripListRegistration.RouteGlyph };
    private readonly Grid _listBody = new();

    private readonly TsPagination _pager = new() { PageSize = TripListProjection.DisplayPageSize };
    private readonly TsFadeIn _pagerHost;

    /// <summary>Creates the page over the default empty trips source and the shell resource localizer.</summary>
    public TripListPage()
        : this(EmptyTripListSource.Instance, ShellLocalizer.Instance)
    {
        // App composition root: bind the live unit preference and track committed changes so the distances /
        // energy / efficiency re-project when the user switches metric/imperial (web useUnits()).
        ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += OnSettingsChanged;
        _ownsSettings = true;
    }

    /// <summary>Creates the page over an explicit trips source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The cache-then-network trips port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TripListPage(ITripListSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new TripListPageViewModel(source, localizer);
        _container = new PageContainer(localizer, TripListProjection.Title(localizer));
        _pagerHost = new TsFadeIn { DelayMs = 200 };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildLayout();

        _exportCsv.Click += OnExportCsv;
        _exportJson.Click += OnExportJson;
        _pager.PageChanged += OnPageChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Trips</c>).</summary>
    public static string RouteName => TripListRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TripListPageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TripListSource"/> from the shared data
    /// layer (the generated client + cache-then-network engine + the vehicle scope source).
    /// </summary>
    /// <param name="vehicles">The vehicle scope source (web <c>useSelectedVehicle</c>).</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleId">An explicit vehicle id; null uses the primary cached vehicle (or the fleet).</param>
    /// <returns>The fully wired page.</returns>
    public static TripListPage Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(localizer);

        var source = new TripListSource(vehicles, api, engine, options, vehicleId);
        var page = new TripListPage(source, localizer);

        // App composition root: bind the live unit preference (the explicit-source ctor leaves it on metric).
        page.ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += page.OnSettingsChanged;
        page._ownsSettings = true;
        return page;
    }

    private PageContainer BuildLayout()
    {
        for (int i = 0; i < 4; i++)
        {
            _statsHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        // Chart: header export affordances + accessible data-table alternative.
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(_exportCsv);
        actions.Children.Add(_exportJson);
        _chart.Actions = actions;
        _chart.Body = _chartBody;

        // All-Trips list: heading + (rows | empty state).
        _listEmpty.Visibility = Visibility.Collapsed;
        _listBody.Children.Add(_rowsStack);
        _listBody.Children.Add(_listEmpty);
        var listStack = new StackPanel { Spacing = StatSpacing };
        listStack.Children.Add(_listHeading);
        listStack.Children.Add(_listBody);
        var listPanel = new TsGlassPanel { Content = listStack, Padding = new Thickness(20) };

        _pager.HorizontalAlignment = HorizontalAlignment.Right;
        _pagerHost.Content = _pager;

        var body = new StackPanel { Spacing = SectionSpacing };
        body.Children.Add(new TsFadeIn { DelayMs = 50, Content = _statsHost });
        body.Children.Add(new TsFadeIn { DelayMs = 100, Content = _chart });
        body.Children.Add(new TsFadeIn { DelayMs = 150, Content = listPanel });
        body.Children.Add(_pagerHost);

        _container.Subtitle = TripListProjection.Subtitle(_localizer);
        _container.PageContent = body;
        return _container;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSettingsChanged(object? sender, AppSettings settings)
    {
        if (settings is null)
        {
            return;
        }

        if (_dispatcher.HasThreadAccess)
        {
            ApplyUnits(settings.ToUnitPref());
        }
        else
        {
            _dispatcher.TryEnqueue(() => ApplyUnits(settings.ToUnitPref()));
        }
    }

    private void ApplyUnits(UnitPref units) => _viewModel.Units = units;

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnPageChanged(object? sender, int page)
    {
        if (_suppressPager)
        {
            return;
        }

        _viewModel.GoToPage(page);
    }

    private void Render(TripListDisplay display)
    {
        if (_disposed)
        {
            return;
        }

        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;

        RenderStats(display);
        RenderChart(display);
        RenderList(display);
        RenderPager(display);

        AutomationProperties.SetName(this, display.Title);
    }

    private void RenderStats(TripListDisplay display)
    {
        _statsHost.Children.Clear();

        if (display.State == TripListState.Loading)
        {
            for (int i = 0; i < 4; i++)
            {
                var skeleton = new TsSkeleton { BlockHeight = SkeletonHeight, Radius = 12 };
                Grid.SetColumn(skeleton, i);
                _statsHost.Children.Add(skeleton);
            }

            return;
        }

        for (int i = 0; i < display.StatCards.Count; i++)
        {
            var stat = display.StatCards[i];
            var card = new TsMetricCard
            {
                Label = stat.Label,
                Value = stat.Value,
                DeltaText = stat.Sublabel,
                AccentBrushKey = stat.AccentBrushKey,
            };
            AutomationProperties.SetName(card, stat.AutomationName);
            Grid.SetColumn(card, i);
            _statsHost.Children.Add(card);
        }
    }

    private void RenderChart(TripListDisplay display)
    {
        _chart.Title = display.ChartTitle;
        _chart.AccessibleSummary = display.ChartAriaLabel;
        _chart.EmptyMessage = display.ChartEmptyMessage;
        _chart.DataViewLabel = display.ChartDataTableLabel;
        _exportCsv.Text = display.ExportCsvLabel;
        _exportJson.Text = display.ExportJsonLabel;
        AutomationProperties.SetName(_exportCsv, display.ExportCsvLabel);
        AutomationProperties.SetName(_exportJson, display.ExportJsonLabel);

        if (display.State == TripListState.Loading)
        {
            _chart.State = ChartState.Loading;
            return;
        }

        if (!display.HasChart)
        {
            _chart.State = ChartState.Empty;
            _chartBody.Children.Clear();
            return;
        }

        _chart.State = ChartState.Ready;
        BuildChartBars(display);
        _chart.DataView.Series = BuildChartSeries(display);
        _chart.DataView.XLabel = display.ChartTripColumnLabel;
    }

    private void BuildChartBars(TripListDisplay display)
    {
        _chartBody.Children.Clear();
        var fill = DisplayTokens.Brush(TripListProjection.CyanAccentBrushKey);

        foreach (var bar in display.ChartBars)
        {
            var row = new Grid { Height = BarRowHeight };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto, MinWidth = 96 });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var name = new TextBlock
            {
                Text = bar.Name,
                MaxWidth = 120,
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = DisplayTokens.TextSecondary,
                FontSize = 12,
                Margin = new Thickness(0, 0, 8, 0),
            };
            AutomationProperties.SetAccessibilityView(name, AccessibilityView.Raw);
            Grid.SetColumn(name, 0);

            var track = new Grid { VerticalAlignment = VerticalAlignment.Center };
            track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.0001, bar.Ratio), GridUnitType.Star) });
            track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.0001, 1 - bar.Ratio), GridUnitType.Star) });
            var fillBar = new Border
            {
                Background = fill,
                CornerRadius = new CornerRadius(0, 4, 4, 0),
                Height = 16,
                MinWidth = bar.Ratio > 0 ? 2 : 0,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Grid.SetColumn(fillBar, 0);
            track.Children.Add(fillBar);
            Grid.SetColumn(track, 1);

            var value = new TextBlock
            {
                Text = bar.DistanceText,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = DisplayTokens.TextSecondary,
                FontSize = 12,
                Margin = new Thickness(8, 0, 0, 0),
            };
            AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
            Grid.SetColumn(value, 2);

            row.Children.Add(name);
            row.Children.Add(track);
            row.Children.Add(value);
            AutomationProperties.SetName(row, bar.AutomationName);
            _chartBody.Children.Add(row);
        }
    }

    private static ChartSeries[] BuildChartSeries(TripListDisplay display)
    {
        var points = new List<ChartPoint>(display.ChartBars.Count);
        for (int i = 0; i < display.ChartBars.Count; i++)
        {
            var bar = display.ChartBars[i];
            points.Add(new ChartPoint(i, bar.DistanceValue, bar.Name));
        }

        return new[]
        {
            new ChartSeries(display.ChartDistanceColumnLabel, points)
            {
                Kind = ChartSeriesKind.Bar,
                Role = ChartRole.Speed,
            },
        };
    }

    private void RenderList(TripListDisplay display)
    {
        _listHeading.Value = display.ListHeading;
        _listEmpty.Message = display.ListEmptyMessage;

        bool hasRows = display.HasRows;
        _rowsStack.Visibility = hasRows ? Visibility.Visible : Visibility.Collapsed;
        _listEmpty.Visibility = hasRows ? Visibility.Collapsed : Visibility.Visible;

        _rowsStack.Children.Clear();
        if (!hasRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _rowsStack.Children.Add(BuildTripRow(row));
        }
    }

    private static TsGlassPanel BuildTripRow(TripRow row)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Left: avatar + name + meta line.
        var avatar = new Border
        {
            Width = AvatarSize,
            Height = AvatarSize,
            CornerRadius = new CornerRadius(AvatarSize / 2),
            Background = DisplayTokens.Brush("TsChartSpeedBrush"),
            Opacity = 0.16,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var avatarHost = new Grid { Width = AvatarSize, Height = AvatarSize, VerticalAlignment = VerticalAlignment.Center };
        avatarHost.Children.Add(avatar);
        avatarHost.Children.Add(new FontIcon
        {
            Glyph = TripListRegistration.RouteGlyph,
            FontSize = 18,
            Foreground = DisplayTokens.Accent,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        meta.Children.Add(MetaCaption(row.DateText));
        meta.Children.Add(MetaCaption(row.DurationText));
        meta.Children.Add(MetaCaption(row.DrivesText));
        if (row.HasCharges)
        {
            meta.Children.Add(MetaCaption(row.ChargesText));
        }

        var nameStack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        var name = new TextBlock
        {
            Text = row.Name,
            FontWeight = FontWeights.SemiBold,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        nameStack.Children.Add(name);
        nameStack.Children.Add(meta);

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(avatarHost);
        left.Children.Add(nameStack);
        Grid.SetColumn(left, 0);

        // Right: distance / energy / optional cost metric stacks.
        var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 24, VerticalAlignment = VerticalAlignment.Center };
        right.Children.Add(MetricStack(row.DistanceText, row.DrivesText, DisplayTokens.TextPrimary));
        right.Children.Add(MetricStack(row.EnergyText, row.EfficiencyText, DisplayTokens.Brush("TsColorWarningBrush")));
        if (row.HasCost)
        {
            right.Children.Add(MetricStack(row.CostText, row.CostCaption, DisplayTokens.Brush("TsChartBatteryBrush")));
        }

        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);

        var panel = new TsGlassPanel { Content = grid, Padding = new Thickness(16) };
        AutomationProperties.SetName(panel, row.AutomationName);
        return panel;
    }

    private static Caption MetaCaption(string value)
    {
        var caption = new Caption { Value = value };
        return caption;
    }

    private static StackPanel MetricStack(string value, string caption, Brush valueBrush)
    {
        var stack = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Right };
        var valueText = new TextBlock
        {
            Text = value,
            FontWeight = FontWeights.Bold,
            FontSize = 14,
            Foreground = valueBrush,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        stack.Children.Add(valueText);
        stack.Children.Add(new Caption { Value = caption, HorizontalAlignment = HorizontalAlignment.Right });
        return stack;
    }

    private void RenderPager(TripListDisplay display)
    {
        bool show = display.HasRows && display.TotalRowCount > display.PageSize;
        _pagerHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show)
        {
            return;
        }

        _suppressPager = true;
        _pager.PageSize = display.PageSize;
        _pager.TotalItems = display.TotalRowCount;
        _pager.Page = display.Page;
        _pager.FirstLabel = _localizer.GetString("common.pagination.first", "First page");
        _pager.PreviousLabel = _localizer.GetString("common.pagination.previous", "Previous page");
        _pager.NextLabel = _localizer.GetString("common.pagination.next", "Next page");
        _pager.LastLabel = _localizer.GetString("common.pagination.last", "Last page");
        _suppressPager = false;
    }

    private async void OnExportCsv(object sender, RoutedEventArgs e)
    {
        string content = TripListProjection.BuildCsv(_viewModel.CurrentTrips, _localizer);
        await SaveExportAsync(content, "CSV", ".csv", "teslasync-trips-v2").ConfigureAwait(true);
    }

    private async void OnExportJson(object sender, RoutedEventArgs e)
    {
        string content = TripListProjection.BuildJson(_viewModel.CurrentTrips);
        await SaveExportAsync(content, "JSON", ".json", "teslasync-trips").ConfigureAwait(true);
    }

    private static async Task SaveExportAsync(string content, string typeName, string extension, string baseName)
    {
        var window = App.MainWindow;
        if (window is null)
        {
            return;
        }

        var picker = new FileSavePicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            SuggestedFileName = baseName,
        };
        picker.FileTypeChoices.Add(typeName, new List<string> { extension });
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));

        var file = await picker.PickSaveFileAsync().AsTask().ConfigureAwait(true);
        if (file is not null)
        {
            await FileIO.WriteTextAsync(file, content, Windows.Storage.Streams.UnicodeEncoding.Utf8).AsTask().ConfigureAwait(true);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_ownsSettings)
        {
            AppSettingsHost.Service.Changed -= OnSettingsChanged;
            _ownsSettings = false;
        }

        _exportCsv.Click -= OnExportCsv;
        _exportJson.Click -= OnExportJson;
        _pager.PageChanged -= OnPageChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
    }
}
