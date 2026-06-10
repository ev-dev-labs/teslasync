using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
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
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Live Motor Status feature surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx. It reproduces the web glass panel:
/// a "Live Motor Status" title row (Cog icon, muted uppercase caption) above the four chips (Shift State / Power /
/// Regen / Source) and the nine inline metrics (front/rear motor rpm, front/rear torque, front/rear motor temp,
/// inverter temp, battery temp, and the threshold-coloured HV-Isolation readout). The web child is a pure page
/// child whose parent owns the query lifecycle; the native surface owns its own cache-then-network read and so
/// renders every P2 state — a skeleton while loading, a retry surface on a hard failure, a friendly "No live motor
/// telemetry yet" empty state when the response carries no motor object, and a stale / offline freshness chip over
/// the readouts otherwise. All data flows through the shared <see cref="LiveMotorStatusViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every readout carries a Narrator name.
/// </summary>
public sealed partial class LiveMotorStatus : ContentControl, IDisposable
{
    private const string CogGlyph = "\uE713";     // Segoe Fluent — Setting (gear), web Cog icon
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int ChipColumns = 4;            // web grid: 2 cols default, 4 at sm
    private const int MetricColumns = 3;          // web grid: 2 / 3 / 4 — 3 keeps the nine metrics even
    private const double CellSpacing = 12;
    private const double SectionSpacing = 16;
    private const double PanelPadding = 24;       // web GlassPanel p-6
    private const double FadeInDelayMs = 220;     // web FadeIn delay={0.22}
    private const double SkeletonHeight = 200;
    private const double StatusDotSize = 8;

    private readonly LiveMotorStatusViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LiveMotorStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units, diagnostics and initial HV isolation.</summary>
    /// <param name="source">The cache-then-network motor source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="isolationResistanceKohm">Initial HV-isolation resistance (kΩ) from the live state; null when unknown.</param>
    public LiveMotorStatus(
        ILiveMotorStatusSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        LiveMotorStatusDiagnostics? diagnostics = null,
        double? isolationResistanceKohm = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveMotorStatusDiagnostics();
        _viewModel = new LiveMotorStatusViewModel(source, localizer, units, isolationResistanceKohm);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.Title);

        Content = new TsFadeIn
        {
            DelayMs = (int)FadeInDelayMs,
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

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LiveMotorStatusViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the temperatures in the new unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// The live HV-isolation resistance in kΩ (web optional <c>isolationResistance</c> prop). Reassigning
    /// re-projects the HV-Isolation metric — the host wires this from its live SSE state.
    /// </summary>
    public double? IsolationResistanceKohm
    {
        get => _viewModel.IsolationResistanceKohm;
        set => _viewModel.IsolationResistanceKohm = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LiveMotorStatusSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static LiveMotorStatus Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        LiveMotorStatusDiagnostics? diagnostics = null,
        double? isolationResistanceKohm = null)
    {
        var source = new LiveMotorStatusSource(vehicles, api, engine, options, vehicleId);
        return new LiveMotorStatus(source, localizer, units, diagnostics, isolationResistanceKohm);
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

    // ── Header (Cog title + stale/offline chip + freshness + refresh) ──────────────────────────────────

    private Grid BuildHeader()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = CogGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            VerticalAlignment = VerticalAlignment.Center,
        };

        titleRow.Children.Add(icon);
        titleRow.Children.Add(title);
        Grid.SetColumn(titleRow, 0);

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

        header.Children.Add(titleRow);
        header.Children.Add(actions);
        return header;
    }

    private TsBadge BuildFreshnessChip(LiveMotorStatusState state)
    {
        bool offline = state == LiveMotorStatusState.Offline;
        string text = offline
            ? _localizer.GetString("drivetrain.liveMotor.offlineChip", "Offline")
            : _localizer.GetString("drivetrain.liveMotor.staleChip", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private Button BuildRefreshButton()
    {
        var button = new Button
        {
            Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 },
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(6, 2, 6, 2),
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("drivetrain.liveMotor.refresh", "Refresh motor telemetry"));
        button.Click += OnRefreshClick;
        return button;
    }

    // ── Body (chips grid + metrics grid) ───────────────────────────────────────────────────────────────

    private static StackPanel BuildBody(LiveMotorStatusDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var chips = new List<FrameworkElement>(display.Chips.Count);
        foreach (var chip in display.Chips)
        {
            chips.Add(BuildChip(chip));
        }

        var metrics = new List<FrameworkElement>(display.Metrics.Count);
        foreach (var metric in display.Metrics)
        {
            metrics.Add(BuildMetric(metric));
        }

        column.Children.Add(BuildUniformGrid(chips, ChipColumns));
        column.Children.Add(BuildUniformGrid(metrics, MetricColumns));
        return column;
    }

    private static TsStatCard BuildChip(LiveMotorChip chip)
    {
        var card = new TsStatCard
        {
            Label = chip.Label,
            Value = chip.ValueText,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(card, chip.AutomationName);
        return card;
    }

    private static FrameworkElement BuildMetric(LiveMotorMetric metric)
    {
        var inline = new TsInlineMetric { Label = metric.Label, Value = metric.ValueText };

        if (metric.Status is not { } status)
        {
            AutomationProperties.SetName(inline, metric.AutomationName);
            return inline;
        }

        // HV-Isolation: a leading status dot conveys the web Shield threshold colour; the row name carries the
        // full label + value so Narrator reads it once.
        AutomationProperties.SetAccessibilityView(inline, AccessibilityView.Raw);

        var dot = new Ellipse
        {
            Width = StatusDotSize,
            Height = StatusDotSize,
            Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(status)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(dot);
        row.Children.Add(inline);
        AutomationProperties.SetName(row, metric.AutomationName);
        return row;
    }

    private static Grid BuildUniformGrid(List<FrameworkElement> cells, int columns)
    {
        var grid = new Grid
        {
            ColumnSpacing = CellSpacing,
            RowSpacing = CellSpacing,
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
        AutomationProperties.SetName(skeleton, _localizer.GetString("drivetrain.liveMotor.loading", "Loading motor telemetry"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("drivetrain.liveMotor.error", "Couldn't load motor telemetry"),
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
}
