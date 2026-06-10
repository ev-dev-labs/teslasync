using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 driving-dynamics Live Motor Status feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx. It reproduces the web glass panel: a
/// "Live Motor Status" title above a four-tile grid of three radial gauges (total Torque, Front RPM, Motor
/// temperature) plus a shift-state chip (a gear glyph and the shift letter, success-tinted in Drive). The web
/// child is a pure page child whose parent owns the query lifecycle; the native surface owns its own
/// cache-then-network read and so renders every P2 state — a skeleton while loading, a retry surface on a hard
/// failure, a friendly "Awaiting live motor data" empty state when the response carries no motor object, and a
/// stale / offline freshness chip over the readouts otherwise. All data flows through the shared
/// <see cref="LiveMotorStatusViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every readout carries a Narrator name. Namespaced under <c>Driving</c> to coexist with the
/// drivetrain-health <c>LiveMotorStatus</c>, mirroring the <c>HeroGauges</c> per-feature-area precedent.
/// </summary>
public sealed partial class LiveMotorStatus : ContentControl, IDisposable
{
    private const string CogGlyph = "\uE713";     // Segoe Fluent — Setting (gear), web Cog icon
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int TileColumns = 4;            // web grid: 2 cols default, 4 at md — the four tiles
    private const double TileSpacing = 24;        // web grid gap={6}
    private const double SectionSpacing = 16;     // web title mb-4 / panel rhythm
    private const double PanelPadding = 24;       // web GlassPanel p-6
    private const double GaugeDiameter = 120;     // web RadialGauge size={120}
    private const double BadgeHostSize = 120;     // web shift badge h-[120px] w-[120px]
    private const double GaugeTileSpacing = 8;    // web gauge tile gap-2
    private const double BadgeTileSpacing = 12;   // web shift tile gap-3
    private const double SkeletonHeight = 180;

    private readonly LiveMotorStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LiveMotorStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network motor source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public LiveMotorStatus(
        ILiveMotorStatusSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        LiveMotorStatusDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveMotorStatusDiagnostics();
        _viewModel = new LiveMotorStatusViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.Title);

        Content = new TsFadeIn
        {
            Content = new TsGlassPanel
            {
                Padding = new Thickness(PanelPadding),
                Content = _root,
            },
        };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>live-motor-status</c>).</summary>
    public static string RegistryId => LiveMotorStatusRegistration.Id;

    /// <summary>The diagnostics slug this surface registers under (<c>LiveMotorStatus</c>).</summary>
    public static string Slug => LiveMotorStatusRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LiveMotorStatusViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the temperature in the new unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LiveMotorStatusSource"/> from the shared
    /// data layer (the driving-dynamics host's P2-core dependencies), resolving the primary cached vehicle unless
    /// an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static LiveMotorStatus Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        LiveMotorStatusDiagnostics? diagnostics = null)
    {
        var source = new LiveMotorStatusSource(vehicles, api, engine, options, vehicleId);
        return new LiveMotorStatus(source, localizer, units, diagnostics);
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

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

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
        AutomationProperties.SetName(this, _viewModel.Title);

        _root.Children.Clear();
        _root.Children.Add(BuildHeader());

        switch (_viewModel.State)
        {
            case LiveMotorStatusState.Loading:
                _root.Children.Add(BuildLoading());
                break;

            case LiveMotorStatusState.Error:
                _root.Children.Add(BuildError());
                break;

            case LiveMotorStatusState.Empty:
                _root.Children.Add(BuildEmpty());
                break;

            default:
                _root.Children.Add(_viewModel.Display is { } display ? BuildBody(display) : BuildEmpty());
                break;
        }
    }

    // ── Header (title + stale/offline chip + freshness + refresh) ──────────────────────────────────────

    private Grid BuildHeader()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new SectionTitle
        {
            Value = _viewModel.Title,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(title, 0);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is LiveMotorStatusState.Stale or LiveMotorStatusState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == LiveMotorStatusState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        Grid.SetColumn(actions, 1);

        header.Children.Add(title);
        header.Children.Add(actions);
        return header;
    }

    private TsBadge BuildFreshnessChip(LiveMotorStatusState state)
    {
        bool offline = state == LiveMotorStatusState.Offline;
        string text = offline
            ? _localizer.GetString("dynamics.liveMotor.offlineChip", "Offline")
            : _localizer.GetString("dynamics.liveMotor.staleChip", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new Caption { Value = text },
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
        AutomationProperties.SetName(button, _localizer.GetString("dynamics.liveMotor.refresh", "Refresh motor telemetry"));
        button.Click += OnRefreshClick;
        return button;
    }

    // ── Body (three gauges + shift chip) ───────────────────────────────────────────────────────────────

    private static Grid BuildBody(LiveMotorStatusDisplay display)
    {
        var tiles = new List<FrameworkElement>(TileColumns);
        foreach (var gauge in display.Gauges)
        {
            tiles.Add(BuildGaugeTile(gauge));
        }

        tiles.Add(BuildShiftTile(display.ShiftBadge));
        return BuildUniformGrid(tiles, TileColumns);
    }

    private static StackPanel BuildGaugeTile(LiveMotorGauge gauge)
    {
        var control = new TsRadialGauge
        {
            Value = gauge.Value,
            Max = gauge.Max,
            Label = gauge.Label,
            Unit = gauge.Unit,
            Decimals = gauge.Decimals,
            Role = gauge.Accent,
            Diameter = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(control, AccessibilityView.Raw);

        var caption = new Caption
        {
            Value = gauge.Caption,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);

        var tile = new StackPanel
        {
            Spacing = GaugeTileSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        tile.Children.Add(control);
        tile.Children.Add(caption);
        AutomationProperties.SetName(tile, gauge.AutomationName);
        return tile;
    }

    private static StackPanel BuildShiftTile(LiveMotorShiftBadge shift)
    {
        var badgeContent = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        var icon = new FontIcon { Glyph = CogGlyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        badgeContent.Children.Add(icon);
        badgeContent.Children.Add(new TextBlock
        {
            Text = shift.ValueText,
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var badge = new TsBadge
        {
            Status = shift.Status,
            Content = badgeContent,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var host = new Grid
        {
            Width = BadgeHostSize,
            Height = BadgeHostSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        host.Children.Add(badge);
        AutomationProperties.SetAccessibilityView(host, AccessibilityView.Raw);

        var caption = new Caption
        {
            Value = shift.Caption,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);

        var tile = new StackPanel
        {
            Spacing = BadgeTileSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        tile.Children.Add(host);
        tile.Children.Add(caption);
        AutomationProperties.SetName(tile, shift.AutomationName);
        return tile;
    }

    private static Grid BuildUniformGrid(List<FrameworkElement> cells, int columns)
    {
        var grid = new Grid
        {
            ColumnSpacing = TileSpacing,
            RowSpacing = TileSpacing,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (cells.Count + columns - 1) / columns;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < cells.Count; i++)
        {
            var cell = cells[i];
            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    // ── State surfaces (loading / error / empty) ───────────────────────────────────────────────────────

    private TsSkeleton BuildLoading()
    {
        var skeleton = new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = SkeletonHeight,
            Radius = 12,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(skeleton, $"{_viewModel.Title}. {_localizer.GetString("common.loading", "Loading...")}");
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("dynamics.liveMotor.error", "Couldn't load motor telemetry"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CogGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new LiveMotorStatusAutomationPeer(this);

    private sealed class LiveMotorStatusAutomationPeer(LiveMotorStatus owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((LiveMotorStatus)Owner).ViewModel.Title : name;
        }
    }
}
