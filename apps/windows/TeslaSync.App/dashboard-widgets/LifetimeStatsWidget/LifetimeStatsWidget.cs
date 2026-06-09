using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Lifetime Stats dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping either the
/// compact big-number distance with a "{unit} lifetime" caption (1×N), or the <c>WidgetStatGrid</c> of
/// metric tiles — four core totals (distance, drives, energy, CO₂) at the standard 2-up footprint, plus
/// three more (total cost, ownership days, average daily distance) in a 4-up grid when wide (cols ≥ 3);
/// or a friendly empty state when the lifetime endpoint returns no body. All data flows through the
/// shared <see cref="LifetimeStatsViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class LifetimeStatsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly LifetimeStatsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LifetimeStatsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units, currency and diagnostics.</summary>
    public LifetimeStatsWidget(
        ILifetimeStatsSource source,
        ILocalizer localizer,
        LifetimeStatsSize size,
        UnitPref? units = null,
        string? currencySymbol = null,
        LifetimeStatsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LifetimeStatsDiagnostics();
        _viewModel = new LifetimeStatsViewModel(source, localizer, size, units, currencySymbol, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>lifetime-stats</c>).</summary>
    public static string RegistryId => LifetimeStatsRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the metrics for the new layout.</summary>
    public LifetimeStatsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the metrics in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>The currency symbol used for the total-cost tile; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LifetimeStatsSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static LifetimeStatsWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        LifetimeStatsSize? size = null,
        UnitPref? units = null,
        string? currencySymbol = null,
        long? vehicleId = null,
        LifetimeStatsDiagnostics? diagnostics = null)
    {
        var source = new LifetimeStatsSource(vehicles, api, engine, options, vehicleId);
        return new LifetimeStatsWidget(
            source, localizer, size ?? LifetimeStatsRegistration.DefaultSize, units, currencySymbol, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = LifetimeStatsProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.lifetimeStats.refresh", "Refresh lifetime stats"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        switch (_viewModel.State)
        {
            case LifetimeStatsState.Loading:
                Content = BuildLoading();
                break;

            case LifetimeStatsState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Compact (1×N) hides the title row, matching the web compact branch's title-less WidgetShell.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.State == LifetimeStatsState.Empty)
        {
            return BuildEmpty();
        }

        var display = _viewModel.Display;
        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.lifetimeStats.loading", "Loading lifetime stats"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.lifetimeStats.error", "Couldn't load lifetime stats"),
            ActionText = _localizer.GetString("widget.lifetimeStats.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = LifetimeStatsProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(LifetimeStatsDisplay display)
    {
        var number = new TsAnimatedNumber
        {
            Value = display.CompactDistance,
            Precision = 0,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.CompactLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(number);
        column.Children.Add(label);
        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static StackPanel BuildStandard(LifetimeStatsDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildStatGrid(display.Stats, display.IsWide ? 4 : 2));
        return column;
    }

    private static Grid BuildStatGrid(IReadOnlyList<LifetimeStatsStat> stats, int cols)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        int rows = (int)Math.Ceiling(stats.Count / (double)cols);
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < stats.Count; i++)
        {
            var tile = BuildStatTile(stats[i]);
            Grid.SetColumn(tile, i % cols);
            Grid.SetRow(tile, i / cols);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildStatTile(LifetimeStatsStat stat)
    {
        var glyph = new FontIcon
        {
            Glyph = stat.Glyph,
            FontSize = 14,
            Foreground = ChartBrushes.ForIndex(stat.ColorIndex),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var labelText = new TextBlock
        {
            Text = stat.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(glyph);
        header.Children.Add(labelText);

        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Bottom };
        valueRow.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 20,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        });

        if (!string.IsNullOrEmpty(stat.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = stat.Unit,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(0, 0, 0, 2),
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(header);
        column.Children.Add(valueRow);

        var tile = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
        };
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
