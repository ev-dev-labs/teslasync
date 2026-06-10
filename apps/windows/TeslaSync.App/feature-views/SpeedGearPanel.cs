using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
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
/// The native WinUI 3 Speed &amp; Gear feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx. It reproduces the web
/// <c>GlassPanel</c> wrapper (the "Speed &amp; Gear" header) over a four-tile grid: the big shift-state letter
/// tinted by gear (D emerald / R red / N yellow / P muted) with its status badge beneath, the Motor-Power tile
/// (<c>power_kw</c> + "kW"), and the Average / Top drive-speed tiles (SI m/s converted to the user's display
/// unit once at the boundary). The web component is a pure child of the Driving-Dynamics page; the native
/// surface binds its own cache-then-network <see cref="SpeedGearPanelViewModel"/>, so it renders every state
/// the P2 contract requires — the skeleton while loading, a retry surface on a hard failure, a friendly empty
/// state when there is no live motor object and no drive speed, and a stale / offline freshness chip over the
/// tiles otherwise. The view never performs HTTP. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class SpeedGearPanel : ContentControl, IDisposable
{
    private const string GearGlyph = "\uE713";    // Segoe Fluent — Setting (gear), the Speed & Gear motif
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 150;          // web FadeIn delay={0.15}
    private const double OuterPadding = 24;        // web GlassPanel p-6
    private const double SectionSpacing = 16;      // web mb-4
    private const double TileSpacing = 24;         // web grid gap-6
    private const double ShiftFontSize = 48;       // web text-5xl
    private const double ValueFontSize = 24;       // web text-2xl
    private const double SkeletonHeight = 132;
    private const double SkeletonIconSize = 16;
    private const int TileColumns = 4;             // web grid: 2 cols default, 4 at md

    private readonly SpeedGearPanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SpeedGearPanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network speed-and-gear source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public SpeedGearPanel(
        ISpeedGearPanelSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        SpeedGearPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SpeedGearPanelDiagnostics();
        _viewModel = new SpeedGearPanelViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>speed-gear-panel</c>).</summary>
    public static string SurfaceId => SpeedGearPanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SpeedGearPanelViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the speeds in the new unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SpeedGearPanelSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SpeedGearPanel Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        SpeedGearPanelDiagnostics? diagnostics = null)
    {
        var source = new SpeedGearPanelSource(vehicles, api, engine, options, vehicleId);
        return new SpeedGearPanel(source, localizer, units, diagnostics);
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
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        _fade.Content = _viewModel.State switch
        {
            SpeedGearPanelState.Loading => BuildLoading(),
            SpeedGearPanelState.Error => BuildErrorSurface(),
            _ => BuildPanel(),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ───────────────────────────────────

    private TsGlassPanel BuildPanel()
    {
        var display = _viewModel.Display;

        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader());

        if (_viewModel.State == SpeedGearPanelState.Empty || !display.HasData)
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = GearGlyph,
                Message = display.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }
        else
        {
            column.Children.Add(BuildTilesGrid(display));
        }

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private Grid BuildHeader()
    {
        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new SectionTitle
        {
            Value = _viewModel.Title,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(title, 0);
        header.Children.Add(title);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    private static Grid BuildTilesGrid(SpeedGearPanelDisplay display)
    {
        var grid = new Grid { ColumnSpacing = TileSpacing, RowSpacing = TileSpacing };
        for (int c = 0; c < TileColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var shift = BuildShiftTile(display.Shift);
        Grid.SetColumn(shift, 0);
        grid.Children.Add(shift);

        int column = 1;
        foreach (var metric in display.Metrics)
        {
            if (column >= TileColumns)
            {
                break;
            }

            var tile = BuildMetricTile(metric);
            Grid.SetColumn(tile, column);
            grid.Children.Add(tile);
            column++;
        }

        return grid;
    }

    private static StackPanel BuildShiftTile(SpeedGearShiftTile shift)
    {
        var content = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var letter = new TextBlock
        {
            Text = shift.Letter,
            FontSize = ShiftFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(shift.BrushKey),
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(letter, AccessibilityView.Raw);
        content.Children.Add(letter);

        var badge = new TsBadge
        {
            Status = shift.BadgeStatus,
            Content = new TextBlock { Text = shift.BadgeLabel, FontSize = 12 },
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, shift.BadgeLabel);
        content.Children.Add(badge);

        AutomationProperties.SetName(content, shift.AutomationName);
        return content;
    }

    private static StackPanel BuildMetricTile(SpeedGearMetric metric)
    {
        var content = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        content.Children.Add(new Caption
        {
            Value = metric.Label,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        content.Children.Add(new TextBlock
        {
            Text = metric.ValueText,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        content.Children.Add(new Caption
        {
            Value = metric.Unit,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(content, metric.AutomationName);
        return content;
    }

    // ── Header actions (freshness chip + freshness + refresh) ───────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is SpeedGearPanelState.Stale or SpeedGearPanelState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == SpeedGearPanelState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(SpeedGearPanelState state)
    {
        bool offline = state == SpeedGearPanelState.Offline;
        string text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;

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
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        column.Children.Add(new TsSkeleton
        {
            BlockWidth = 160,
            BlockHeight = SkeletonIconSize,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        column.Children.Add(new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = SkeletonHeight,
            Radius = 12,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(CultureInfo.CurrentCulture, "{0}. {1}", _viewModel.Title, _viewModel.LoadingLabel));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
