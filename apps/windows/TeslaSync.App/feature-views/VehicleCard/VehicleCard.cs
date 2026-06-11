using Microsoft.UI;
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
using Windows.UI;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Carries the in-app route a <see cref="VehicleCard"/> action requests navigation to, so the host can route
/// it (the native analogue of the web card's <c>&lt;Link to=…&gt;</c>).
/// </summary>
/// <param name="route">The in-app route to navigate to (e.g. <c>/vehicles/7</c>).</param>
public sealed class VehicleCardNavigationEventArgs(string route) : EventArgs
{
    /// <summary>The in-app route the host should navigate to.</summary>
    public string Route { get; } = route;
}

/// <summary>
/// Carries the vehicle a <see cref="VehicleCard"/> delete action targets, so the host can confirm and perform
/// the removal (the native analogue of the web card's <c>onDelete(vehicle)</c> callback).
/// </summary>
/// <param name="vehicleId">The id of the vehicle to remove.</param>
/// <param name="vehicleName">The display name of the vehicle (for the confirmation prompt).</param>
public sealed class VehicleCardDeleteEventArgs(long vehicleId, string vehicleName) : EventArgs
{
    /// <summary>The id of the vehicle the host should remove.</summary>
    public long VehicleId { get; } = vehicleId;

    /// <summary>The display name of the vehicle the host should remove.</summary>
    public string VehicleName { get; } = vehicleName;
}

/// <summary>
/// The native WinUI 3 Vehicle Card surface — a parity port of
/// web/src/features/vehicles/components/VehicleCard.tsx. It renders the web's always-visible glass card (a
/// gradient accent strip, the car visualization, the vehicle name + state badge + model/trim/VIN subtitle and
/// the View-details / Remove actions) and, when live state is present, the stats row (the battery group, the
/// interior / odometer / charge-power columns and the lock / Sentry flags). Every state renders — the loading
/// skeleton, the retry surface on hard failure, the friendly empty surface when no vehicle resolves, and the
/// stale / offline freshness chips over the content. All data flows through the shared
/// <see cref="VehicleCardViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class VehicleCard : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";       // Segoe Fluent — Refresh
    private const string CarGlyph = "\uE804";           // Segoe Fluent — Car
    private const string ViewDetailsGlyph = "\uE8A7";   // Segoe Fluent — OpenInNewWindow (web ExternalLink)
    private const string DeleteGlyph = "\uE74D";        // Segoe Fluent — Delete (web Trash2)
    private const double SectionSpacing = 16;
    private const double CarGlyphSize = 44;

    private readonly VehicleCardViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleCardDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _bodyHost = new()
    {
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalContentAlignment = VerticalAlignment.Stretch,
    };

    private VehicleCardActions _actions = new(0, string.Empty, "/vehicles/0", string.Empty, string.Empty);
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, unit preference and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network card source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehicleCard(
        IVehicleCardSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        VehicleCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleCardDiagnostics();
        _viewModel = new VehicleCardViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the View-details action (or the name link) is invoked; the host navigates to the route.</summary>
    public event EventHandler<VehicleCardNavigationEventArgs>? NavigationRequested;

    /// <summary>Raised when the Remove action is invoked; the host confirms and removes the vehicle.</summary>
    public event EventHandler<VehicleCardDeleteEventArgs>? DeleteRequested;

    /// <summary>The canonical surface id (<c>vehicle-card</c>).</summary>
    public static string SurfaceId => VehicleCardRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public VehicleCardViewModel ViewModel => _viewModel;

    /// <summary>The display-unit preference; reassigning re-projects the current snapshot at the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VehicleCardSource"/> from the shared
    /// data layer, resolving the primary cached vehicle unless an explicit <paramref name="vehicleId"/> is
    /// supplied.
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference; null = metric.</param>
    /// <param name="vehicleId">An explicit vehicle id, or null for the primary roster vehicle.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static VehicleCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        VehicleCardDiagnostics? diagnostics = null)
    {
        var source = new VehicleCardSource(api, engine, options, vehicleId);
        return new VehicleCard(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
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
    }

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
        var display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AutomationName);

        switch (_viewModel.State)
        {
            case VehicleCardState.Loading:
                Content = BuildLoading();
                break;

            case VehicleCardState.Error:
                Content = BuildError();
                break;

            case VehicleCardState.Empty:
                Content = BuildEmpty();
                break;

            default:
                _actions = display.Actions;
                UpdateHeader();
                _bodyHost.Content = BuildCard(display);
                Content = _root;
                break;
        }
    }

    // ── Header (stale/offline chip + freshness + refresh) ────────────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is VehicleCardState.Stale or VehicleCardState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == VehicleCardState.Offline;
        _header.Children.Add(_freshness);
        _header.Children.Add(BuildRefreshButton());
    }

    private TsBadge BuildFreshnessChip(VehicleCardState state)
    {
        bool offline = state == VehicleCardState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Card body ────────────────────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildCard(VehicleCardDisplay display)
    {
        var column = new StackPanel { Spacing = 0 };
        column.Children.Add(BuildAccentStrip());

        var row = new Grid { Padding = new Thickness(16), ColumnSpacing = 16 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var viz = BuildViz(display.Viz);
        Grid.SetColumn(viz, 0);
        row.Children.Add(viz);

        var info = BuildInfo(display);
        Grid.SetColumn(info, 1);
        row.Children.Add(info);

        var actions = BuildActions(display.Actions);
        Grid.SetColumn(actions, 2);
        row.Children.Add(actions);

        column.Children.Add(row);

        var panel = new TsGlassPanel
        {
            Glow = GlassGlow.Cyan,
            Padding = new Thickness(0),
            Content = column,
        };
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    private static Border BuildAccentStrip()
    {
        var gradient = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 0),
        };
        gradient.GradientStops.Add(new GradientStop { Color = ColorFromKey("TsChartSpeedBrush", Colors.Cyan), Offset = 0 });
        gradient.GradientStops.Add(new GradientStop { Color = ColorFromKey("TsChartPowerBrush", Colors.MediumPurple), Offset = 0.5 });
        gradient.GradientStops.Add(new GradientStop { Color = ColorFromKey("TsChartBatteryBrush", Colors.LimeGreen), Offset = 1 });

        var strip = new Border { Height = 4, Background = gradient, Opacity = 0.55 };
        AutomationProperties.SetAccessibilityView(strip, AccessibilityView.Raw);
        return strip;
    }

    // ── Car visualization ────────────────────────────────────────────────────────────────────────────

    private Border BuildViz(VehicleCardViz viz)
    {
        var column = new StackPanel
        {
            Spacing = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var car = new FontIcon
        {
            Glyph = CarGlyph,
            FontSize = CarGlyphSize,
            Foreground = AccentBrush(viz.BatteryAccent),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(car, AccessibilityView.Raw);
        column.Children.Add(car);

        column.Children.Add(new Caption
        {
            Value = viz.ModelLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        });

        var glyphs = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        if (viz.IsCharging)
        {
            glyphs.Children.Add(StateGlyph(VehicleCardProjection.ChargingGlyph, VehicleCardAccent.Green, _localizer.GetString("card.charging", "Charging")));
        }

        if (viz.IsLocked)
        {
            glyphs.Children.Add(StateGlyph("\uE72E", VehicleCardAccent.Green, _localizer.GetString("card.locked", "Locked")));
        }

        if (viz.SentryMode)
        {
            glyphs.Children.Add(StateGlyph("\uEA18", VehicleCardAccent.Cyan, _localizer.GetString("card.sentry", "Sentry")));
        }

        if (glyphs.Children.Count > 0)
        {
            column.Children.Add(glyphs);
        }

        var tile = new Border
        {
            Child = column,
            Width = 96,
            Padding = new Thickness(8, 12, 8, 12),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(tile, viz.AutomationName);
        return tile;
    }

    private static FontIcon StateGlyph(string glyph, VehicleCardAccent accent, string name)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 13,
            Foreground = AccentBrush(accent),
        };
        AutomationProperties.SetName(icon, name);
        return icon;
    }

    // ── Info column (name + status, subtitle, stats row) ─────────────────────────────────────────────

    private StackPanel BuildInfo(VehicleCardDisplay display)
    {
        var column = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center };

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var nameLink = new HyperlinkButton
        {
            Padding = new Thickness(0),
            Tag = display.Actions.DetailsRoute,
            Content = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(display.Name) ? display.Vin : display.Name,
                FontSize = 16,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextPrimary,
                TextTrimming = TextTrimming.CharacterEllipsis,
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(nameLink, string.IsNullOrWhiteSpace(display.Name) ? display.Vin : display.Name);
        nameLink.Click += OnNavigateClick;
        titleRow.Children.Add(nameLink);

        titleRow.Children.Add(new TsStatusBadge
        {
            Status = display.Status,
            AccentBrushKey = display.StatusAccentKey,
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(titleRow);

        column.Children.Add(BuildSubtitle(display));

        if (display.IsAwake)
        {
            column.Children.Add(BuildStatsRow(display));
        }

        return column;
    }

    private static StackPanel BuildSubtitle(VehicleCardDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (!string.IsNullOrWhiteSpace(display.ModelTrim))
        {
            row.Children.Add(new Caption { Value = $"{display.ModelTrim} \u00B7", VerticalAlignment = VerticalAlignment.Center });
        }

        if (!string.IsNullOrWhiteSpace(display.Vin))
        {
            row.Children.Add(new Code { Value = display.Vin, VerticalAlignment = VerticalAlignment.Center });
        }

        AutomationProperties.SetName(row, display.Subtitle);
        return row;
    }

    private StackPanel BuildStatsRow(VehicleCardDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 20,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 4, 0, 0),
        };

        if (display.Battery is { } battery)
        {
            row.Children.Add(BuildBatteryGroup(battery));
        }

        foreach (var stat in display.Stats)
        {
            row.Children.Add(BuildStatColumn(stat));
        }

        if (display.Flags.Count > 0)
        {
            var flags = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            foreach (var flag in display.Flags)
            {
                flags.Children.Add(StateGlyph(flag.Glyph, flag.Accent, flag.AutomationName));
            }

            row.Children.Add(flags);
        }

        return row;
    }

    private StackPanel BuildBatteryGroup(VehicleCardBattery battery)
    {
        var column = new StackPanel { Spacing = 2, MinWidth = 132, VerticalAlignment = VerticalAlignment.Center };

        column.Children.Add(new TsMetricBar
        {
            Label = _localizer.GetString("card.battery", "Battery"),
            ValueText = battery.LevelText,
            Value = battery.Level,
            Max = 100,
            AccentBrushKey = AccentBrushKey(battery.Accent),
        });
        column.Children.Add(new Caption { Value = battery.RangeText });

        AutomationProperties.SetName(column, battery.AutomationName);
        return column;
    }

    private static StackPanel BuildStatColumn(VehicleCardStat stat)
    {
        var column = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };

        column.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = stat.Accent == VehicleCardAccent.Neutral ? DisplayTokens.TextPrimary : AccentBrush(stat.Accent),
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        column.Children.Add(new MetricLabel { Value = stat.Label });

        AutomationProperties.SetName(column, stat.AutomationName);
        return column;
    }

    // ── Actions (view details + delete) ──────────────────────────────────────────────────────────────

    private StackPanel BuildActions(VehicleCardActions actions)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        var details = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = ViewDetailsGlyph,
            Tag = actions.DetailsRoute,
        };
        AutomationProperties.SetName(details, actions.ViewDetailsLabel);
        ToolTipService.SetToolTip(details, actions.ViewDetailsLabel);
        details.Click += OnNavigateClick;
        column.Children.Add(details);

        var delete = new TsButton
        {
            Variant = ButtonVariant.Icon,
            Size = ControlSize.Small,
            IconGlyph = DeleteGlyph,
        };
        AutomationProperties.SetName(delete, actions.RemoveLabel);
        ToolTipService.SetToolTip(delete, actions.RemoveLabel);
        delete.Click += OnDeleteClick;
        column.Children.Add(delete);

        return column;
    }

    private void OnNavigateClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string route } && !string.IsNullOrEmpty(route))
        {
            NavigationRequested?.Invoke(this, new VehicleCardNavigationEventArgs(route));
        }
    }

    private void OnDeleteClick(object sender, RoutedEventArgs e) =>
        DeleteRequested?.Invoke(this, new VehicleCardDeleteEventArgs(_actions.VehicleId, _actions.VehicleName));

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var card = new StackPanel { Spacing = 12, Padding = new Thickness(16) };

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
        row.Children.Add(new TsSkeleton { BlockWidth = 96, BlockHeight = 96, Radius = 12, ReduceMotion = MotionPreference.ReduceMotion });

        var lines = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        lines.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 18, Radius = 6, ReduceMotion = MotionPreference.ReduceMotion });
        lines.Children.Add(new TsSkeleton { BlockWidth = 240, BlockHeight = 12, Radius = 6, ReduceMotion = MotionPreference.ReduceMotion });
        lines.Children.Add(new TsSkeleton { BlockWidth = 200, BlockHeight = 12, Radius = 6, ReduceMotion = MotionPreference.ReduceMotion });
        row.Children.Add(lines);

        card.Children.Add(row);

        AutomationProperties.SetName(card, _localizer.GetString("card.loading", "Loading vehicle"));
        LiveRegion.Configure(card);
        LiveRegion.Announce(card);
        return card;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("card.error", "Couldn't load this vehicle"),
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
        IconGlyph = CarGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Accent mapping (categorical accent → themed token, never web hex) ────────────────────────────

    private static string AccentBrushKey(VehicleCardAccent accent) => accent switch
    {
        VehicleCardAccent.Green => "TsChartBatteryBrush",
        VehicleCardAccent.Amber => "TsChartEnergyBrush",
        VehicleCardAccent.Red => "TsColorDangerBrush",
        VehicleCardAccent.Cyan => "TsChartSpeedBrush",
        _ => "TsColorTextMutedBrush",
    };

    private static Brush AccentBrush(VehicleCardAccent accent) => DisplayTokens.Brush(AccentBrushKey(accent));

    private static Color ColorFromKey(string key, Color fallback) =>
        DisplayTokens.Brush(key) is SolidColorBrush scb ? scb.Color : fallback;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleCardAutomationPeer(this);

    private sealed class VehicleCardAutomationPeer(VehicleCard owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((VehicleCard)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
