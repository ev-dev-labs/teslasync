using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Charge Cost Tracker dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargeCostTrackerWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping either the
/// compact big-number total cost (1×1), or the standard two-up metric grid (Total Energy / Total Cost)
/// plus — when tall (rows≥2) — a second metric row (Cost / distance, vs Gas Savings) or, when short, a
/// compact footer line. When the 30-day window holds no charging sessions the surface renders a friendly
/// "No charge data" empty state (the web <c>hasData</c> gate). All data flows through the shared
/// <see cref="ChargeCostTrackerViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ChargeCostTrackerWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ChargeCostTrackerViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargeCostTrackerDiagnostics _diagnostics;
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

    /// <summary>Creates the surface over its data source, localizer, footprint, units, settings and diagnostics.</summary>
    public ChargeCostTrackerWidget(
        IChargeCostTrackerSource source,
        ILocalizer localizer,
        ChargeCostTrackerSize size,
        UnitPref? units = null,
        ChargeCostTrackerSettings? settings = null,
        ChargeCostTrackerDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargeCostTrackerDiagnostics();
        _viewModel = new ChargeCostTrackerViewModel(source, localizer, size, units, settings, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>charge-cost-tracker</c>).</summary>
    public static string RegistryId => ChargeCostTrackerRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the metrics for the new layout.</summary>
    public ChargeCostTrackerSize WidgetSize
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

    /// <summary>The monetary/fuel preferences; reassigning re-projects rate, currency and gas comparison.</summary>
    public ChargeCostTrackerSettings Settings
    {
        get => _viewModel.Settings;
        set => _viewModel.Settings = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargeCostTrackerSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargeCostTrackerWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargeCostTrackerSize? size = null,
        UnitPref? units = null,
        ChargeCostTrackerSettings? settings = null,
        long? vehicleId = null,
        ChargeCostTrackerDiagnostics? diagnostics = null)
    {
        var source = new ChargeCostTrackerSource(vehicles, api, engine, options, vehicleId);
        return new ChargeCostTrackerWidget(
            source, localizer, size ?? ChargeCostTrackerRegistration.DefaultSize, units, settings, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = ChargeCostTrackerProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(ChargeCostTrackerProjection.HeaderAccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargeCost.refresh", "Refresh charging costs"));
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
            case ChargeCostTrackerState.Loading:
                Content = BuildLoading();
                break;

            case ChargeCostTrackerState.Error:
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
        // Web parity: the compact layout uses a title-less WidgetShell.
        _titleRow.Visibility = _viewModel.Display.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        if (!display.HasData)
        {
            return BuildEmpty();
        }

        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargeCost.loading", "Loading charging costs"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargeCost.error", "Couldn't load charging costs"),
            ActionText = _localizer.GetString("widget.chargeCost.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ChargeCostTrackerProjection.HeaderGlyph,
        Message = _viewModel.Display.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(ChargeCostTrackerDisplay display)
    {
        var value = new TextBlock
        {
            Text = display.CompactValue,
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.CompactLabel.ToUpper(CultureInfo.CurrentCulture),
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
        column.Children.Add(value);
        column.Children.Add(label);
        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static StackPanel BuildStandard(ChargeCostTrackerDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(BuildTileRow(display.Energy, display.Cost));

        if (display.IsTall && display.CostPerDistance is { } cpd && display.GasSavings is { } gas)
        {
            column.Children.Add(BuildTileRow(cpd, gas));
        }
        else if (!display.IsTall)
        {
            column.Children.Add(BuildFooter(display));
        }

        return column;
    }

    private static Grid BuildTileRow(ChargeCostTrackerTile left, ChargeCostTrackerTile right)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var leftTile = BuildTile(left);
        var rightTile = BuildTile(right);
        Grid.SetColumn(leftTile, 0);
        Grid.SetColumn(rightTile, 1);
        grid.Children.Add(leftTile);
        grid.Children.Add(rightTile);
        return grid;
    }

    private static Border BuildTile(ChargeCostTrackerTile tile)
    {
        var glyph = new FontIcon
        {
            Glyph = tile.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(tile.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var labelText = new TextBlock
        {
            Text = tile.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(glyph);
        header.Children.Add(labelText);

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(header);
        column.Children.Add(new TextBlock
        {
            Text = tile.Value,
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        if (!string.IsNullOrEmpty(tile.Subtitle))
        {
            column.Children.Add(new TextBlock
            {
                Text = tile.Subtitle,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        var border = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
        };
        AutomationProperties.SetName(border, tile.AutomationName);
        return border;
    }

    private static Grid BuildFooter(ChargeCostTrackerDisplay display)
    {
        var grid = new Grid { Padding = new Thickness(4, 0, 4, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new TextBlock
        {
            Text = display.FooterLeft,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var right = new TextBlock
        {
            Text = display.FooterRight,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
