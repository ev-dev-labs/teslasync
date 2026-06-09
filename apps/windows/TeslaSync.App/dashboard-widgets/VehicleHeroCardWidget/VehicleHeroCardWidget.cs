using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Vehicle Hero Card dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx. It mirrors the web <c>WidgetShell</c> (a
/// full-area skeleton while loading, a retry surface on error, otherwise an overlaid freshness chip) wrapping
/// the web Compact / Full views: at 1×1 a centred status badge + battery readout + name, and at 2×1+ a titled
/// header (vehicle name + state badge), a model/trim subtitle, a Battery / Range / Cabin (+ Outside when wide)
/// metric grid, a "⚡ Charging" banner when charging, and an Outside/Ideal context row when tall. When no vehicle
/// resolves the surface renders a friendly "No vehicle data" empty state (the web
/// <c>{vehicle ? … : &lt;EmptyState&gt;}</c> gate); a resolved vehicle with no live state still renders the card
/// with em-dash metrics. All data flows through the shared <see cref="VehicleHeroCardViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator
/// name.
/// </summary>
public sealed partial class VehicleHeroCardWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";       // Segoe Fluent — Refresh
    private const string BatteryGlyph = "\uE83F";       // Segoe Fluent — Battery (web Battery)
    private const string GaugeGlyph = "\uE9D9";         // Segoe Fluent — Speedometer (web Gauge)
    private const string ThermometerGlyph = "\uE9CA";   // Segoe Fluent — Temperature (web Thermometer)
    private const string ZapGlyph = "\uE945";           // Segoe Fluent — LightningBolt (web ⚡)

    private readonly VehicleHeroCardViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleHeroCardDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _bodyHost = new();
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
    /// <param name="source">The cache-then-network hero source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public VehicleHeroCardWidget(
        IVehicleHeroCardSource source,
        ILocalizer localizer,
        VehicleHeroCardSize size,
        UnitPref? units = null,
        VehicleHeroCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleHeroCardDiagnostics();
        _viewModel = new VehicleHeroCardViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>vehicle-hero-card</c>).</summary>
    public static string RegistryId => VehicleHeroCardRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the card for the new layout.</summary>
    public VehicleHeroCardSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the range / temperatures in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VehicleHeroCardSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static VehicleHeroCardWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        VehicleHeroCardSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        VehicleHeroCardDiagnostics? diagnostics = null)
    {
        var source = new VehicleHeroCardSource(vehicles, api, engine, options, vehicleId);
        return new VehicleHeroCardWidget(source, localizer, size ?? VehicleHeroCardRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.vehicleHeroCard.refresh", "Refresh vehicle"));
        _refresh.Click += OnRefreshClick;

        _overlay.Children.Add(_freshness);
        _overlay.Children.Add(_refresh);

        _bodyHost.Padding = new Thickness(14, 12, 14, 12);
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

        // Single-cell grid: the body fills and the freshness chip floats over the top-right corner (web parity:
        // the WidgetShell renders freshness in the header for titled sizes and as an overlay when compact).
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
            case VehicleHeroCardState.Loading:
                Content = BuildLoading();
                break;

            case VehicleHeroCardState.Error:
                Content = BuildError();
                break;

            case VehicleHeroCardState.Empty:
                UpdateOverlay();
                _bodyHost.Child = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateOverlay();
                _bodyHost.Child = _viewModel.Display is { } display ? BuildCard(display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateOverlay()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

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

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.vehicleHeroCard.loading", "Loading vehicle"));
        LiveRegion.Configure(skeleton);
        LiveRegion.Announce(skeleton);
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.vehicleHeroCard.error", "Couldn't load vehicle"),
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
        IconGlyph = VehicleHeroCardProjection.CarGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private FrameworkElement BuildCard(VehicleHeroCardDisplay display) =>
        display.IsCompact ? BuildCompact(display) : (FrameworkElement)BuildTitledFull(display);

    // ── Compact: 1×1 (web CompactView) ──
    private static TsFadeIn BuildCompact(VehicleHeroCardDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(StatusBadge(display));

        if (display.HasBattery)
        {
            var number = new TsAnimatedNumber
            {
                Value = display.BatteryValue,
                Precision = 0,
                Suffix = "%",
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            column.Children.Add(number);
        }
        else
        {
            column.Children.Add(new TextBlock
            {
                Text = VehicleHeroCardProjection.Dash,
                FontSize = 20,
                FontWeight = FontWeights.Bold,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        column.Children.Add(new TextBlock
        {
            Text = display.Name,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var fade = WrapFade(column);
        fade.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(fade, display.CompactAutomationName);
        return fade;
    }

    // ── Titled Full: 2×1+ (web WidgetShell title + FullView) ──
    private Grid BuildTitledFull(VehicleHeroCardDisplay display)
    {
        var grid = new Grid { VerticalAlignment = VerticalAlignment.Stretch };
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var header = BuildTitleHeader();
        Grid.SetRow(header, 0);
        grid.Children.Add(header);

        var body = WrapFade(BuildFull(display));
        body.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetRow(body, 1);
        grid.Children.Add(body);

        return grid;
    }

    private StackPanel BuildTitleHeader()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 4),
        };

        var icon = new FontIcon
        {
            Glyph = VehicleHeroCardProjection.CarGlyph,
            FontSize = 13,
            Foreground = Accent(StatusKind.Info),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);

        var title = new TextBlock
        {
            Text = _viewModel.Title.ToUpperInvariant(),
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 60,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(title);
        return row;
    }

    private static StackPanel BuildFull(VehicleHeroCardDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Header: name (truncating) + status badge.
        var headerRow = new Grid { ColumnSpacing = 8 };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = display.Name,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);
        headerRow.Children.Add(name);

        var badge = StatusBadge(display);
        badge.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(badge, 1);
        headerRow.Children.Add(badge);
        column.Children.Add(headerRow);

        // Subtitle: model + trim (collapsed when both are absent).
        if (!string.IsNullOrWhiteSpace(display.Subtitle))
        {
            column.Children.Add(new TextBlock
            {
                Text = display.Subtitle,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
        }

        column.Children.Add(BuildMetricsGrid(display));

        if (display.IsCharging)
        {
            column.Children.Add(BuildChargingBanner(display));
        }

        if (display.IsTall && !display.IsWide)
        {
            column.Children.Add(BuildTallRow(display));
        }

        AutomationProperties.SetName(column, display.FullAutomationName);
        return column;
    }

    private static Grid BuildMetricsGrid(VehicleHeroCardDisplay display)
    {
        int columns = display.IsWide ? 4 : 3;
        var grid = new Grid { ColumnSpacing = 8 };
        for (int i = 0; i < columns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var cells = new List<FrameworkElement>
        {
            MetricCell(BatteryGlyph, DisplayTokens.TextMuted, display.BatteryLabel, display.BatteryText, DisplayTokens.Brush(display.BatteryAccentKey)),
            MetricCell(GaugeGlyph, Accent(StatusKind.Info), display.RangeLabel, display.RangeText, DisplayTokens.TextPrimary),
            MetricCell(ThermometerGlyph, Accent(StatusKind.Warning), display.CabinLabel, display.CabinText, DisplayTokens.TextPrimary),
        };

        if (display.IsWide)
        {
            cells.Add(MetricCell(ThermometerGlyph, Accent(StatusKind.Info), display.OutsideLabel, display.OutsideText, DisplayTokens.TextPrimary));
        }

        for (int i = 0; i < cells.Count; i++)
        {
            Grid.SetColumn(cells[i], i);
            grid.Children.Add(cells[i]);
        }

        return grid;
    }

    private static Border BuildChargingBanner(VehicleHeroCardDisplay display)
    {
        var success = Accent(StatusKind.Success);
        Color color = success is SolidColorBrush scb ? scb.Color : Microsoft.UI.Colors.LimeGreen;

        var content = new Grid { VerticalAlignment = VerticalAlignment.Center };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var bolt = new FontIcon
        {
            Glyph = ZapGlyph,
            FontSize = 12,
            Foreground = success,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(bolt, AccessibilityView.Raw);
        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(bolt);
        }

        left.Children.Add(bolt);
        left.Children.Add(new TextBlock
        {
            Text = display.ChargingText,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = success,
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(left, 0);
        content.Children.Add(left);

        if (display.ChargerText is { } chargerText)
        {
            var power = new TextBlock
            {
                Text = chargerText,
                FontSize = 12,
                Foreground = success,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(power, 1);
            content.Children.Add(power);
        }

        var banner = new Border
        {
            Background = new SolidColorBrush(color) { Opacity = 0.10 },
            BorderBrush = new SolidColorBrush(color) { Opacity = 0.22 },
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(8, 6, 8, 6),
            Child = content,
        };
        AutomationProperties.SetName(banner, display.ChargerText is { } t ? $"{display.ChargingText} {t}" : display.ChargingText);
        return banner;
    }

    private static Border BuildTallRow(VehicleHeroCardDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var outside = MetricCell(ThermometerGlyph, Accent(StatusKind.Info), display.OutsideLabel, display.OutsideText, DisplayTokens.TextPrimary);
        Grid.SetColumn(outside, 0);
        grid.Children.Add(outside);

        var ideal = MetricCell(GaugeGlyph, Accent(StatusKind.Info), display.IdealLabel, display.IdealText, DisplayTokens.TextPrimary);
        Grid.SetColumn(ideal, 1);
        grid.Children.Add(ideal);

        return new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(0, 6, 0, 0),
            Child = grid,
        };
    }

    private static StackPanel MetricCell(string glyph, Brush iconBrush, string label, string value, Brush valueBrush)
    {
        var cell = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 12,
            Foreground = iconBrush,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        cell.Children.Add(icon);

        var stack = new StackPanel();
        stack.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        stack.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = valueBrush,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        cell.Children.Add(stack);

        AutomationProperties.SetName(cell, $"{label} {value}");
        return cell;
    }

    private static TsStatusBadge StatusBadge(VehicleHeroCardDisplay display) => new()
    {
        Status = display.Status,
        AccentBrushKey = display.StatusAccentKey,
    };

    private static TsFadeIn WrapFade(UIElement content) => new()
    {
        Content = content,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private static Brush Accent(StatusKind kind) => DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
