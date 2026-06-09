using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Watch Summary dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/WatchSummaryWidget.tsx. At one column (web <c>isCompact</c>) it renders
/// the Apple-Watch-style face: a radial state-of-charge gauge tinted by the web <c>getBatteryColor</c>
/// threshold (green&gt;50, amber&gt;20, red otherwise; muted when unknown), the FSM state pill, the converted
/// range, and a pulsing "⚡ Charging" line when the complication reports charging. At two columns it renders the
/// standard layout: a battery hero big-number with a state badge (online → success, asleep → neutral,
/// otherwise warning) over a two-up detail grid (Range, Lock with Lock/Unlock glyph + badge, Cabin temperature,
/// Last Seen). When the watch read returns no usable body the surface renders a friendly "No watch data" empty
/// state (the web <c>hasData ? content : &lt;EmptyState&gt;</c> gate); a fetch failure is surfaced through the
/// freshness "Error" chip plus the refresh button rather than replacing the body. All data flows through the
/// shared <see cref="WatchSummaryViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class WatchSummaryWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double StrokeWidth = 8;          // web RadialGauge value-arc stroke
    private const double GaugeDiameter = 80;       // web compact RadialGauge size={80}

    private readonly WatchSummaryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly WatchSummaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
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
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public WatchSummaryWidget(
        IWatchSummarySource source,
        ILocalizer localizer,
        WatchSummarySize size,
        UnitPref? units = null,
        WatchSummaryDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WatchSummaryDiagnostics();
        _viewModel = new WatchSummaryViewModel(source, localizer, size, units, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>watch-summary</c>).</summary>
    public static string RegistryId => WatchSummaryRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the summary for the new layout.</summary>
    public WatchSummarySize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the summary in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="WatchSummarySource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static WatchSummaryWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        WatchSummarySize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        WatchSummaryDiagnostics? diagnostics = null)
    {
        var source = new WatchSummarySource(vehicles, api, engine, options, vehicleId);
        return new WatchSummaryWidget(
            source, localizer, size ?? WatchSummaryRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = WatchSummaryProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.watchSummary.refresh", "Refresh watch summary"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.Padding = new Thickness(12, 0, 12, 12);
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

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
        if (_viewModel.State == WatchSummaryState.Loading)
        {
            Content = BuildLoading();
            return;
        }

        // Web parity: error has no body panel — the freshness "Error" chip + refresh are the retry affordance,
        // and the body falls back to the same "No watch data" surface as the empty state.
        UpdateHeader();
        if (_viewModel.Display is { } display)
        {
            _bodyHost.Child = BuildContent(display);
        }
        else
        {
            _bodyHost.Child = BuildEmpty();
        }

        Content = _root;
    }

    private void UpdateHeader()
    {
        // Web parity: the compact WidgetShell has no title (freshness/refresh pinned top-right); the standard
        // shell shows the "Watch Summary" title row.
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static StackPanel BuildContent(WatchSummaryDisplay display) =>
        display.IsCompact ? BuildCompact(display) : BuildStandard(display);

    // ---- Compact watch face --------------------------------------------------------

    private static StackPanel BuildCompact(WatchSummaryDisplay display)
    {
        var outer = new StackPanel
        {
            Spacing = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        outer.Children.Add(BuildGaugeRing(display));

        if (display.HasState)
        {
            outer.Children.Add(new TsStatusBadge
            {
                Status = display.State ?? string.Empty,
                AccentBrushKey = display.StateDotBrushKey,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        if (display.RangeDisplay is not null)
        {
            var range = new TextBlock
            {
                Text = $"{display.RangeValueText} {display.DistanceUnitLabel}",
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetName(range, $"{display.RangeTile.Label} {display.RangeValueText} {display.DistanceUnitLabel}");
            outer.Children.Add(range);
        }

        if (display.Charging)
        {
            outer.Children.Add(BuildChargingIndicator(display));
        }

        return outer;
    }

    private static Grid BuildGaugeRing(WatchSummaryDisplay display)
    {
        double size = GaugeDiameter;
        double radius = (size - StrokeWidth) / 2;
        var center = new PointD(size / 2, size / 2);

        var canvas = new Canvas { Width = size, Height = size };
        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        // Track (full faint ring).
        canvas.Children.Add(ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, radius, 0.9999),
            ChartBrushes.Border,
            StrokeWidth));

        // Value arc, tinted by the battery threshold (muted when the state-of-charge is unknown — web grey).
        double fraction = ChartGeometry.GaugeFraction(display.GaugeValue, WatchSummaryProjection.MaxPercent);
        if (fraction > 0)
        {
            var arcBrush = display.BatteryTint == WatchBatteryTint.Unknown
                ? ChartBrushes.Border
                : ChartBrushes.ForStatus(WatchSummaryProjection.StatusFor(display.BatteryTint));
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, fraction),
                arcBrush,
                StrokeWidth));
        }

        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = 16,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        value.Inlines.Add(new Run { Text = WatchSummaryProjection.FormatNumber(display.GaugeValue) });
        value.Inlines.Add(new Run
        {
            Text = "%",
            FontSize = 11,
            FontWeight = FontWeights.Normal,
            Foreground = DisplayTokens.TextSecondary,
        });
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var centerHost = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        centerHost.Children.Add(value);

        var ring = new Grid { Width = size, Height = size };
        ring.Children.Add(canvas);
        ring.Children.Add(centerHost);
        AutomationProperties.SetName(ring, display.GaugeAutomationName);
        return ring;
    }

    private static TextBlock BuildChargingIndicator(WatchSummaryDisplay display)
    {
        var charging = new TextBlock
        {
            Text = $"{WatchSummaryProjection.ChargingBolt} {display.ChargingText}",
            FontSize = 10,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetName(charging, display.ChargingText);

        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(charging);
        }

        return charging;
    }

    // ---- Standard battery hero + detail grid ---------------------------------------

    private static StackPanel BuildStandard(WatchSummaryDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(BuildBatteryHero(display));
        column.Children.Add(BuildDetailGrid(display));
        return column;
    }

    private static StackPanel BuildBatteryHero(WatchSummaryDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        if (display.BatteryLevel is { } level)
        {
            valueRow.Children.Add(new TsAnimatedNumber
            {
                Value = level,
                Precision = 0,
                ReduceMotion = MotionPreference.ReduceMotion,
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }
        else
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = display.BatteryValueText,
                FontSize = 30,
                FontWeight = FontWeights.Bold,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        valueRow.Children.Add(new TextBlock
        {
            Text = "%",
            FontSize = 18,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Bottom,
        });
        AutomationProperties.SetName(valueRow, display.GaugeAutomationName);

        column.Children.Add(valueRow);

        column.Children.Add(new TextBlock
        {
            Text = display.BatteryLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        if (display.ShowStateBadge)
        {
            column.Children.Add(new TsBadge
            {
                Content = display.State,
                Status = display.StateBadgeStatus,
                FontSize = 10,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        return column;
    }

    private static Grid BuildDetailGrid(WatchSummaryDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        Add(grid, 0, 0, BuildTile(display.RangeTile, BuildRangeValue(display)));
        Add(grid, 1, 0, BuildTile(display.LockTile, BuildLockValue(display)));
        Add(grid, 0, 1, BuildTile(display.CabinTile, BuildCabinValue(display)));
        Add(grid, 1, 1, BuildTile(display.LastSeenTile, BuildLastSeenValue(display)));
        return grid;
    }

    private static void Add(Grid grid, int col, int row, FrameworkElement child)
    {
        Grid.SetColumn(child, col);
        Grid.SetRow(child, row);
        grid.Children.Add(child);
    }

    private static Border BuildTile(WatchDetailTile tile, UIElement value)
    {
        var column = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = tile.Label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        column.Children.Add(label);
        column.Children.Add(value);

        var border = new Border
        {
            Child = column,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(8, 6, 8, 6),
            MinHeight = 44,
        };
        AutomationProperties.SetName(border, tile.AutomationName);
        return border;
    }

    private static UIElement BuildRangeValue(WatchSummaryDisplay display)
    {
        if (display.RangeDisplay is { } range)
        {
            return BuildAnimatedValue(range, display.DistanceUnitLabel, spaceBeforeUnit: true);
        }

        return BuildEmDash();
    }

    private static UIElement BuildCabinValue(WatchSummaryDisplay display)
    {
        if (display.TempDisplay is { } temp)
        {
            return BuildAnimatedValue(temp, display.TemperatureUnitLabel, spaceBeforeUnit: false);
        }

        return BuildEmDash();
    }

    private static StackPanel BuildAnimatedValue(double value, string unit, bool spaceBeforeUnit)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = spaceBeforeUnit ? 2 : 0,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        row.Children.Add(new TsAnimatedNumber
        {
            Value = value,
            Precision = 0,
            ReduceMotion = MotionPreference.ReduceMotion,
            VerticalAlignment = VerticalAlignment.Bottom,
        });
        row.Children.Add(new TextBlock
        {
            Text = unit,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Bottom,
        });
        return row;
    }

    private static UIElement BuildLockValue(WatchSummaryDisplay display)
    {
        if (display.IsLocked is null)
        {
            return BuildEmDash();
        }

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = display.LockGlyphIsLocked ? WatchSummaryProjection.LockGlyph : WatchSummaryProjection.UnlockGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(display.LockStatus)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        row.Children.Add(glyph);
        row.Children.Add(new TsBadge
        {
            Content = display.LockLabel,
            Status = display.LockStatus,
            FontSize = 10,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return row;
    }

    private static TsDateTime BuildLastSeenValue(WatchSummaryDisplay display) => new()
    {
        Value = display.LastUpdated,
        Variant = DateTimeVariant.Relative,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private static TextBlock BuildEmDash() => new()
    {
        Text = "\u2014",
        FontSize = 14,
        Foreground = DisplayTokens.TextMuted,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    // ---- Shared states -------------------------------------------------------------

    private TsSkeleton BuildLoading()
    {
        var skeleton = new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = double.NaN,
            Radius = 12,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new Thickness(12),
        };

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.watchSummary.loading", "Loading watch summary"));
        LiveRegion.Configure(skeleton);
        return skeleton;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = WatchSummaryProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
