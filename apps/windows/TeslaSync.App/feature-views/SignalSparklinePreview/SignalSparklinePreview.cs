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
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 signal-sparkline preview surface — a parity port of
/// web/src/features/telemetry/components/SignalSparklinePreview.tsx. It renders the last-hour mini-trend for
/// one signal as a compact inline element and reproduces every web branch: a collapsed surface when the
/// preview is gated off (web <c>!enabled</c>), a compact <c>(kind)</c> chip for a non-numeric signal, a
/// pulsing skeleton while loading, an em-dash with the "No samples in last hour" tooltip when fewer than two
/// samples exist, and the sparkline itself otherwise — plus the native-superset stale chip, offline chip and
/// a compact retry affordance on hard failure. All data flows through the shared
/// <see cref="SignalSparklinePreviewViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and the surface carries a Narrator name for each state.
/// </summary>
public sealed partial class SignalSparklinePreview : ContentControl, IDisposable
{
    private const string ErrorGlyph = "\uE783";    // Segoe Fluent — Error
    private const string EmDash = "\u2014";
    private const double ChipFontSize = 10;
    private const double ChipSpacing = 6;
    private const double DefaultSparklineWidth = 80;  // web width default
    private const double DefaultSparklineHeight = 18; // web height default

    private readonly SignalSparklinePreviewViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SignalSparklinePreviewDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private int _colorIndex;
    private double _sparklineWidth = DefaultSparklineWidth;
    private double _sparklineHeight = DefaultSparklineHeight;

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, the vehicle id, signal, kind, enabled gate and localizer.</summary>
    public SignalSparklinePreview(
        ISignalSparklinePreviewSource source,
        long vehicleId,
        string signal,
        SignalKind valueKind,
        bool enabled,
        ILocalizer localizer,
        SignalSparklinePreviewDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrEmpty(signal);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SignalSparklinePreviewDiagnostics();
        _viewModel = new SignalSparklinePreviewViewModel(source, vehicleId, signal, valueKind, enabled, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        VerticalContentAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>signal-sparkline-preview</c>).</summary>
    public static string SurfaceId => SignalSparklinePreviewRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SignalSparklinePreviewViewModel ViewModel => _viewModel;

    /// <summary>
    /// The enabled gate (web <c>enabled</c> prop). The parent flips this on per-leaf as a category group
    /// expands; turning it on records the surface open and starts the load, turning it off collapses the
    /// surface and cancels any in-flight fetch.
    /// </summary>
    public bool Enabled
    {
        get => _viewModel.Enabled;
        set
        {
            if (_viewModel.SetEnabled(value) && value && IsLoaded)
            {
                TryStart();
            }
        }
    }

    /// <summary>Categorical palette index for the trend line (web <c>color</c> prop maps to a token brush).</summary>
    public int ColorIndex
    {
        get => _colorIndex;
        set
        {
            if (_colorIndex != value)
            {
                _colorIndex = value;
                ScheduleRender();
            }
        }
    }

    /// <summary>Sparkline width in pixels (web <c>width</c> prop, default 80).</summary>
    public double SparklineWidth
    {
        get => _sparklineWidth;
        set
        {
            if (_sparklineWidth != value)
            {
                _sparklineWidth = value;
                ScheduleRender();
            }
        }
    }

    /// <summary>Sparkline height in pixels (web <c>height</c> prop, default 18).</summary>
    public double SparklineHeight
    {
        get => _sparklineHeight;
        set
        {
            if (_sparklineHeight != value)
            {
                _sparklineHeight = value;
                ScheduleRender();
            }
        }
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SignalSparklinePreviewSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static SignalSparklinePreview Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long vehicleId,
        string signal,
        SignalKind valueKind,
        bool enabled,
        ILocalizer localizer,
        SignalSparklinePreviewDiagnostics? diagnostics = null)
    {
        var source = new SignalSparklinePreviewSource(api, engine, options);
        return new SignalSparklinePreview(source, vehicleId, signal, valueKind, enabled, localizer, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_viewModel.Enabled)
        {
            TryStart();
        }
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

    private void TryStart()
    {
        if (!_viewModel.Enabled)
        {
            return;
        }

        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        _ = _viewModel.LoadAsync();
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

    // ── Render ───────────────────────────────────────────────────────────────────────────────────────

    private void Render()
    {
        if (_viewModel.State == SignalSparklinePreviewState.Disabled)
        {
            // web: `if (!enabled) return null` — the surface contributes nothing.
            Visibility = Visibility.Collapsed;
            Content = null;
            AutomationProperties.SetName(this, string.Empty);
            return;
        }

        Visibility = Visibility.Visible;
        UIElement body = _viewModel.State switch
        {
            SignalSparklinePreviewState.NonNumeric => BuildKindChip(),
            SignalSparklinePreviewState.Loading => BuildLoading(),
            SignalSparklinePreviewState.Empty => BuildEmDash(),
            SignalSparklinePreviewState.Loaded => BuildSparkline(),
            SignalSparklinePreviewState.Stale => WithChip(BuildSparkline(), _viewModel.StaleLabel, StatusKind.Warning),
            SignalSparklinePreviewState.Offline => BuildOffline(),
            SignalSparklinePreviewState.Error => BuildError(),
            _ => BuildEmDash(),
        };

        Content = body;
        AutomationProperties.SetName(this, _viewModel.AccessibleName);
    }

    private TsBadge BuildKindChip()
    {
        // web: <span className="...uppercase tracking-wide text-muted border...">{valueKind}</span>
        var chip = new TsBadge
        {
            Status = StatusKind.Neutral,
            VerticalAlignment = VerticalAlignment.Center,
            Content = new TextBlock
            {
                Text = _viewModel.KindToken.ToUpperInvariant(),
                FontSize = ChipFontSize,
                FontWeight = FontWeights.SemiBold,
                CharacterSpacing = 40,
            },
        };
        ToolTipService.SetToolTip(chip, _viewModel.NonNumericTooltip);
        AutomationProperties.SetName(chip, _viewModel.NonNumericTooltip);
        return chip;
    }

    private TsSkeleton BuildLoading()
    {
        // web: <span aria-hidden className="animate-pulse" style={{ width, height }} />
        var skeleton = new TsSkeleton
        {
            BlockWidth = _sparklineWidth,
            BlockHeight = _sparklineHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
            VerticalAlignment = VerticalAlignment.Center,
        };
        LiveRegion.Configure(skeleton);
        LiveRegion.Announce(skeleton);
        return skeleton;
    }

    private TextBlock BuildEmDash()
    {
        // web: <span title="No samples in last hour">—</span>
        var dash = new TextBlock
        {
            Text = EmDash,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTipService.SetToolTip(dash, _viewModel.EmptyLabel);
        AutomationProperties.SetName(dash, _viewModel.EmptyLabel);
        return dash;
    }

    private TsSparkline BuildSparkline()
    {
        // web: <Sparkline data={numericSeries} color={color} width={width} height={height} />
        var sparkline = new TsSparkline
        {
            Data = _viewModel.Series,
            ColorIndex = _colorIndex,
            ChartWidth = _sparklineWidth,
            ChartHeight = _sparklineHeight,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The host carries the trend's accessible name, so keep the chart itself out of the tree to avoid a
        // duplicate, label-less announcement.
        AutomationProperties.SetAccessibilityView(sparkline, AccessibilityView.Raw);
        return sparkline;
    }

    private StackPanel BuildOffline() =>
        WithChip(
            _viewModel.HasTrend ? BuildSparkline() : BuildEmDash(),
            _viewModel.OfflineLabel,
            StatusKind.Danger);

    private TsButton BuildError()
    {
        // The web has no explicit error branch (tanstack-query keeps it loading); the native superset renders a
        // compact, Narrator-labelled retry affordance — the inline-sized equivalent of QueryError.
        var retry = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = ErrorGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        string name = $"{_viewModel.ErrorMessage ?? _viewModel.ErrorLabel}. {_viewModel.RetryLabel}";
        ToolTipService.SetToolTip(retry, name);
        AutomationProperties.SetName(retry, name);
        retry.Click += OnRetryClick;
        return retry;
    }

    private void OnRetryClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private static StackPanel WithChip(UIElement core, string label, StatusKind status)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ChipSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(core);

        var chip = new TsBadge
        {
            Status = status,
            Dot = true,
            VerticalAlignment = VerticalAlignment.Center,
            Content = new TextBlock { Text = label, FontSize = ChipFontSize },
        };

        // The host name already includes the freshness label, so the chip is decorative for assistive tech.
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
        row.Children.Add(chip);
        return row;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new SignalSparklinePreviewAutomationPeer(this);

    private sealed class SignalSparklinePreviewAutomationPeer(SignalSparklinePreview owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((SignalSparklinePreview)Owner).ViewModel.AccessibleName : name;
        }
    }
}
