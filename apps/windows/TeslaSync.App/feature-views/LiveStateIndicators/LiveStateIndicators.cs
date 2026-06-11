using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;
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
/// The native WinUI 3 Live State Indicators feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx. It reproduces the web's wrapping
/// row of five status chips (Speed / Lock / Sentry / Climate / Charging), each a leading status dot plus the
/// localized label tinted by its semantic status. The web child is a pure page child whose parent owns the
/// <c>useVehicleState</c> query lifecycle; the native surface owns its own cache-then-network read and so renders
/// every P2 state — a skeleton row while loading, a retry surface on a hard failure, a friendly "No live state
/// data available" empty state when no vehicle state resolves, and a stale / offline freshness chip (plus a
/// refresh affordance) over the chips otherwise. All data flows through the shared
/// <see cref="LiveStateIndicatorsViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every chip carries a Narrator name.
/// </summary>
public sealed partial class LiveStateIndicators : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";   // Segoe Fluent — Refresh
    private const string EmptyGlyph = "\uE804";      // Segoe Fluent — Car (vehicle-state empty affordance)
    private const int FadeInDelayMs = 60;            // web FadeIn delay={0.06}
    private const double ChipGap = 8;                // web gap-2
    private const double RowSpacing = 8;             // gap between the freshness row and the chip row
    private const double ChipFontSize = 13;          // web Badge size="lg" (~text-sm)
    private const double SkeletonChipHeight = 28;
    private const double SkeletonChipRadius = 14;

    private static readonly double[] SkeletonChipWidths = { 104, 96, 132, 120, 140 };

    private readonly LiveStateIndicatorsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly LiveStateIndicatorsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = RowSpacing };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network vehicle-state source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public LiveStateIndicators(
        ILiveStateIndicatorsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        LiveStateIndicatorsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new LiveStateIndicatorsDiagnostics();
        _viewModel = new LiveStateIndicatorsViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.Title);

        Content = new TsFadeIn
        {
            DelayMs = FadeInDelayMs,
            Content = _root,
        };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>live-state-indicators</c>).</summary>
    public static string RegistryId => LiveStateIndicatorsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LiveStateIndicatorsViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the chips in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="LiveStateIndicatorsSource"/> from the
    /// shared data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static LiveStateIndicators Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        LiveStateIndicatorsDiagnostics? diagnostics = null)
    {
        var source = new LiveStateIndicatorsSource(vehicles, api, engine, options, vehicleId);
        return new LiveStateIndicators(source, localizer, units, diagnostics);
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

        switch (_viewModel.State)
        {
            case LiveStateIndicatorsState.Loading:
                _root.Children.Add(BuildLoading());
                break;

            case LiveStateIndicatorsState.Error:
                _root.Children.Add(BuildError());
                break;

            case LiveStateIndicatorsState.Empty:
                _root.Children.Add(BuildEmpty());
                break;

            default:
                if (_viewModel.State is LiveStateIndicatorsState.Stale or LiveStateIndicatorsState.Offline)
                {
                    _root.Children.Add(BuildFreshnessRow(offline: _viewModel.State is LiveStateIndicatorsState.Offline));
                }

                _root.Children.Add(_viewModel.Display is { } display ? BuildChips(display) : BuildEmpty());
                break;
        }
    }

    // ── Body: the wrapping chip row ─────────────────────────────────────────────────────────────────────

    private static ChipWrapPanel BuildChips(LiveStateIndicatorsDisplay display)
    {
        var strip = new ChipWrapPanel
        {
            HorizontalSpacing = ChipGap,
            VerticalSpacing = ChipGap,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(strip, display.AutomationName);

        foreach (var indicator in display.Indicators)
        {
            strip.Children.Add(BuildChip(indicator));
        }

        return strip;
    }

    private static TsBadge BuildChip(LiveStateIndicator indicator)
    {
        var badge = new TsBadge
        {
            Status = indicator.Status,
            Dot = true,
            Content = new TextBlock { Text = indicator.Text, FontSize = ChipFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, indicator.AutomationName);
        return badge;
    }

    // ── Freshness row (stale / offline chip + refresh) ──────────────────────────────────────────────────

    private StackPanel BuildFreshnessRow(bool offline)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ChipGap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        string chipText = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var chip = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = new TextBlock { Text = chipText, FontSize = ChipFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(chip, chipText);
        row.Children.Add(chip);
        row.Children.Add(BuildRefreshButton());
        return row;
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

    // ── State surfaces (loading / error / empty) ────────────────────────────────────────────────────────

    private ChipWrapPanel BuildLoading()
    {
        var strip = new ChipWrapPanel
        {
            HorizontalSpacing = ChipGap,
            VerticalSpacing = ChipGap,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(strip, _viewModel.LoadingMessage);

        foreach (double width in SkeletonChipWidths)
        {
            strip.Children.Add(new TsSkeleton
            {
                BlockWidth = width,
                BlockHeight = SkeletonChipHeight,
                Radius = SkeletonChipRadius,
                ReduceMotion = MotionPreference.ReduceMotion,
            });
        }

        return strip;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? LiveStateIndicatorsRegistration.ErrorMessage(_localizer),
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

    /// <summary>
    /// A minimal flow panel that lays its children out left-to-right and wraps to a new row when the next child
    /// would overflow the available width — the native analogue of the web <c>flex flex-wrap gap-2</c> chip row.
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
