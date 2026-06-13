using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Text;
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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 live-telemetry Climate feature surface — a parity port of
/// web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx. It reproduces the web
/// <c>GlassPanel</c> chrome (thermometer icon + "Climate" title) wrapping the cabin/outside temperature tiles,
/// the driver/passenger setpoint rows, the HVAC-state row, the six-bar fan-speed indicator and the
/// Defrost / Climate / Precondition system badges. The web component is a pure child that renders content
/// whenever its <c>climateData</c> prop is present and otherwise draws a "No climate data available" empty
/// state; the native feature-view owns its cache-then-network latest-snapshot read and therefore renders every
/// state the P2 contract mandates — a loading skeleton, the populated content, a friendly empty surface, an
/// explicit retry surface on hard failure, plus stale and offline freshness chips. All data flows through the
/// shared <see cref="ClimatePanelViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ClimatePanel : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double FadeInDelayMs = 160;       // web <FadeIn delay={0.16}>
    private const double PanelPadding = 24;         // web p-6
    private const double RootSpacing = 20;          // web mb-5 under the title
    private const double ContentSpacing = 16;       // web space-y-4
    private const double ColumnSpacing = 12;        // web gap-3
    private const double DetailLabelFontSize = 12;  // web text-xs
    private const double DetailValueFontSize = 14;  // web text-sm
    private const double ChipFontSize = 12;
    private const double BadgeFontSize = 11;        // web text-[11px]
    private const double FanBarHeight = 12;         // web h-3
    private const double FanBarSpacing = 4;
    private const double SkeletonHeight = 248;

    // Web graduated bar widths: w-1.5 / w-2 / w-2.5 / w-3 / w-3.5 / w-4 (Tailwind rem → px).
    private static readonly double[] FanBarWidths = { 6, 8, 10, 12, 14, 16 };

    private readonly ClimatePanelViewModel _viewModel;
    private readonly ClimatePanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = RootSpacing };
    private readonly Grid _header = new();
    private readonly StackPanel _titleGroup = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _titleIcon = new() { Glyph = ClimatePanelProjection.ThermometerGlyph, FontSize = 16 };
    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = ChipFontSize };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network latest-snapshot source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public ClimatePanel(
        IClimatePanelSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        ClimatePanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ClimatePanelDiagnostics();
        _viewModel = new ClimatePanelViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>climate-panel</c>).</summary>
    public static string SurfaceId => ClimatePanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public ClimatePanelViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the temperatures in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ClimatePanelSource"/> from the shared
    /// data layer (the host's P2-core dependencies), scoped to <paramref name="vehicleId"/> or, when null, the
    /// primary vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static ClimatePanel Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        ClimatePanelDiagnostics? diagnostics = null)
    {
        var source = new ClimatePanelSource(vehicles, api, engine, options, vehicleId);
        return new ClimatePanel(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        _titleIcon.Foreground = DisplayTokens.Accent;
        _titleGroup.Children.Add(_titleIcon);
        _titleGroup.Children.Add(_title);

        _freshnessChip.Content = _freshnessChipText;
        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleGroup, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_titleGroup);
        _header.Children.Add(_actions);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Padding = new Thickness(PanelPadding);
        _panel.Content = _root;
        _fade.Content = _panel;
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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _refresh.Click -= OnRefreshClick;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
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
        var state = _viewModel.State;

        _title.Value = display.Title;
        AutomationProperties.SetName(this, display.PanelAutomationName);

        UpdateFreshness(state);
        _bodyHost.Child = BuildBody(display, state);
    }

    private void UpdateFreshness(ClimatePanelState state)
    {
        bool showActions = state is not (ClimatePanelState.Loading or ClimatePanelState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == ClimatePanelState.Stale;
        bool offline = state == ClimatePanelState.Offline;
        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody(ClimatePanelDisplay display, ClimatePanelState state) => state switch
    {
        ClimatePanelState.Loading => BuildLoading(),
        ClimatePanelState.Error => BuildError(),
        ClimatePanelState.Empty => BuildEmpty(),
        _ => _viewModel.HasData ? BuildContent(display) : BuildEmpty(),
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = ColumnSpacing };
        stack.Children.Add(new TsSkeleton
        {
            BlockHeight = SkeletonHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        return stack;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ClimatePanelProjection.ThermometerGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildContent(ClimatePanelDisplay display)
    {
        var content = new StackPanel { Spacing = ContentSpacing };

        if (display.Cabin is { } cabin && display.Outside is { } outside)
        {
            content.Children.Add(BuildMetricGrid(cabin, outside));
        }

        if (display.DriverSetpoint is { } driver && display.PassengerSetpoint is { } passenger)
        {
            content.Children.Add(BuildSetpointGrid(driver, passenger));
        }

        if (display.HvacState is { } hvac)
        {
            content.Children.Add(BuildDetailRow(hvac));
        }

        if (display.Fan is { } fan)
        {
            content.Children.Add(BuildFanRow(fan));
        }

        if (display.Badges.Count > 0)
        {
            content.Children.Add(BuildBadges(display.Badges));
        }

        AutomationProperties.SetName(content, display.PanelAutomationName);
        return content;
    }

    private static Grid BuildMetricGrid(ClimatePanelMetric cabin, ClimatePanelMetric outside)
    {
        var grid = TwoColumnGrid();

        var cabinCard = new TsMetricCard { Label = cabin.Label, Value = cabin.Value };
        AutomationProperties.SetName(cabinCard, cabin.AutomationName);
        Grid.SetColumn(cabinCard, 0);

        var outsideCard = new TsMetricCard { Label = outside.Label, Value = outside.Value };
        AutomationProperties.SetName(outsideCard, outside.AutomationName);
        Grid.SetColumn(outsideCard, 1);

        grid.Children.Add(cabinCard);
        grid.Children.Add(outsideCard);
        return grid;
    }

    private static Grid BuildSetpointGrid(ClimatePanelDetail driver, ClimatePanelDetail passenger)
    {
        var grid = TwoColumnGrid();

        var driverRow = BuildDetailRow(driver);
        Grid.SetColumn(driverRow, 0);

        var passengerRow = BuildDetailRow(passenger);
        Grid.SetColumn(passengerRow, 1);

        grid.Children.Add(driverRow);
        grid.Children.Add(passengerRow);
        return grid;
    }

    private static Grid BuildDetailRow(ClimatePanelDetail detail)
    {
        var row = new Grid { VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = detail.Label,
            FontSize = DetailLabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 0);

        var value = new TextBlock
        {
            Text = detail.Value,
            FontSize = DetailValueFontSize,
            FontFamily = MonoFont,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(value, 1);

        row.Children.Add(label);
        row.Children.Add(value);
        AutomationProperties.SetName(row, detail.AutomationName);
        return row;
    }

    private static Grid BuildFanRow(ClimatePanelFan fan)
    {
        var row = new Grid { VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelGroup = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        labelGroup.Children.Add(new FontIcon
        {
            Glyph = ClimatePanelProjection.FanGlyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
        });
        labelGroup.Children.Add(new TextBlock
        {
            Text = fan.Label,
            FontSize = DetailLabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(labelGroup, 0);

        var bars = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = FanBarSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        for (int level = 1; level <= ClimatePanelProjection.FanBars; level++)
        {
            bool lit = fan.ActiveLevel >= level;
            bars.Children.Add(new Border
            {
                Width = FanBarWidths[level - 1],
                Height = FanBarHeight,
                CornerRadius = new CornerRadius(2),
                Background = lit ? DisplayTokens.Accent : DisplayTokens.Surface,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        bars.Children.Add(new TextBlock
        {
            Text = fan.Value,
            FontSize = DetailLabelFontSize,
            FontFamily = MonoFont,
            Foreground = DisplayTokens.TextPrimary,
            Margin = new Thickness(6, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(bars, 1);

        row.Children.Add(labelGroup);
        row.Children.Add(bars);
        AutomationProperties.SetName(row, fan.AutomationName);
        return row;
    }

    private static StackPanel BuildBadges(IReadOnlyList<ClimatePanelBadge> badges)
    {
        var group = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
        };

        foreach (var badge in badges)
        {
            group.Children.Add(BuildBadge(badge));
        }

        return group;
    }

    private static TsBadge BuildBadge(ClimatePanelBadge badge)
    {
        var chip = new TsBadge
        {
            Status = badge.Status,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (badge.Glyph is { } glyph)
        {
            row.Children.Add(new FontIcon { Glyph = glyph, FontSize = BadgeFontSize });
        }

        row.Children.Add(new TextBlock
        {
            Text = badge.Label,
            FontSize = BadgeFontSize,
            FontWeight = FontWeights.Medium,
            VerticalAlignment = VerticalAlignment.Center,
        });

        chip.Content = row;
        AutomationProperties.SetName(chip, badge.AutomationName);
        return chip;
    }

    private static Grid TwoColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = ColumnSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        return grid;
    }

    private static FontFamily? MonoFont =>
        Application.Current?.Resources is { } resources
        && resources.TryGetValue("TsTypeFontFamilyMono", out var value)
        && value is FontFamily family
            ? family
            : null;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ClimatePanelAutomationPeer(this);

    private sealed class ClimatePanelAutomationPeer(ClimatePanel owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((ClimatePanel)Owner).ViewModel.Title
                : name;
        }
    }
}
