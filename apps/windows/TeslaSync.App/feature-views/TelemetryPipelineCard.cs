using System.Globalization;
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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Telemetry Pipeline surface — a parity port of
/// web/src/features/system/components/status/TelemetryPipelineCard.tsx. It composes the web component's
/// regions: a five-up fleet rollup grid (vehicles · GPS positions · drives · charging sessions · signal
/// log), a liveness summary + broker/polling connectivity chip row, and a per-vehicle list (status pip,
/// name, masked VIN, state, battery bar, liveness chip + ingest source, and the last-seen / next-poll
/// relative labels), plus a footer of navigation affordances. Every state renders — a loading skeleton, the
/// populated card, a friendly "no vehicles configured" empty state, an explicit retry surface on hard
/// failure, plus stale and offline chips. All data flows through the shared
/// <see cref="TelemetryPipelineCardViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TelemetryPipelineCard : ContentControl, IDisposable
{
    private const string CoverageGlyph = "\uE9D9";       // Diagnostic
    private const string InspectorGlyph = "\uEC05";      // NetworkTower
    private const string VehiclesGlyph = "\uE804";       // Vehicle-ish
    private const string RadioGlyph = "\uEC05";          // NetworkTower (streaming)
    private const string PollGlyph = "\uE704";           // Connection
    private const string CarGlyph = "\uE804";            // Vehicle-ish
    private const double BatteryBarWidth = 48;
    private const double VehicleListMaxHeight = 420;
    private const int TickSeconds = 5;

    private readonly TelemetryPipelineCardViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TelemetryPipelineCardDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private DispatcherQueueTimer? _tickTimer;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    public TelemetryPipelineCard(
        ITelemetryPipelineCardSource source,
        ILocalizer localizer,
        TelemetryPipelineCardDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TelemetryPipelineCardDiagnostics();
        _viewModel = new TelemetryPipelineCardViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.AccessibleName);

        Content = new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = _root,
        };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the "Open Telemetry Coverage" footer affordance is invoked.</summary>
    public event EventHandler? OpenCoverageRequested;

    /// <summary>Raised when the "MQTT Inspector" footer affordance is invoked.</summary>
    public event EventHandler? OpenMqttInspectorRequested;

    /// <summary>Raised when the "All vehicles" footer affordance is invoked.</summary>
    public event EventHandler? OpenAllVehiclesRequested;

    /// <summary>The canonical surface id (<c>telemetry-pipeline-card</c>).</summary>
    public static string SurfaceId => TelemetryPipelineCardRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public TelemetryPipelineCardViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TelemetryPipelineCardSource"/> from the
    /// shared data layer (the host's P2-core dependencies). The <paramref name="http"/> client is the shared,
    /// already-authenticated pipeline used for the non-contract polling read.
    /// </summary>
    public static TelemetryPipelineCard Create(
        IApiClient api,
        System.Net.Http.HttpClient http,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TelemetryPipelineCardDiagnostics? diagnostics = null)
    {
        var source = new TelemetryPipelineCardSource(api, http, engine, options);
        return new TelemetryPipelineCard(source, localizer, diagnostics);
    }

    /// <summary>
    /// Supply the host page's fleet context (the web component's props: the roster + the four counts). The
    /// card joins this against the live streaming/polling reads rather than fetching the roster itself.
    /// </summary>
    public void SetFleetContext(
        IReadOnlyList<TelemetryPipelineVehicle> vehicles,
        long positionCount,
        long drivesCount,
        long? chargingSessionsCount,
        long? signalLogCount) =>
        _viewModel.SetFleetContext(vehicles, positionCount, drivesCount, chargingSessionsCount, signalLogCount);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
        StartTick();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model, stop the relative-time tick and cancel any in-flight load.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopTick();
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void StartTick()
    {
        if (_dispatcher is not { } dispatcher)
        {
            return;
        }

        _tickTimer = dispatcher.CreateTimer();
        _tickTimer.Interval = TimeSpan.FromSeconds(TickSeconds);
        _tickTimer.Tick += OnTick;
        _tickTimer.Start();
    }

    private void StopTick()
    {
        if (_tickTimer is { } timer)
        {
            timer.Tick -= OnTick;
            timer.Stop();
            _tickTimer = null;
        }
    }

    private void OnTick(DispatcherQueueTimer sender, object args) => _viewModel.Tick();

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
        _root.Children.Clear();

        // The fleet rollup grid and the footer always render (web parity — they never depend on a fetch).
        _root.Children.Add(BuildFleetGrid(display.FleetCells));

        switch (_viewModel.State)
        {
            case TelemetryPipelineState.Loading:
                _root.Children.Add(BuildLoading());
                break;

            case TelemetryPipelineState.Error:
                _root.Children.Add(BuildError());
                break;

            case TelemetryPipelineState.Empty:
                _root.Children.Add(BuildEmpty());
                break;

            default:
                _root.Children.Add(BuildChipRow(display));
                _root.Children.Add(BuildVehicleList(display));
                break;
        }

        _root.Children.Add(BuildFooter());
    }

    // ── Fleet rollup grid ───────────────────────────────────────────────────────────────────────────────

    private static Grid BuildFleetGrid(IReadOnlyList<FleetRollupCell> cells)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
        for (int i = 0; i < cells.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < cells.Count; i++)
        {
            var cell = new StackPanel { Spacing = 2 };
            cell.Children.Add(new TextBlock
            {
                Text = cells[i].Label,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
            cell.Children.Add(new TextBlock
            {
                Text = cells[i].Value,
                FontSize = 14,
                Foreground = DisplayTokens.TextPrimary,
                IsTextSelectionEnabled = false,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
            AutomationProperties.SetName(
                cell,
                string.Format(CultureInfo.CurrentCulture, "{0}: {1}", cells[i].Label, cells[i].Value));
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    // ── Liveness + connectivity chip row ──────────────────────────────────────────────────────────────

    private ScrollViewer BuildChipRow(TelemetryPipelineDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (display.HasVehicles)
        {
            row.Children.Add(new TextBlock
            {
                Text = _viewModel.LivenessHeaderLabel,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });

            foreach (var chip in display.LivenessChips)
            {
                row.Children.Add(BuildChip(chip.Label, chip.Status, dot: true, chip.AutomationName));
            }
        }

        var connectivity = display.Connectivity;
        row.Children.Add(BuildChip(
            connectivity.MqttLabel,
            connectivity.MqttStatus,
            dot: false,
            connectivity.MqttLabel,
            connectivity.MqttConnected ? RadioGlyph : null));

        if (connectivity.ShowPollingChip)
        {
            row.Children.Add(BuildChip(connectivity.PollingLabel, connectivity.PollingStatus, dot: false, connectivity.PollingLabel, PollGlyph));
        }

        if (_viewModel.State == TelemetryPipelineState.Stale)
        {
            row.Children.Add(BuildChip(_viewModel.StaleLabel, StatusKind.Warning, dot: true, _viewModel.StaleLabel));
        }
        else if (_viewModel.State == TelemetryPipelineState.Offline)
        {
            row.Children.Add(BuildChip(_viewModel.OfflineLabel, StatusKind.Danger, dot: true, _viewModel.OfflineLabel));
        }

        row.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.StreamUpdatedAt,
            IsFetching = _viewModel.StreamIsFetching,
            IsError = _viewModel.StreamIsError,
            VerticalAlignment = VerticalAlignment.Center,
        });

        // Never hide chips on a narrow card — let them scroll horizontally rather than clip.
        return new ScrollViewer
        {
            Content = row,
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private static TsBadge BuildChip(string text, StatusKind status, bool dot, string automationName, string? glyph = null)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (glyph is { } g)
        {
            var icon = new FontIcon { Glyph = g, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            content.Children.Add(icon);
        }

        content.Children.Add(new TextBlock { Text = text, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });

        var chip = new TsBadge
        {
            Status = status,
            Dot = dot,
            Content = content,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(chip, automationName);
        return chip;
    }

    // ── Per-vehicle list ──────────────────────────────────────────────────────────────────────────────

    private ScrollViewer BuildVehicleList(TelemetryPipelineDisplay display)
    {
        var list = new StackPanel { Spacing = 0 };
        bool first = true;
        foreach (var row in display.VehicleRows)
        {
            list.Children.Add(BuildVehicleRow(row, first));
            first = false;
        }

        return new ScrollViewer
        {
            Content = list,
            MaxHeight = VehicleListMaxHeight,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Border BuildVehicleRow(TelemetryVehicleRow row, bool first)
    {
        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(8, 10, 8, 10) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Column 0 — status pip + name + VIN/state.
        var identity = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
        };
        identity.Children.Add(StatusPip(row.LivenessStatus));

        var carIcon = new FontIcon { Glyph = CarGlyph, FontSize = 16, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(carIcon, AccessibilityView.Raw);
        identity.Children.Add(carIcon);

        var nameColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        nameColumn.Children.Add(new TextBlock
        {
            Text = row.DisplayName,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        var subLine = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        subLine.Children.Add(new TextBlock
        {
            Text = row.VinTailText,
            FontSize = 11,
            FontFamily = new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        subLine.Children.Add(new TextBlock
        {
            Text = row.StateLabel,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        nameColumn.Children.Add(subLine);
        identity.Children.Add(nameColumn);
        Grid.SetColumn(identity, 0);
        grid.Children.Add(identity);

        // Column 1 — battery.
        var battery = BuildBattery(row);
        Grid.SetColumn(battery, 1);
        grid.Children.Add(battery);

        // Column 2 — liveness chip + last/next labels.
        var statusColumn = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Right };
        statusColumn.Children.Add(BuildLivenessChip(row));
        statusColumn.Children.Add(new TextBlock
        {
            Text = BuildTimingText(row),
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(statusColumn, 2);
        grid.Children.Add(statusColumn);

        var border = new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, first ? 0 : 1, 0, 0),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private static Border StatusPip(StatusKind status)
    {
        var pip = new Border
        {
            Width = 10,
            Height = 10,
            CornerRadius = new CornerRadius(5),
            Background = DisplayTokens.Brush(StatusResources.AccentBrushKey(status)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(pip, AccessibilityView.Raw);
        return pip;
    }

    private static StackPanel BuildBattery(TelemetryVehicleRow row)
    {
        var host = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (row.BatteryPercent is not { } pct)
        {
            host.Children.Add(new TextBlock
            {
                Text = "\u2014",
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
            return host;
        }

        int clamped = Math.Clamp(pct, 0, 100);
        var track = new Border
        {
            Width = BatteryBarWidth,
            Height = 6,
            CornerRadius = new CornerRadius(3),
            Background = DisplayTokens.Brush("TsColorBorderBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        var fill = new Border
        {
            Width = BatteryBarWidth * clamped / 100d,
            Height = 6,
            CornerRadius = new CornerRadius(3),
            Background = DisplayTokens.Brush(StatusResources.AccentBrushKey(row.BatteryStatus)),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        track.Child = fill;
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        host.Children.Add(track);

        host.Children.Add(new TextBlock
        {
            Text = string.Format(CultureInfo.CurrentCulture, "{0}%", clamped),
            FontSize = 12,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return host;
    }

    private TsBadge BuildLivenessChip(TelemetryVehicleRow row)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = row.SourceLabel is not null && string.Equals(
                row.SourceLabel,
                _localizer.GetString("telemetry.pipeline.source.stream", "stream"),
                StringComparison.Ordinal)
                ? RadioGlyph
                : PollGlyph,
            FontSize = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        content.Children.Add(glyph);

        content.Children.Add(new TextBlock { Text = row.LivenessLabel, FontSize = 11, VerticalAlignment = VerticalAlignment.Center });

        if (row.SourceLabel is { } source)
        {
            content.Children.Add(new TextBlock
            {
                Text = source,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var chip = new TsBadge
        {
            Status = row.LivenessStatus,
            Content = content,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetName(chip, row.LivenessLabel);
        return chip;
    }

    private string BuildTimingText(TelemetryVehicleRow row)
    {
        string text = string.Format(CultureInfo.CurrentCulture, "{0} {1}", _viewModel.LastPrefix, row.LastSeenText);
        if (row.HasNextPoll && row.NextPollText is { } next)
        {
            text = string.Format(
                CultureInfo.CurrentCulture,
                "{0}  \u00b7  {1} {2}",
                text,
                _viewModel.NextPrefix,
                next);
        }

        return text;
    }

    // ── State surfaces ──────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(0, 4, 0, 4) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 22 });
        }

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = CarGlyph,
        Title = _viewModel.EmptyTitle,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.StreamAttempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Footer ────────────────────────────────────────────────────────────────────────────────────────

    private Border BuildFooter()
    {
        var footer = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Padding = new Thickness(0, 8, 0, 0),
        };
        footer.Children.Add(FooterButton(_viewModel.CoverageLinkLabel, CoverageGlyph, ButtonVariant.Secondary, OnOpenCoverage));
        footer.Children.Add(FooterButton(_viewModel.MqttInspectorLinkLabel, InspectorGlyph, ButtonVariant.Subtle, OnOpenInspector));
        footer.Children.Add(FooterButton(_viewModel.AllVehiclesLinkLabel, VehiclesGlyph, ButtonVariant.Subtle, OnOpenAllVehicles));

        return new Border
        {
            Child = footer,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(0, 8, 0, 0),
        };
    }

    private static TsButton FooterButton(string label, string glyph, ButtonVariant variant, RoutedEventHandler handler)
    {
        var button = new TsButton
        {
            Variant = variant,
            Size = ControlSize.Small,
            Text = label,
            IconGlyph = glyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, label);
        button.Click += handler;
        return button;
    }

    private void OnOpenCoverage(object sender, RoutedEventArgs e) => OpenCoverageRequested?.Invoke(this, EventArgs.Empty);

    private void OnOpenInspector(object sender, RoutedEventArgs e) => OpenMqttInspectorRequested?.Invoke(this, EventArgs.Empty);

    private void OnOpenAllVehicles(object sender, RoutedEventArgs e) => OpenAllVehiclesRequested?.Invoke(this, EventArgs.Empty);
}
