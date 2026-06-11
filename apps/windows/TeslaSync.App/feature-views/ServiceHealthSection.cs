using System.Collections.Generic;
using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Service Health surface — a parity port of
/// web/src/features/system/components/status/ServiceHealthSection.tsx. It wraps the shared
/// <see cref="AccordionSection"/> (the web <c>AccordionSection</c>) around the Fleet Telemetry streaming
/// status: an "Enabled/Disabled" header badge plus a "{n} streaming" info badge (shown only when data is
/// present, web <c>data ? … : undefined</c>), a four-tile metric grid (Mode, Vehicles Connected, Total
/// Signals, Avg Signals/s) and a paged, VIN-keyed vehicles table whose Signals column is sortable. Every
/// state renders — a loading skeleton, the populated content, a friendly "No telemetry data available" empty
/// surface, an explicit retry surface on hard failure, plus stale and offline freshness chips. The web
/// <c>refetchInterval: 2_000</c> is reproduced by a 2-second poll. All data flows through the shared
/// <see cref="ServiceHealthViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class ServiceHealthSection : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uE93C";  // Segoe Fluent Radio — web lucide Satellite (Fleet Telemetry streaming)
    private const double LoadingHeight = 192;      // web Skeleton h-48
    private const int VehiclePageSize = 10;        // web DataTable pagination
    private const int MetricColumns = 4;           // web Grid cols md:4
    private const double Gap = 12;                 // web gap-3 / space-y-4

    // Accent rail brush keys mirroring the web MetricCard color props (see InfrastructureSection mapping).
    private const string CyanAccent = "TsColorInfoBrush";     // web color="cyan"
    private const string GreenAccent = "TsColorSuccessBrush";  // web color="green"
    private const string PurpleAccent = "TsChartPowerBrush";   // web color="purple"

    private static readonly UIElement[] NoBadges = System.Array.Empty<UIElement>();

    private readonly ServiceHealthViewModel _viewModel;
    private readonly ServiceHealthDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly DispatcherTimer _pollTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly AccordionSection _accordion;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and (optional) clock.</summary>
    public ServiceHealthSection(
        IServiceHealthSource source,
        ILocalizer localizer,
        ServiceHealthDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ServiceHealthDiagnostics();
        _viewModel = new ServiceHealthViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        var model = new AccordionSectionModel(
            Title: _viewModel.Title,
            Description: _viewModel.Description,
            IconGlyph: HeaderGlyph,
            DefaultOpen: true);
        _accordion = new AccordionSection(localizer, model);
        Content = _accordion;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _pollTimer.Tick += OnPollTick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>service-health-section</c>).</summary>
    public static string SurfaceId => ServiceHealthRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public ServiceHealthViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ServiceHealthSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static ServiceHealthSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ServiceHealthDiagnostics? diagnostics = null)
    {
        var source = new ServiceHealthSource(api, engine, options);
        return new ServiceHealthSection(source, localizer, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;
            _diagnostics.RecordViewOpened();
            _ = _viewModel.LoadAsync();
        }

        // web refetchInterval: 2_000 — poll while the surface is on screen.
        _pollTimer.Start();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => _pollTimer.Stop();

    private void OnPollTick(object? sender, object e) => _ = _viewModel.RefreshAsync();

    /// <summary>Detach from the view-model, stop the poll and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _pollTimer.Stop();
        _pollTimer.Tick -= OnPollTick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

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
        _accordion.Badges = _viewModel.HasBadges ? BuildBadges() : NoBadges;
        _accordion.Body = BuildBody();
    }

    // ── Header badges (web data ? <>…</> : undefined) ──────────────────────────────────────────────

    private UIElement[] BuildBadges()
    {
        var display = _viewModel.Display;

        var enabled = new TsBadge
        {
            Status = display.EnabledBadgeStatus,
            Dot = true,
            Content = new TextBlock { Text = display.EnabledBadgeText, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(enabled, display.EnabledBadgeText);

        var streaming = new TsBadge
        {
            Status = StatusKind.Info,
            Content = new TextBlock { Text = display.StreamingBadgeText, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(streaming, display.StreamingBadgeText);

        return new UIElement[] { enabled, streaming };
    }

    // ── Body (state switch) ────────────────────────────────────────────────────────────────────────

    private UIElement BuildBody() => _viewModel.State switch
    {
        ServiceHealthSectionState.Loading => BuildLoading(),
        ServiceHealthSectionState.Error => BuildError(),
        ServiceHealthSectionState.Empty => BuildEmpty(),
        _ => BuildContent(),
    };

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(new TsSkeleton { BlockHeight = LoadingHeight });

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        Message = _viewModel.NoDataMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private StackPanel BuildContent()
    {
        var root = new StackPanel { Spacing = 16 };  // web space-y-4

        // Freshness chip (stale / offline / updating) — right-aligned above the metrics.
        var chipRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        chipRow.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        });
        root.Children.Add(chipRow);

        root.Children.Add(BuildMetricGrid());
        root.Children.Add(BuildVehiclesTable());
        return root;
    }

    private Grid BuildMetricGrid()
    {
        var display = _viewModel.Display;
        var grid = new Grid { ColumnSpacing = Gap, RowSpacing = Gap };
        for (int i = 0; i < MetricColumns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var tiles = new (string Label, string Value, string Accent)[]
        {
            (_viewModel.ModeLabel, display.ModeValue, CyanAccent),
            (_viewModel.VehiclesConnectedLabel, display.VehiclesConnectedValue, GreenAccent),
            (_viewModel.TotalSignalsLabel, display.TotalSignalsValue, PurpleAccent),
            (_viewModel.AvgSignalsLabel, display.AvgSignalsValue, CyanAccent),
        };

        for (int i = 0; i < tiles.Length; i++)
        {
            var tile = tiles[i];
            var card = new TsMetricCard { Label = tile.Label, Value = tile.Value, AccentBrushKey = tile.Accent };
            Grid.SetColumn(card, i);
            grid.Children.Add(card);
        }

        return grid;
    }

    private TsDataTable BuildVehiclesTable()
    {
        var columns = new List<TsDataColumn>
        {
            new() { Key = "vin", Header = _viewModel.VinHeader, CanSort = false, Width = 180 },
            new() { Key = "status", Header = _viewModel.StatusHeader, CanSort = false, Width = 110 },
            new() { Key = "signal_count", Header = _viewModel.SignalsHeader, CanSort = true, Width = 110 },
            new() { Key = "signals_per_second", Header = _viewModel.SignalsPerSecondHeader, CanSort = false, Width = 110 },
            new() { Key = "latency_ms", Header = _viewModel.LatencyHeader, CanSort = false, Width = 120 },
            new() { Key = "last_received", Header = _viewModel.LastReceivedHeader, CanSort = false, Width = 190 },
        };

        var rows = new List<TsDataRow>(_viewModel.Display.VehicleRows.Count);
        foreach (var row in _viewModel.Display.VehicleRows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vin"] = row.Vin,
                ["status"] = row.StatusText,
                ["signal_count"] = row.SignalCount,
                ["signals_per_second"] = row.SignalsPerSecondText,
                ["latency_ms"] = row.LatencyText,
                ["last_received"] = row.LastReceivedText,
            };
            rows.Add(new TsDataRow(row.Vin, values));
        }

        return new TsDataTable
        {
            Columns = columns,
            Rows = rows,
            Selectable = false,
            PageSize = VehiclePageSize,
            EmptyMessage = _viewModel.NoVehiclesMessage,
        };
    }

    protected override Microsoft.UI.Xaml.Automation.Peers.AutomationPeer OnCreateAutomationPeer() =>
        new ServiceHealthSectionAutomationPeer(this);

    private sealed class ServiceHealthSectionAutomationPeer(ServiceHealthSection owner)
        : Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer(owner)
    {
        protected override Microsoft.UI.Xaml.Automation.Peers.AutomationControlType GetAutomationControlTypeCore() =>
            Microsoft.UI.Xaml.Automation.Peers.AutomationControlType.Group;
    }
}
