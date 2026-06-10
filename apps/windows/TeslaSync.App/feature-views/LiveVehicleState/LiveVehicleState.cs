using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Live Vehicle State feature surface — a parity port of
/// web/src/features/admin/components/security-access/LiveVehicleState.tsx. It reproduces the web glass panel: a
/// "Live Vehicle State" title row with the green "Live" indicator (shown when a security event is present) above a
/// five-column grid of the ten signal tiles (Hazards / High Beams / Turn Signal / Driver Seat / Paired Keys /
/// Valet Mode / Service Mode / Speed Limit / HomeLink Devices / Center Display) — each a glyph + label + value
/// that tints cyan when the signal is active and muted otherwise. The web child is a pure page child whose parent
/// owns the query lifecycle; the native surface owns its own cache-then-network read and so renders every P2
/// state — a skeleton while loading, a retry surface on a hard failure, a friendly "No live state data available"
/// empty state when the response carries no security object, and a stale / offline freshness chip over the tiles
/// otherwise. All data flows through the shared <see cref="LiveVehicleStateViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every tile carries a Narrator name.
/// </summary>
public sealed partial class LiveVehicleState : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";          // Segoe Fluent — Refresh
    private const string EmptyGlyph = "\uEA18";            // Segoe Fluent — Shield (security empty affordance)
    private const string ActiveBrushKey = "TsChartSpeedBrush"; // cyan accent (web text-cyan-400)
    private const int GridColumns = 5;                     // web grid: 2 / 3 / 5 — 5 keeps the ten tiles even
    private const int FadeInDelayMs = 170;                 // web FadeIn delay={0.17}
    private const double PanelPadding = 16;                // web GlassPanel p-4
    private const double TilePadding = 12;                 // web tile p-3
    private const double SectionSpacing = 16;              // web mb-4
    private const double TileSpacing = 12;                 // web gap-3
    private const double TileInnerSpacing = 6;             // web mb-1.5 between rows
    private const double IconRowSpacing = 8;               // web gap-2
    private const double IconSize = 16;                    // web h-4 w-4
    private const double LabelFontSize = 11;               // web text-[10px]
    private const double ValueFontSize = 14;               // web text-sm
    private const double LiveDotSize = 8;
    private const double SkeletonHeight = 132;

    private readonly LiveVehicleStateViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LiveVehicleStateDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public LiveVehicleState(
        ILiveVehicleStateSource source,
        ILocalizer localizer,
        LiveVehicleStateDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveVehicleStateDiagnostics();
        _viewModel = new LiveVehicleStateViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.Title);

        Content = new TsFadeIn
        {
            DelayMs = FadeInDelayMs,
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

    /// <summary>The canonical surface id (<c>live-vehicle-state</c>).</summary>
    public static string RegistryId => LiveVehicleStateRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LiveVehicleStateViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LiveVehicleStateSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static LiveVehicleState Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        LiveVehicleStateDiagnostics? diagnostics = null)
    {
        var source = new LiveVehicleStateSource(vehicles, api, engine, options, vehicleId);
        return new LiveVehicleState(source, localizer, diagnostics);
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
            case LiveVehicleStateState.Loading:
                _root.Children.Add(BuildLoading());
                break;

            case LiveVehicleStateState.Error:
                _root.Children.Add(BuildError());
                break;

            case LiveVehicleStateState.Empty:
                _root.Children.Add(BuildEmpty());
                break;

            default:
                _root.Children.Add(_viewModel.Display is { } display ? BuildGrid(display) : BuildEmpty());
                break;
        }
    }

    // ── Header (title + Live / stale / offline adornment + refresh) ─────────────────────────────────────

    private Grid BuildHeader()
    {
        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new PanelTitle { Value = _viewModel.Title, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(title, 0);
        header.Children.Add(title);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = IconRowSpacing,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (BuildAdornment() is { } adornment)
        {
            actions.Children.Add(adornment);
        }

        if (ShouldShowRefresh())
        {
            actions.Children.Add(BuildRefreshButton());
        }

        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);
        return header;
    }

    private FrameworkElement? BuildAdornment() => _viewModel.State switch
    {
        LiveVehicleStateState.Loaded => BuildLiveIndicator(),
        LiveVehicleStateState.Stale => BuildFreshnessChip(offline: false),
        LiveVehicleStateState.Offline => BuildFreshnessChip(offline: true),
        _ => null,
    };

    // Web parity: the green pulsing CircleDot + "Live" label shown when a security event is present.
    private StackPanel BuildLiveIndicator()
    {
        string text = _viewModel.LiveIndicator;
        var accent = DisplayTokens.Brush("TsColorSuccessBrush");

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TileInnerSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var dot = new Ellipse
        {
            Width = LiveDotSize,
            Height = LiveDotSize,
            Fill = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
        row.Children.Add(dot);

        row.Children.Add(new TextBlock
        {
            Text = text,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, text);
        return row;
    }

    private TsBadge BuildFreshnessChip(bool offline)
    {
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("admin.security.live.staleChip", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private bool ShouldShowRefresh() => _viewModel.State is
        LiveVehicleStateState.Loaded or
        LiveVehicleStateState.Stale or
        LiveVehicleStateState.Offline or
        LiveVehicleStateState.Empty;

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
        AutomationProperties.SetName(button, _localizer.GetString("admin.security.live.refresh", "Refresh live vehicle state"));
        button.Click += OnRefreshClick;
        return button;
    }

    // ── Body: the five-column tile grid ─────────────────────────────────────────────────────────────────

    private static Grid BuildGrid(LiveVehicleStateDisplay display)
    {
        var grid = new Grid
        {
            ColumnSpacing = TileSpacing,
            RowSpacing = TileSpacing,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (display.Signals.Count + GridColumns - 1) / GridColumns;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Signals.Count; i++)
        {
            var tile = BuildTile(display.Signals[i]);
            Grid.SetColumn(tile, i % GridColumns);
            Grid.SetRow(tile, i / GridColumns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static TsGlassPanel BuildTile(LiveVehicleSignal signal)
    {
        var accent = signal.Active ? DisplayTokens.Brush(ActiveBrushKey) : DisplayTokens.TextMuted;

        var iconRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = IconRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = signal.Glyph,
            FontSize = IconSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        iconRow.Children.Add(icon);

        iconRow.Children.Add(new TextBlock
        {
            Text = signal.Label,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var value = new TextBlock
        {
            Text = signal.ValueText,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = signal.Active ? DisplayTokens.TextPrimary : DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var column = new StackPanel { Spacing = TileInnerSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(iconRow);
        column.Children.Add(value);

        var tile = new TsGlassPanel { Padding = new Thickness(TilePadding), Content = column };
        AutomationProperties.SetName(tile, signal.AutomationName);
        return tile;
    }

    // ── State surfaces (loading / error / empty) ────────────────────────────────────────────────────────

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
        AutomationProperties.SetName(skeleton, _localizer.GetString("admin.security.live.loading", "Loading live vehicle state"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("admin.security.live.error", "Couldn't load live vehicle state"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EmptyGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };
}
