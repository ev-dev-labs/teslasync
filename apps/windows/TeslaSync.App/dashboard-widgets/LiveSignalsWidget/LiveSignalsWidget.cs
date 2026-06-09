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
/// The native WinUI 3 Live Signals dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/LiveSignalsWidget.tsx. It mirrors the web <c>WidgetShell</c> (a Wi-Fi
/// titled freshness header — driven by the motor read, with a retry button) above a 2×2 grid of the four
/// live-signal sections (Motor: Torque / Temp / Gear; Climate: Cabin / Outside / HVAC; Tires: FL / FR / RL / RR;
/// Security: Lock / Sentry chips). Each section independently renders its rows or a skeleton exactly like the web
/// <c>{slice ? rows : &lt;Skeleton/&gt;}</c> gates; when none of the four reads carries a value the body is the
/// friendly "No live signal data" empty surface (the web <c>!hasData</c> gate). All data flows through the
/// shared <see cref="LiveSignalsViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every readout carries a Narrator name.
/// </summary>
public sealed partial class LiveSignalsWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly LiveSignalsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LiveSignalsDiagnostics _diagnostics;
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

    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network merged live-signals source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public LiveSignalsWidget(
        ILiveSignalsSource source,
        ILocalizer localizer,
        LiveSignalsSize size,
        UnitPref? units = null,
        LiveSignalsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveSignalsDiagnostics();
        _viewModel = new LiveSignalsViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>live-signals</c>).</summary>
    public static string RegistryId => LiveSignalsRegistration.Id;

    /// <summary>The widget footprint (registry metadata; the surface renders identically at every size).</summary>
    public LiveSignalsSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the temperatures and pressures.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LiveSignalsSource"/> from the shared data
    /// layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static LiveSignalsWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        LiveSignalsSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        LiveSignalsDiagnostics? diagnostics = null)
    {
        var source = new LiveSignalsSource(vehicles, api, engine, options, vehicleId);
        return new LiveSignalsWidget(source, localizer, size ?? LiveSignalsRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = LiveSignalsProjection.WifiGlyph,
            FontSize = 14,
            Foreground = AccentBrush(StatusKind.Info),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.liveSignals.refresh", "Refresh live signals"));
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
            case LiveSignalsState.Loading:
                Content = BuildLoading();
                break;

            case LiveSignalsState.Error:
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
            // Web parity: no read carried a value (hasData == false) renders the "No live signal data" surface.
            return BuildEmpty();
        }

        return BuildGrid(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120 });

        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var i = 0; i < 4; i++)
        {
            var cell = new TsSkeleton { BlockHeight = 64 };
            Grid.SetRow(cell, i / 2);
            Grid.SetColumn(cell, i % 2);
            grid.Children.Add(cell);
        }

        column.Children.Add(grid);

        AutomationProperties.SetName(column, _localizer.GetString("widget.liveSignals.loading", "Loading live signals"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.liveSignals.error", "Couldn't load live signals"),
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
        IconGlyph = LiveSignalsProjection.WifiGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── 2×2 section grid (web `grid grid-cols-2 gap-4`) ──
    private static Grid BuildGrid(LiveSignalsDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // Web order: Drivetrain (Motor), Climate, Tires, Security.
        AddCell(grid, 0, 0, BuildSection(display.MotorLabel, LiveSignalsProjection.MotorGlyph, RowsOrSkeleton(display.MotorRows)));
        AddCell(grid, 0, 1, BuildSection(display.ClimateLabel, LiveSignalsProjection.ClimateGlyph, RowsOrSkeleton(display.ClimateRows)));
        AddCell(grid, 1, 0, BuildSection(display.TiresLabel, LiveSignalsProjection.TiresGlyph, RowsOrSkeleton(display.TireRows)));
        AddCell(grid, 1, 1, BuildSection(display.SecurityLabel, LiveSignalsProjection.SecurityGlyph, ChipsOrSkeleton(display.SecurityChips)));

        AutomationProperties.SetName(grid, display.AutomationName);
        return grid;
    }

    private static void AddCell(Grid grid, int row, int col, FrameworkElement cell)
    {
        Grid.SetRow(cell, row);
        Grid.SetColumn(cell, col);
        grid.Children.Add(cell);
    }

    // Web parity: <div className="space-y-1.5"> with an uppercase muted header (icon + label) above the content.
    private static StackPanel BuildSection(string label, string glyph, UIElement content)
    {
        var column = new StackPanel { Spacing = 6 };

        var headerRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 12,
            Foreground = AccentBrush(StatusKind.Info),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        headerRow.Children.Add(icon);

        headerRow.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 40,
            VerticalAlignment = VerticalAlignment.Center,
        });

        column.Children.Add(headerRow);
        column.Children.Add(content);
        return column;
    }

    private static UIElement RowsOrSkeleton(IReadOnlyList<LiveSignalRow>? rows)
    {
        // Web parity: {slice ? rows : <Skeleton className="h-12" />}.
        if (rows is null)
        {
            return new TsSkeleton { BlockHeight = 48 };
        }

        var stack = new StackPanel { Spacing = 6 };
        foreach (var row in rows)
        {
            stack.Children.Add(MetricRow(row.Label, row.Value));
        }

        return stack;
    }

    private static UIElement ChipsOrSkeleton(IReadOnlyList<LiveSecurityChip>? chips)
    {
        if (chips is null)
        {
            return new TsSkeleton { BlockHeight = 48 };
        }

        var stack = new StackPanel { Spacing = 6 };
        foreach (var chip in chips)
        {
            stack.Children.Add(ChipRow(chip));
        }

        return stack;
    }

    // Web parity: <div className="flex items-center justify-between"> — label left, bold value right.
    private static Grid MetricRow(string label, string value)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var labelText = new TextBlock
        {
            Text = label,
            FontSize = 10,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(labelText, 0);

        var valueText = new TextBlock
        {
            Text = value,
            FontSize = 12,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        Grid.SetColumn(valueText, 1);

        grid.Children.Add(labelText);
        grid.Children.Add(valueText);
        AutomationProperties.SetName(grid, $"{label} {value}");
        return grid;
    }

    // Web parity: <div className="flex items-center justify-between"> — label left, <Badge> right.
    private static Grid ChipRow(LiveSecurityChip chip)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelText = new TextBlock
        {
            Text = chip.Label,
            FontSize = 10,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(labelText, 0);

        var badge = new TsBadge
        {
            Status = chip.Variant,
            Content = chip.Text,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(badge, 1);

        grid.Children.Add(labelText);
        grid.Children.Add(badge);
        AutomationProperties.SetName(grid, $"{chip.Label} {chip.Text}");
        return grid;
    }

    private static Brush AccentBrush(StatusKind kind) => DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
