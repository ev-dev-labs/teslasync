using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>LiveTelemetryPanels</c> feature surface — a parity port of
/// web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx. It reproduces the web
/// composition: the "Live Telemetry" section header (the pulsing green live dot + title, web <c>FadeIn
/// delay={0.12}</c>) above a responsive one- / two-column grid (web <c>grid-cols-1 lg:grid-cols-2</c>) of the
/// seven child panels — Powertrain, Climate, Security, Vehicle State, Tire Pressure, Energy &amp; Charging and
/// Media &amp; Navigation — each entering with the web's exact staggered <c>FadeIn</c> delay (0.14 → 0.24).
/// The seven children are separate surfaces (their own prompts); the host injects each via
/// <see cref="SetPanel"/>, and until one is supplied the slot shows its loading skeleton, mirroring the web
/// child's own <c>{data ? … : skeleton}</c> gate. The surface owns the live-connection lifecycle the web
/// received via <c>sseConnected</c>: the header indicator and the loading / loaded / empty / error / stale /
/// offline states all flow from the <see cref="Model"/>. The view never performs HTTP and never converts
/// units; all branch selection and label resolution happen in the WinUI-free
/// <see cref="LiveTelemetryPanelsProjection"/>. Skeleton shimmer and the live-dot pulse honour reduce-motion,
/// every string resolves through the i18n facade and the surface, each slot and the retry affordance carry a
/// Narrator name.
/// </summary>
public sealed partial class LiveTelemetryPanels : ContentControl
{
    private const double SectionSpacing = 24;   // web header → grid gap (space-y / mt-2 + grid gap-6)
    private const double GridGap = 24;           // web grid gap-6
    private const double PanelPadding = 16;      // child glass panel p-4/p-6
    private const double HeaderSpacing = 12;     // web header gap-3
    private const double PanelHeaderSpacing = 8; // web section-title gap-2
    private const double SkeletonRowSpacing = 10;
    private const double SkeletonRowHeight = 18;
    private const int SkeletonRowCount = 4;
    private const double LiveDotSize = 10;       // web h-3 w-3 indicator
    private const double SectionGlyphSize = 16;  // web h-4 w-4
    private const double TwoColumnMinWidth = 1024; // web lg: breakpoint

    private readonly ILocalizer _localizer;
    private readonly LiveTelemetryPanelsDiagnostics _diagnostics;
    private readonly Dictionary<TelemetryPanelSlot, FrameworkElement> _panels = new();
    private readonly List<ContentControl> _injectedHosts = new();

    private LiveTelemetryPanelsModel _model;
    private Storyboard? _pulse;
    private bool _opened;
    private int _columns = 2;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="LiveTelemetryPanelsModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveTelemetryPanels(
        ILocalizer localizer,
        LiveTelemetryPanelsModel? model = null,
        LiveTelemetryPanelsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? LiveTelemetryPanelsModel.Pending;
        _diagnostics = diagnostics ?? new LiveTelemetryPanelsDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs its live load).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LiveTelemetryPanels</c>).</summary>
    public static string Slug => LiveTelemetryPanelsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public LiveTelemetryPanelsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>
    /// Inject (or clear) the child surface hosted in <paramref name="slot"/> — the host wires each of the
    /// seven composed panels (their own prompts) here. A null <paramref name="content"/> clears the slot back
    /// to its loading skeleton. Re-renders so the grid reflects the change.
    /// </summary>
    /// <param name="slot">The panel slot to populate.</param>
    /// <param name="content">The child surface to host, or null to show the loading skeleton.</param>
    public void SetPanel(TelemetryPanelSlot slot, FrameworkElement? content)
    {
        if (content is null)
        {
            _panels.Remove(slot);
        }
        else
        {
            _panels[slot] = content;
        }

        Render();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int desired = e.NewSize.Width >= TwoColumnMinWidth ? 2 : 1;
        if (desired != _columns)
        {
            _columns = desired;
            Render();
        }
    }

    private void Render()
    {
        StopPulse();
        DetachInjectedPanels();

        LiveTelemetryPanelsDisplay display = LiveTelemetryPanelsProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        var root = new StackPanel { Spacing = SectionSpacing };
        root.Children.Add(BuildHeader(display));

        if (display.ShowGrid)
        {
            root.Children.Add(BuildGrid(display));
        }
        else if (display.State == LiveTelemetryPanelsState.Error)
        {
            root.Children.Add(BuildError(display));
        }
        else
        {
            root.Children.Add(BuildEmpty(display));
        }

        Content = root;
    }

    // ── Section header (web pulsing live dot + "Live Telemetry") ────────────────────────────────────────

    private TsFadeIn BuildHeader(LiveTelemetryPanelsDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(BuildLiveDot(display.Indicator));
        row.Children.Add(new SectionTitle
        {
            Value = display.Title,
            VerticalAlignment = VerticalAlignment.Center,
        });

        if (display.Indicator.ShowChip)
        {
            row.Children.Add(BuildFreshnessChip(display.Indicator));
        }

        return new TsFadeIn { DelayMs = display.HeaderDelayMs, Content = row };
    }

    private Ellipse BuildLiveDot(LiveIndicatorDisplay indicator)
    {
        var dot = new Ellipse
        {
            Width = LiveDotSize,
            Height = LiveDotSize,
            Fill = ToneBrush(indicator.Tone),
            VerticalAlignment = VerticalAlignment.Center,
        };

        bool announce = indicator.Kind is LiveIndicatorKind.Live or LiveIndicatorKind.Connecting
            && !string.IsNullOrEmpty(indicator.Text);
        if (announce)
        {
            AutomationProperties.SetName(dot, indicator.Text);
        }
        else
        {
            AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
        }

        if (indicator.Pulsing && !MotionPreference.ReduceMotion)
        {
            StartPulse(dot);
        }

        return dot;
    }

    private static TsBadge BuildFreshnessChip(LiveIndicatorDisplay indicator)
    {
        var badge = new TsBadge
        {
            Status = indicator.Tone,
            Content = new TextBlock { Text = indicator.Text, FontSize = CaptionFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, indicator.Text);
        return badge;
    }

    // ── Panel grid (web grid-cols-1 lg:grid-cols-2 with staggered FadeIn) ───────────────────────────────

    private Grid BuildGrid(LiveTelemetryPanelsDisplay display)
    {
        var grid = new Grid
        {
            ColumnSpacing = GridGap,
            RowSpacing = GridGap,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        int columns = _columns < 1 ? 1 : _columns;
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (display.Panels.Count + columns - 1) / columns;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Panels.Count; i++)
        {
            TelemetryPanelSlotDisplay slot = display.Panels[i];
            var cell = new TsFadeIn
            {
                DelayMs = slot.FadeInDelayMs,
                VerticalAlignment = VerticalAlignment.Top,
            };
            cell.Content = BuildSlot(slot, cell);
            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private FrameworkElement BuildSlot(TelemetryPanelSlotDisplay slot, ContentControl host)
    {
        if (_panels.TryGetValue(slot.Slot, out FrameworkElement? child) && child is not null)
        {
            // The host-supplied child surface persists across re-renders; record its wrapper so the next
            // render detaches it before re-parenting (WinUI forbids an element having two parents).
            _injectedHosts.Add(host);
            child.VerticalAlignment = VerticalAlignment.Top;
            return child;
        }

        return BuildSlotSkeleton(slot);
    }

    private void DetachInjectedPanels()
    {
        foreach (ContentControl host in _injectedHosts)
        {
            host.Content = null;
        }

        _injectedHosts.Clear();
    }

    private static TsGlassPanel BuildSlotSkeleton(TelemetryPanelSlotDisplay slot)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildPanelHeader(slot.Title, slot.Glyph));

        var rows = new StackPanel { Spacing = SkeletonRowSpacing };
        for (int i = 0; i < SkeletonRowCount; i++)
        {
            rows.Children.Add(new TsSkeleton
            {
                BlockWidth = double.NaN,
                BlockHeight = SkeletonRowHeight,
                Radius = 8,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        LiveRegion.Configure(rows);
        LiveRegion.Announce(rows);
        column.Children.Add(rows);

        var glass = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(glass, slot.LoadingAutomationName);
        return glass;
    }

    private static StackPanel BuildPanelHeader(string title, string glyph)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = PanelHeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = SectionGlyphSize,
            Foreground = DisplayTokens.Brush("TsChartSpeedBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        header.Children.Add(icon);
        header.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        return header;
    }

    // ── State surfaces (empty / error) ──────────────────────────────────────────────────────────────────

    private static TsEmptyState BuildEmpty(LiveTelemetryPanelsDisplay display) => new()
    {
        IconGlyph = "\uE9D9",
        Message = display.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsQueryError BuildError(LiveTelemetryPanelsDisplay display)
    {
        var error = new TsQueryError
        {
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // ── Live-dot pulse (web animate-ping, reduce-motion safe) ───────────────────────────────────────────

    private void StartPulse(Shape dot)
    {
        var anim = new DoubleAnimation
        {
            From = 1.0,
            To = 0.25,
            Duration = new Duration(TimeSpan.FromMilliseconds(900)),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(anim, dot);
        Storyboard.SetTargetProperty(anim, "Opacity");

        var storyboard = new Storyboard();
        storyboard.Children.Add(anim);
        storyboard.Begin();
        _pulse = storyboard;
    }

    private void StopPulse()
    {
        _pulse?.Stop();
        _pulse = null;
    }

    private static Brush ToneBrush(StatusKind tone) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(tone));

    private static double CaptionFontSize => TypographyTokens.Size("TsTypeCaptionFontSize", 12);
}
