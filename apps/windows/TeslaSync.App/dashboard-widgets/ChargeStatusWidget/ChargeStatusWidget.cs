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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Charge Status dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargeStatusWidget.tsx. It mirrors the web <c>WidgetShell</c> used
/// title-less (a skeleton while loading, a retry surface on error, otherwise the vertically-centred charge body
/// with a floating freshness chip in the top-right corner). When charging, it renders the "⚡ Charging" badge
/// and a Power / Rate / Battery / Time-to-Full metric grid; when idle, the "Not Charging" headline plus the
/// "{battery}% · {range}" summary line; and when the response carries no state, a friendly "No charge data"
/// empty state (the web <c>{state ? … : &lt;EmptyState&gt;}</c> gate). All data flows through the shared
/// <see cref="ChargeStatusViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ChargeStatusWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ChargeStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargeStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly StackPanel _overlay = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, 6, 6, 0),
    };

    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network charge source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ChargeStatusWidget(
        IChargeStatusSource source,
        ILocalizer localizer,
        ChargeStatusSize size,
        UnitPref? units = null,
        ChargeStatusDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargeStatusDiagnostics();
        _viewModel = new ChargeStatusViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>charge-status</c>).</summary>
    public static string RegistryId => ChargeStatusRegistration.Id;

    /// <summary>The widget footprint (registry metadata; the surface renders identically at every size).</summary>
    public ChargeStatusSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the rate / range / power in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargeStatusSource"/> from the shared data
    /// layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargeStatusWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargeStatusSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        ChargeStatusDiagnostics? diagnostics = null)
    {
        var source = new ChargeStatusSource(vehicles, api, engine, options, vehicleId);
        return new ChargeStatusWidget(source, localizer, size ?? ChargeStatusRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargeStatus.refresh", "Refresh charging status"));
        _refresh.Click += OnRefreshClick;

        _overlay.Children.Add(_freshness);
        _overlay.Children.Add(_refresh);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(16, 12, 16, 12);
        _bodyHost.VerticalContentAlignment = VerticalAlignment.Center;

        // Single-cell grid: the body fills and centres; the freshness chip floats over the top-right corner
        // (web parity: the title-less WidgetShell renders freshness as an absolute overlay).
        _root.Children.Add(_bodyHost);
        _root.Children.Add(_overlay);
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
            case ChargeStatusState.Loading:
                Content = BuildLoading();
                break;

            case ChargeStatusState.Error:
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
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.Display is not { } display)
        {
            return BuildEmpty();
        }

        return display.IsCharging ? BuildCharging(display) : BuildIdle(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 28 });
        column.Children.Add(new TsSkeleton { BlockHeight = 28 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargeStatus.loading", "Loading charging status"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargeStatus.error", "Couldn't load charging status"),
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
        IconGlyph = ChargeStatusProjection.ZapGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Charging surface (web state.is_charging branch) ──
    private static StackPanel BuildCharging(ChargeStatusDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Status row: pulsing charging glyph + the localized "Charging" label, both in the success accent.
        var statusRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        statusRow.Children.Add(ChargingGlyph(16));
        statusRow.Children.Add(new TextBlock
        {
            Text = display.ChargingLabel,
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = SuccessBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(statusRow);

        // 2×2 metric grid: Power / Rate on top, Battery / Time to Full below (web grid-cols-2).
        column.Children.Add(CellRow(
            MetricCell(display.PowerLabel, display.PowerText, SuccessBrush()),
            MetricCell(display.RateLabel, display.RateText, DisplayTokens.TextPrimary)));
        column.Children.Add(CellRow(
            MetricCell(display.BatteryLabel, display.BatteryText, DisplayTokens.TextPrimary),
            MetricCell(display.TimeToFullLabel, display.TimeToFullText, DisplayTokens.TextPrimary)));

        AutomationProperties.SetName(column, display.ChargingAutomationName);
        return column;
    }

    // ── Idle surface (web else-if state branch: Not Charging) ──
    private static StackPanel BuildIdle(ChargeStatusDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = ChargeStatusProjection.ZapGlyph,
            FontSize = 24,
            Foreground = DisplayTokens.TextMuted,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        column.Children.Add(glyph);

        column.Children.Add(new TextBlock
        {
            Text = display.NotChargingText,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });
        column.Children.Add(new TextBlock
        {
            Text = display.IdleSummaryText,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });

        AutomationProperties.SetName(column, display.IdleAutomationName);
        return column;
    }

    private static Grid CellRow(FrameworkElement left, FrameworkElement right)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    private static StackPanel MetricCell(string label, string value, Brush valueBrush)
    {
        var cell = new StackPanel { Spacing = 2 };
        cell.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        cell.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = valueBrush,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        AutomationProperties.SetName(cell, $"{label} {value}");
        return cell;
    }

    private static FontIcon ChargingGlyph(double size)
    {
        var glyph = new FontIcon
        {
            Glyph = ChargeStatusProjection.BatteryChargingGlyph,
            FontSize = size,
            Foreground = SuccessBrush(),
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(glyph);
        }

        return glyph;
    }

    private static Brush SuccessBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}

