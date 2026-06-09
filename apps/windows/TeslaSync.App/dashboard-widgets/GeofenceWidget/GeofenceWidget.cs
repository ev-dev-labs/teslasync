using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Geofence Status dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/GeofenceWidget.tsx. It mirrors the web <c>WidgetShell</c> (a skeleton while
/// loading, a retry surface on a hard load failure, otherwise a freshness header above the body) and reproduces the
/// web's two size-driven layouts: a compact (1×2) layout with no title that shows a crosshair glyph above a badge
/// for the current zone (or "No zone"), and a standard (2×4) layout titled "Geofence Status" that — when fences
/// exist — optionally draws a map (when the vehicle has a fix and the widget is at least 3 rows tall) with a circle
/// per fence and a vehicle marker, then a scrollable fence list; when no fences are configured it shows a friendly
/// "No geofences configured" empty state (the web <c>isEmpty ? &lt;EmptyState&gt; : …</c> gate). All data flows
/// through the shared <see cref="GeofenceViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class GeofenceWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";    // Segoe Fluent — Refresh
    private const string CrosshairGlyph = "\uE707";  // Segoe Fluent — Location (web Crosshair / maps category)

    // Web parity: bg-green-500/10 ring-1 ring-green-500/30 highlight; #22c55e green / #6b7280 gray map circles.
    private static readonly Windows.UI.Color GreenColor = Windows.UI.Color.FromArgb(0xFF, 0x22, 0xC5, 0x5E);
    private static readonly Windows.UI.Color GrayColor = Windows.UI.Color.FromArgb(0xFF, 0x6B, 0x72, 0x80);

    private readonly GeofenceViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly GeofenceDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _bodyContainer = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _titleIcon = new()
    {
        Glyph = CrosshairGlyph,
        FontSize = 14,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network merged geofence source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (drives the compact vs standard layout and the map).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public GeofenceWidget(
        IGeofenceSource source,
        ILocalizer localizer,
        GeofenceSize size,
        UnitPref? units = null,
        GeofenceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new GeofenceDiagnostics();
        _viewModel = new GeofenceViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>geofence-status</c>).</summary>
    public static string RegistryId => GeofenceRegistration.Id;

    /// <summary>The widget footprint; reassigning switches between the compact and standard layouts.</summary>
    public GeofenceSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects every fence radius.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="GeofenceSource"/> from the shared data layer
    /// (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static GeofenceWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        GeofenceSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        GeofenceDiagnostics? diagnostics = null)
    {
        var source = new GeofenceSource(vehicles, api, engine, options, vehicleId);
        return new GeofenceWidget(source, localizer, size ?? GeofenceRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        _titleIcon.Foreground = InfoBrush();
        AutomationProperties.SetAccessibilityView(_titleIcon, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(_titleIcon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.geofence.refresh", "Refresh geofences"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(16, 12, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyContainer, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyContainer);
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
            case GeofenceState.Loading:
                Content = BuildLoading();
                break;

            case GeofenceState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                SetBody(BuildBody());
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: the compact (1×2) branch renders WidgetShell with no title/icon — only the freshness chrome.
        _titleRow.Visibility = _viewModel.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private void SetBody(UIElement body)
    {
        _bodyContainer.Children.Clear();
        _bodyContainer.Children.Add(body);
    }

    private FrameworkElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            // Web parity: isEmpty → the "No geofences configured" empty surface.
            return BuildEmpty();
        }

        return _viewModel.IsCompact ? BuildCompactBody(display) : BuildStandardBody(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 96 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.geofence.loading", "Loading geofences"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.geofence.error", "Couldn't load geofences"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CrosshairGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact (1×2) body (web isCompact branch) ──
    private static StackPanel BuildCompactBody(GeofenceDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = 44, // Windows 11 minimum touch / focus target (web min-h-[44px]).
        };

        var icon = new FontIcon
        {
            Glyph = CrosshairGlyph,
            FontSize = 20,
            Foreground = InfoBrush(),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        column.Children.Add(icon);

        var badge = new TsBadge
        {
            Status = display.HasCurrentZone ? StatusKind.Success : StatusKind.Neutral,
            Content = display.CompactBadgeLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.CompactBadgeLabel);
        column.Children.Add(badge);

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // ── Standard (2×4) body (web non-compact branch) ──
    private Grid BuildStandardBody(GeofenceDisplay display)
    {
        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // Web parity: showMap = hasCoords && size.rows >= 3 — a map section with a circle per fence + the vehicle.
        if (_viewModel.ShowMap)
        {
            var map = BuildMap(display);
            Grid.SetRow(map, 0);
            grid.Children.Add(map);
        }

        var list = BuildFenceList(display);
        Grid.SetRow(list, 1);
        grid.Children.Add(list);
        return grid;
    }

    private TsMapControl BuildMap(GeofenceDisplay display)
    {
        var map = new TsMapControl
        {
            CenterLat = display.VehicleLatitude,
            CenterLng = display.VehicleLongitude,
            Zoom = 12,
            Height = 160,
            MinHeight = 120,
        };

        foreach (var fence in display.Fences)
        {
            // Web parity: color/fillColor = f.inside ? '#22c55e' : '#6b7280', fillOpacity 0.15.
            var stroke = new SolidColorBrush(fence.Inside ? GreenColor : GrayColor);
            var fill = new SolidColorBrush(fence.Inside ? GreenColor : GrayColor) { Opacity = 0.15 };
            var circle = new TsMapCircle
            {
                Center = new GeoPoint(fence.Latitude, fence.Longitude),
                RadiusMeters = fence.RadiusMeters,
            };
            circle.SetBrushes(stroke, fill);
            map.AddOverlay(circle);
        }

        var marker = new TsMapMarker
        {
            Location = new GeoPoint(display.VehicleLatitude, display.VehicleLongitude),
            LabelText = _localizer.GetString("widget.geofence.vehicleMarker", "Vehicle location"),
        };
        map.AddOverlay(marker);
        map.SetHasGeometry(true);
        return map;
    }

    private static ScrollViewer BuildFenceList(GeofenceDisplay display)
    {
        var list = new StackPanel { Spacing = 6 };
        foreach (var fence in display.Fences)
        {
            list.Children.Add(BuildFenceRow(fence));
        }

        var scroller = new ScrollViewer
        {
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(16, 8, 16, 8),
            Content = list,
        };
        return scroller;
    }

    // Web parity: <li> row — name + "Radius: …" on the left, status badge on the right; inside&&enabled highlighted.
    private static Border BuildFenceRow(GeofenceFenceDisplay fence)
    {
        var content = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock
        {
            Text = fence.Name,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        text.Children.Add(new TextBlock
        {
            Text = fence.RadiusDetail,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });
        Grid.SetColumn(text, 0);
        content.Children.Add(text);

        var badge = BuildStatusBadge(fence);
        Grid.SetColumn(badge, 1);
        content.Children.Add(badge);

        var row = new Border
        {
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 6, 10, 6),
            MinHeight = 44,
            Child = content,
        };

        if (fence.Highlighted)
        {
            row.Background = new SolidColorBrush(GreenColor) { Opacity = 0.10 };
            row.BorderBrush = new SolidColorBrush(GreenColor) { Opacity = 0.30 };
            row.BorderThickness = new Thickness(1);
        }
        else
        {
            row.Background = DisplayTokens.Surface;
        }

        AutomationProperties.SetName(row, fence.AutomationName);
        return row;
    }

    private static TsBadge BuildStatusBadge(GeofenceFenceDisplay fence)
    {
        var badge = new TsBadge
        {
            Status = fence.Status == GeofenceFenceStatus.Inside ? StatusKind.Success : StatusKind.Neutral,
            Dot = fence.Status == GeofenceFenceStatus.Inside,
            Content = fence.StatusLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, fence.StatusLabel);
        return badge;
    }

    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
