using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Destination ETA dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/DestinationETAWidget.tsx. It mirrors the web <c>WidgetShell</c> (a skeleton
/// while loading, a retry surface on error, otherwise a freshness header above the body) and reproduces the web's
/// two size-driven layouts: a compact (1×2) layout with no title that shows either the big ETA-minutes number or
/// the location badge, and a standard (2×2+) layout titled "Destination ETA" that shows either the full
/// navigation body (destination name, ETA countdown + remaining distance, a progress bar) or the location badge
/// plus a "No active navigation" note. When the response carries no location snapshot, a friendly
/// "No location data" empty state (the web <c>!snapshot ? &lt;EmptyState&gt; : …</c> gate). All data flows through
/// the shared <see cref="DestinationETAViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DestinationETAWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const string NavigationGlyph = "\uE707"; // Segoe Fluent — Location (web Navigation2 / maps category)

    private readonly DestinationETAViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DestinationETADiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 6,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _titleIcon = new()
    {
        Glyph = NavigationGlyph,
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
    /// <param name="source">The cache-then-network location-snapshot source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (drives the compact vs standard layout).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public DestinationETAWidget(
        IDestinationETASource source,
        ILocalizer localizer,
        DestinationETASize size,
        UnitPref? units = null,
        DestinationETADiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DestinationETADiagnostics();
        _viewModel = new DestinationETAViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>destination-eta</c>).</summary>
    public static string RegistryId => DestinationETARegistration.Id;

    /// <summary>The widget footprint; reassigning switches between the compact and standard layouts.</summary>
    public DestinationETASize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the remaining distance.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DestinationETASource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static DestinationETAWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        DestinationETASize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        DestinationETADiagnostics? diagnostics = null)
    {
        var source = new DestinationETASource(vehicles, api, engine, options, vehicleId);
        return new DestinationETAWidget(source, localizer, size ?? DestinationETARegistration.DefaultSize, units, diagnostics);
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.destinationETA.refresh", "Refresh destination ETA"));
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

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(16, 4, 16, 12);

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
            case DestinationETAState.Loading:
                Content = BuildLoading();
                break;

            case DestinationETAState.Error:
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
        // Web parity: the compact (1×2) branch renders WidgetShell with no title/icon — only the freshness chrome.
        _titleRow.Visibility = _viewModel.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            // Web parity: no snapshot (snapshot == null) renders the "No location data" surface.
            return BuildEmpty();
        }

        return _viewModel.IsCompact ? BuildCompactBody(display) : BuildStandardBody(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 28 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.destinationETA.loading", "Loading destination ETA"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.destinationETA.error", "Couldn't load destination ETA"),
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
        IconGlyph = NavigationGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact (1×2) body (web isCompact branch) ──
    private static StackPanel BuildCompactBody(DestinationETADisplay display)
    {
        var column = new StackPanel
        {
            Spacing = display.IsNavigating ? 4 : 6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinHeight = 44, // Windows 11 minimum touch / focus target (web min-h-[44px]).
        };

        if (display.IsNavigating)
        {
            // Web parity: <WidgetBigNumber value={round(min)} unit="min" label="ETA" />.
            column.Children.Add(BuildBigNumber(display, DisplayTokens.TextPrimary, valueSize: 30));
        }
        else
        {
            column.Children.Add(BuildLocationGlyph(display, fontSize: 24));
            column.Children.Add(BuildLocationBadge(display));
        }

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // ── Standard (2×2+) body (web non-compact branch) ──
    private static StackPanel BuildStandardBody(DestinationETADisplay display)
    {
        return display.IsNavigating ? BuildNavigationBody(display) : BuildLocationBody(display);
    }

    // Web parity: the full navigating layout — destination row, ETA + distance row, progress bar.
    private static StackPanel BuildNavigationBody(DestinationETADisplay display)
    {
        var column = new StackPanel { Spacing = 10, VerticalAlignment = VerticalAlignment.Center };

        column.Children.Add(BuildDestinationRow(display));
        column.Children.Add(BuildEtaDistanceRow(display));
        column.Children.Add(BuildProgressSection(display));

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // Web parity: <div className="flex items-center gap-2"> — nav icon + truncated destination name.
    private static Grid BuildDestinationRow(DestinationETADisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8, MinHeight = 44, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = NavigationGlyph,
            FontSize = 16,
            Foreground = InfoBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);

        var name = new TextBlock
        {
            Text = display.DestinationName,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 1);

        grid.Children.Add(icon);
        grid.Children.Add(name);
        return grid;
    }

    // Web parity: <div className="flex items-center justify-between"> — ETA countdown (left) + distance (right).
    private static Grid BuildEtaDistanceRow(DestinationETADisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // ETA: big cyan number + the hour/minute detail caption.
        var etaColumn = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        etaColumn.Children.Add(new TextBlock
        {
            Text = ScalarFormatters.FormatNumber(display.EtaMinutes, 0),
            FontSize = 30,
            FontWeight = FontWeights.Bold,
            Foreground = InfoBrush(),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        etaColumn.Children.Add(Caption(display.EtaDetailText));
        Grid.SetColumn(etaColumn, 0);

        // Distance: value + unit caption.
        var distanceColumn = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        distanceColumn.Children.Add(new TextBlock
        {
            Text = display.DistanceText,
            FontSize = 20,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        distanceColumn.Children.Add(Caption(display.DistanceUnitLabel));
        Grid.SetColumn(distanceColumn, 1);

        grid.Children.Add(etaColumn);
        grid.Children.Add(distanceColumn);
        AutomationProperties.SetName(grid, $"{display.EtaLabel} {ScalarFormatters.FormatNumber(display.EtaMinutes, 0)} {display.MinLabel}, {display.DistanceText} {display.DistanceUnitLabel}");
        return grid;
    }

    // Web parity: progress track (bg surface) + gradient fill (cyan→blue) and a "Remaining … distance" caption row.
    private static StackPanel BuildProgressSection(DestinationETADisplay display)
    {
        var section = new StackPanel { Spacing = 4 };
        section.Children.Add(BuildProgressBar(display.ProgressPercent));

        var captionRow = new Grid();
        captionRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        captionRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var remaining = Caption(display.RemainingLabel);
        remaining.HorizontalAlignment = HorizontalAlignment.Left;
        Grid.SetColumn(remaining, 0);

        var remainingValue = Caption($"{display.DistanceText} {display.DistanceUnitLabel}");
        remainingValue.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(remainingValue, 1);

        captionRow.Children.Add(remaining);
        captionRow.Children.Add(remainingValue);
        section.Children.Add(captionRow);
        return section;
    }

    private static Border BuildProgressBar(double percent)
    {
        double fill = Math.Clamp(percent, 0, 100);

        var columns = new Grid();
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(fill, GridUnitType.Star) });
        columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100 - fill, GridUnitType.Star) });

        var fillBar = new Border
        {
            CornerRadius = new CornerRadius(999),
            Background = ProgressGradient(),
        };
        Grid.SetColumn(fillBar, 0);
        columns.Children.Add(fillBar);

        var track = new Border
        {
            Height = 8,
            CornerRadius = new CornerRadius(999),
            Background = TrackBrush(),
            Child = columns,
        };
        return track;
    }

    private static StackPanel BuildLocationBody(DestinationETADisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildLocationGlyph(display, fontSize: 30));
        column.Children.Add(BuildLocationBadge(display));
        column.Children.Add(new TextBlock
        {
            Text = display.NoNavLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // Web parity: <WidgetBigNumber> — a big value, an inline unit and a small uppercase label below.
    private static StackPanel BuildBigNumber(DestinationETADisplay display, Brush valueBrush, double valueSize)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        valueRow.Children.Add(new TextBlock
        {
            Text = ScalarFormatters.FormatNumber(display.EtaMinutes, 0),
            FontSize = valueSize,
            FontWeight = FontWeights.Bold,
            Foreground = valueBrush,
            VerticalAlignment = VerticalAlignment.Bottom,
        });
        valueRow.Children.Add(new TextBlock
        {
            Text = display.MinLabel,
            FontSize = 16,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Bottom,
        });
        column.Children.Add(valueRow);
        column.Children.Add(Caption(display.EtaLabel));
        return column;
    }

    private static TextBlock BuildLocationGlyph(DestinationETADisplay display, double fontSize)
    {
        var glyph = new TextBlock
        {
            Text = display.LocationEmoji,
            FontSize = fontSize,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        // Web parity: role="img" aria-label={locBadge.label} — name the emoji, expose it as an image.
        AutomationProperties.SetName(glyph, display.LocationLabel);
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Content);
        return glyph;
    }

    private static TsBadge BuildLocationBadge(DestinationETADisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.LocationStatus,
            Content = display.LocationLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.LocationLabel);
        return badge;
    }

    private static TextBlock Caption(string text) => new()
    {
        Text = text,
        FontSize = 10,
        Foreground = DisplayTokens.TextMuted,
        CharacterSpacing = 80,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    // Web parity: the progress track is the elevated --surface-2; a low-opacity overlay keeps it theme-aware.
    private static SolidColorBrush TrackBrush() => new(Microsoft.UI.Colors.White) { Opacity = 0.1 };

    // Web parity: bg-gradient-to-r from-cyan-500 to-blue-500 (a dynamic computed gradient).
    private static LinearGradientBrush ProgressGradient()
    {
        var brush = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0.5),
            EndPoint = new Windows.Foundation.Point(1, 0.5),
        };
        brush.GradientStops.Add(new GradientStop { Color = Rgb(0x06, 0xB6, 0xD4), Offset = 0 });
        brush.GradientStops.Add(new GradientStop { Color = Rgb(0x3B, 0x82, 0xF6), Offset = 1 });
        return brush;
    }

    private static Windows.UI.Color Rgb(byte r, byte g, byte b) => Windows.UI.Color.FromArgb(255, r, g, b);

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
