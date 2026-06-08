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
using Windows.Foundation;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Climate Control Panel dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ClimateControlPanelWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise the "🌡 Climate Control" freshness header
/// above the body) and the component's compact/full branch: when the footprint collapses to
/// <c>cols ≤ 1 &amp;&amp; rows ≤ 1</c> the body is a single centred cabin temperature; otherwise it is the full
/// panel — an HVAC on/off badge with optional power, a Cabin / Outside temperature pair, a Fan Speed / Wheel
/// Heat pair, and a wrapped chip row of the active seat heaters (or "No seat heaters active") plus the
/// conditional Defrost and Bat Heater chips. When the response carries no climate object a friendly
/// "No climate data" empty state is shown (the web <c>{climateData ? … : &lt;EmptyState&gt;}</c> gate). All data
/// flows through the shared <see cref="ClimateControlPanelViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and the surface carries Narrator names.
/// </summary>
public sealed partial class ClimateControlPanelWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ClimateControlPanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ClimateControlPanelDiagnostics _diagnostics;
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
        Glyph = ClimateControlPanelProjection.ThermometerGlyph,
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
    /// <param name="source">The cache-then-network climate source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / full branch).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ClimateControlPanelWidget(
        IClimateControlPanelSource source,
        ILocalizer localizer,
        ClimateControlPanelSize size,
        UnitPref? units = null,
        ClimateControlPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ClimateControlPanelDiagnostics();
        _viewModel = new ClimateControlPanelViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>climate-control-panel</c>).</summary>
    public static string RegistryId => ClimateControlPanelRegistration.Id;

    /// <summary>The widget footprint; reassigning re-renders the compact ⇄ full body.</summary>
    public ClimateControlPanelSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the cabin / outside temperatures.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ClimateControlPanelSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle
    /// unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ClimateControlPanelWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ClimateControlPanelSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        ClimateControlPanelDiagnostics? diagnostics = null)
    {
        var source = new ClimateControlPanelSource(vehicles, api, engine, options, vehicleId);
        return new ClimateControlPanelWidget(source, localizer, size ?? ClimateControlPanelRegistration.DefaultSize, units, diagnostics);
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.climatePanel.refresh", "Refresh climate"));
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
            case ClimateControlPanelState.Loading:
                Content = BuildLoading();
                break;

            case ClimateControlPanelState.Error:
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
        // Web parity: the compact branch passes title=undefined / icon=undefined to WidgetShell.
        var showTitle = !_viewModel.Size.IsCompact;
        _titleIcon.Visibility = showTitle ? Visibility.Visible : Visibility.Collapsed;
        _titleText.Visibility = showTitle ? Visibility.Visible : Visibility.Collapsed;
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
            // Web parity: no climate object (climateData == null) renders the "No climate data" surface.
            return BuildEmpty();
        }

        return _viewModel.Size.IsCompact ? BuildCompact(display) : BuildFull(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(16, 16, 16, 16) };
        column.Children.Add(new TsSkeleton { BlockHeight = 18, BlockWidth = 140 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        column.Children.Add(new TsSkeleton { BlockHeight = 16 });

        AutomationProperties.SetName(column, _localizer.GetString("widget.climatePanel.loading", "Loading climate"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.climatePanel.error", "Couldn't load climate"),
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
        IconGlyph = ClimateControlPanelProjection.ThermometerGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Compact body (web isCompact branch): a single centred cabin temperature ──
    private static StackPanel BuildCompact(ClimateControlPanelDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = ClimateControlPanelProjection.ThermometerGlyph,
            FontSize = 20,
            Foreground = InfoBrush(),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        column.Children.Add(icon);

        column.Children.Add(new TextBlock
        {
            Text = display.CabinText,
            FontSize = 18,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    // ── Full panel (web FullView): HVAC badge, temperature pair, fan pair, chip row ──
    private static StackPanel BuildFull(ClimateControlPanelDisplay display)
    {
        var column = new StackPanel { Spacing = 10 };

        column.Children.Add(BuildHvacRow(display));
        column.Children.Add(BuildCellPair(
            MetricCell(ClimateControlPanelProjection.ThermometerGlyph, InfoBrush(), display.CabinLabel, display.CabinText),
            MetricCell(ClimateControlPanelProjection.ThermometerGlyph, InfoBrush(), display.OutsideLabel, display.OutsideText)));
        column.Children.Add(BuildCellPair(
            MetricCell(ClimateControlPanelProjection.FanGlyph, DisplayTokens.TextMuted, display.FanLabel, display.FanText),
            MetricCell(ClimateControlPanelProjection.SteeringGlyph, DisplayTokens.TextMuted, display.SteeringLabel, display.SteeringText)));
        column.Children.Add(BuildChipRow(display));

        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // Web parity: <div className="flex items-center justify-between"> — Power icon + HVAC badge, power on the right.
    private static Grid BuildHvacRow(ClimateControlPanelDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var power = new FontIcon
        {
            Glyph = ClimateControlPanelProjection.PowerGlyph,
            FontSize = 13,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(power, AccessibilityView.Raw);
        left.Children.Add(power);

        var badge = new TsBadge
        {
            Status = display.HvacOn ? StatusKind.Success : StatusKind.Neutral,
            Content = display.HvacBadgeText,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.HvacBadgeText);
        left.Children.Add(badge);

        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        if (display.HvacPowerText is { } powerText)
        {
            var powerLabel = new TextBlock
            {
                Text = powerText,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            Grid.SetColumn(powerLabel, 1);
            grid.Children.Add(powerLabel);
        }

        AutomationProperties.SetName(grid, display.HvacPowerText is { } pt ? $"{display.HvacBadgeText} {pt}" : display.HvacBadgeText);
        return grid;
    }

    // Web parity: <div className="grid grid-cols-2 gap-2"> of two metric cells.
    private static Grid BuildCellPair(FrameworkElement left, FrameworkElement right)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    // Web parity: the MetricCell — leading icon, a muted label above a bold value.
    private static Grid MetricCell(string glyph, Brush iconBrush, string label, string value)
    {
        var cell = new Grid { ColumnSpacing = 6 };
        cell.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        cell.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 12,
            Foreground = iconBrush,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);

        var stack = new StackPanel { Spacing = 0 };
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
            FontSize = 13,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        Grid.SetColumn(stack, 1);

        cell.Children.Add(icon);
        cell.Children.Add(stack);
        AutomationProperties.SetName(cell, $"{label} {value}");
        return cell;
    }

    // Web parity: <div className="flex items-center gap-1.5 flex-wrap"> of the seat / status chips.
    private static ChipWrapPanel BuildChipRow(ClimateControlPanelDisplay display)
    {
        var wrap = new ChipWrapPanel { HorizontalSpacing = 6, VerticalSpacing = 6 };

        if (display.Seats.Count > 0)
        {
            foreach (var seat in display.Seats)
            {
                // Web: orange seat chip (bg-orange-500/10 text-orange-400) with the Armchair icon.
                wrap.Children.Add(BuildChip(ClimateControlPanelProjection.ThermometerGlyph, $"{seat.Label} {seat.LevelText}", StatusKind.Warning));
            }
        }
        else
        {
            wrap.Children.Add(new TextBlock
            {
                Text = display.NoSeatText,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        if (display.ShowDefrostChip)
        {
            // Web: blue defrost chip (bg-blue-500/10 text-blue-400) with the Snowflake icon.
            wrap.Children.Add(BuildChip(ClimateControlPanelProjection.SnowflakeGlyph, display.DefrostChipText, StatusKind.Info));
        }

        if (display.ShowBatteryHeaterChip)
        {
            // Web: orange battery-heater chip (bg-orange-500/10 text-orange-400) with the Zap icon.
            wrap.Children.Add(BuildChip(ClimateControlPanelProjection.ZapGlyph, display.BatteryHeaterChipText, StatusKind.Warning));
        }

        return wrap;
    }

    private static Border BuildChip(string glyph, string text, StatusKind kind)
    {
        Brush accent = DisplayTokens.Brush(StatusResources.AccentBrushKey(kind));
        Brush background = accent is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : Transparent();

        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 10,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        content.Children.Add(icon);

        content.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = 10,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var chip = new Border
        {
            Child = content,
            Background = background,
            CornerRadius = new CornerRadius(999),
            Padding = new Thickness(6, 2, 6, 2),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(chip, text);
        return chip;
    }

    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);

    /// <summary>
    /// A minimal flow panel that lays its children out left-to-right and wraps to the next line when the
    /// remaining width runs out — the native analogue of the web chip row's <c>flex-wrap</c>. Variable-width
    /// children (the seat chips, the "No seat heaters active" label, the Defrost / Bat Heater chips) are
    /// measured at their natural size so every chip stays visible rather than clipping (no hidden surface).
    /// </summary>
    private sealed partial class ChipWrapPanel : Panel
    {
        /// <summary>Horizontal gap between chips on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
