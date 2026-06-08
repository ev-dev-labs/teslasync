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
/// The native WinUI 3 Charge Status Live dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// skeleton while loading, a retry surface on error, otherwise a "⚡ Charge Status" freshness header — title-less
/// when compact) wrapping the live charge body: when charging, either the compact big-number power readout
/// (1×1) or the standard view (a "Charging" badge, the hero kW power, a Voltage / Current / Time Left / Added
/// metric grid, and — when tall — a Rate / Battery row); when idle, either the compact battery percent (1×1) or
/// the standard "Not Charging" view with the last-session energy line. When the response carries no state the
/// surface renders a friendly "No charge data" empty state (the web <c>{state ? … : &lt;EmptyState&gt;}</c>
/// gate). All data flows through the shared <see cref="ChargeStatusLiveViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ChargeStatusLiveWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ChargeStatusLiveViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargeStatusLiveDiagnostics _diagnostics;
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
    public ChargeStatusLiveWidget(
        IChargeStatusLiveSource source,
        ILocalizer localizer,
        ChargeStatusLiveSize size,
        UnitPref? units = null,
        ChargeStatusLiveDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargeStatusLiveDiagnostics();
        _viewModel = new ChargeStatusLiveViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>charge-status-live</c>).</summary>
    public static string RegistryId => ChargeStatusLiveRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the live view for the new layout.</summary>
    public ChargeStatusLiveSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the charge rate in the new distance unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargeStatusLiveSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargeStatusLiveWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargeStatusLiveSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        ChargeStatusLiveDiagnostics? diagnostics = null)
    {
        var source = new ChargeStatusLiveSource(vehicles, api, engine, options, vehicleId);
        return new ChargeStatusLiveWidget(source, localizer, size ?? ChargeStatusLiveRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = ChargeStatusLiveProjection.ZapGlyph,
            FontSize = 14,
            Foreground = SuccessBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargeStatusLive.refresh", "Refresh charging status"));
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
        _bodyHost.Padding = new Thickness(12, 4, 12, 12);

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
            case ChargeStatusLiveState.Loading:
                Content = BuildLoading();
                break;

            case ChargeStatusLiveState.Error:
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
        bool compact = _viewModel.Display?.IsCompact ?? false;
        _titleRow.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
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
            return BuildEmpty();
        }

        if (display.IsCharging)
        {
            return display.IsCompact ? BuildCompactCharging(display) : BuildFullCharging(display);
        }

        return display.IsCompact ? BuildCompactIdle(display) : BuildIdle(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 120 });
        column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        column.Children.Add(new TsSkeleton { BlockHeight = 18 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargeStatusLive.loading", "Loading charging status"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargeStatusLive.error", "Couldn't load charging status"),
            ActionText = _localizer.GetString("widget.chargeStatusLive.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ChargeStatusLiveProjection.ZapGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact: charging (web CompactChargingView) ──
    private static StackPanel BuildCompactCharging(ChargeStatusLiveDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(ChargingGlyph(20));
        column.Children.Add(PowerReadout(display));
        column.Children.Add(new TextBlock
        {
            Text = display.BatteryPercentText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, display.ChargingAutomationName);
        return column;
    }

    // ── Compact: idle (web CompactIdleView) ──
    private static StackPanel BuildCompactIdle(ChargeStatusLiveDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new FontIcon
        {
            Glyph = ChargeStatusLiveProjection.PlugGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.TextMuted,
        });
        column.Children.Add(new TextBlock
        {
            Text = display.BatteryPercentText,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TextBlock
        {
            Text = display.NotChargingText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, display.IdleAutomationName);
        return column;
    }

    // ── Full: actively charging (web FullChargingView) ──
    private static StackPanel BuildFullCharging(ChargeStatusLiveDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Status header: charging glyph + badge on the left, battery percent on the right.
        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var statusRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        statusRow.Children.Add(ChargingGlyph(16));
        statusRow.Children.Add(new TsBadge
        {
            Status = StatusKind.Success,
            Content = new TextBlock { Text = display.ChargingBadgeLabel, FontSize = 12 },
        });
        Grid.SetColumn(statusRow, 0);

        var batteryHeader = new TextBlock
        {
            Text = display.BatteryPercentText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(batteryHeader, 1);

        headerGrid.Children.Add(statusRow);
        headerGrid.Children.Add(batteryHeader);
        column.Children.Add(headerGrid);

        // Primary metric: power.
        var powerHost = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
        powerHost.Children.Add(PowerReadout(display));
        column.Children.Add(powerHost);

        // Secondary metrics grid: Voltage / Current / Time Left / Added.
        column.Children.Add(CellRow(display.Voltage, display.Current));
        column.Children.Add(CellRow(display.TimeLeft, display.Added));

        // Extra row when tall: Rate / Battery.
        if (display.IsTall)
        {
            var divider = new Border
            {
                Height = 1,
                Background = DisplayTokens.Border,
                Margin = new Thickness(0, 2, 0, 2),
            };
            AutomationProperties.SetAccessibilityView(divider, AccessibilityView.Raw);
            column.Children.Add(divider);
            column.Children.Add(CellRow(display.Rate, display.Battery));
        }

        AutomationProperties.SetName(column, display.ChargingAutomationName);
        return column;
    }

    // ── Full: not charging (web IdleView) ──
    private static StackPanel BuildIdle(ChargeStatusLiveDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new FontIcon
        {
            Glyph = ChargeStatusLiveProjection.PlugGlyph,
            FontSize = 24,
            Foreground = DisplayTokens.TextMuted,
        });

        var labels = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        labels.Children.Add(new TextBlock
        {
            Text = display.NotChargingText,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        labels.Children.Add(new TextBlock
        {
            Text = display.BatteryPercentText,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(labels);

        // Web parity: the last-session block only renders when a session exists.
        if (display.HasSession)
        {
            column.Children.Add(BuildLastSession(display));
        }

        AutomationProperties.SetName(column, display.IdleAutomationName);
        return column;
    }

    private static Border BuildLastSession(ChargeStatusLiveDisplay display)
    {
        var inner = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        inner.Children.Add(new TextBlock
        {
            Text = display.LastSessionLabel,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        inner.Children.Add(new TextBlock
        {
            Text = display.LastSessionValue,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var border = new Border
        {
            Child = inner,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(8),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(border, $"{display.LastSessionLabel} {display.LastSessionValue}");
        return border;
    }

    private static Grid CellRow(ChargeStatusLiveCell left, ChargeStatusLiveCell right)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var leftCell = BuildCell(left);
        var rightCell = BuildCell(right);
        Grid.SetColumn(leftCell, 0);
        Grid.SetColumn(rightCell, 1);
        grid.Children.Add(leftCell);
        grid.Children.Add(rightCell);
        return grid;
    }

    private static StackPanel BuildCell(ChargeStatusLiveCell cell)
    {
        var glyph = new FontIcon
        {
            Glyph = cell.Glyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var labels = new StackPanel { Spacing = 0 };
        labels.Children.Add(new TextBlock
        {
            Text = cell.Label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        labels.Children.Add(new TextBlock
        {
            Text = cell.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        row.Children.Add(glyph);
        row.Children.Add(labels);
        AutomationProperties.SetName(row, cell.AutomationName);
        return row;
    }

    private static TsAnimatedNumber PowerReadout(ChargeStatusLiveDisplay display) => new()
    {
        Value = display.PowerValue,
        Precision = display.PowerPrecision,
        Suffix = display.PowerSuffix,
        ReduceMotion = MotionPreference.ReduceMotion,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private static FontIcon ChargingGlyph(double size)
    {
        var glyph = new FontIcon
        {
            Glyph = ChargeStatusLiveProjection.ZapGlyph,
            FontSize = size,
            Foreground = SuccessBrush(),
        };

        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(glyph);
        }

        return glyph;
    }

    private static Brush SuccessBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
