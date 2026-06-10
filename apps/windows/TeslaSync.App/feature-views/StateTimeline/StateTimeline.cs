using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.StateMachine;

/// <summary>
/// The native WinUI 3 <c>StateTimeline</c> feature surface — a parity port of
/// <c>web/src/features/system/components/state-machine/StateTimeline.tsx</c>. It is a pure presentational strip:
/// assign a <see cref="Model"/> (the web pre-windowed <c>transitions</c> plus the display props) and it renders
/// exactly one of two branches inside a tokenized rounded-bordered glass surface (the web
/// <c>rounded-lg border bg-white/[0.02]</c> box) — the <see cref="StateTimelineState.Timeline"/> dot track (a
/// start / "Window: N min" / end axis above a centre hairline carrying one colour-coded, selectable, tooltip-
/// bearing dot per transition, positioned by its timestamp within the window) or the actionable
/// <see cref="StateTimelineState.Empty"/> stand-in (the localized "No transitions in window" copy, an optional
/// "Last transition {rel}" hint, and the gated "Widen window" / "Jump to last transition" buttons), never a
/// blank box. All windowing math, branch selection, colour resolution, time / relative formatting and copy
/// resolution happen in the WinUI-free <see cref="StateTimelineProjection"/>; this view only lays the result out
/// with native primitives. Selecting a dot raises <see cref="TransitionSelected"/> (web <c>onSelect</c>); the
/// hint buttons raise <see cref="WidenWindowRequested"/> / <see cref="JumpToLastRequested"/> (web
/// <c>onWidenWindow</c> / <c>onJumpToLast</c>). Every string resolves through the i18n facade, the empty state
/// is announced through a live region, and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class StateTimeline : ContentControl
{
    private const double PanelPadding = 16;        // web px-4
    private const double PanelPaddingV = 12;       // web py-3
    private const double PanelRadius = 8;          // web rounded-lg
    private const double HeaderRowSpacing = 8;     // web mb-2 between the axis row and the track
    private const double TrackHeight = 40;         // web h-10
    private const double HairlineHeight = 1;       // web h-px
    private const double DotNormal = 10;           // web h-2.5 w-2.5
    private const double DotHover = 14;            // web hover:h-3.5 w-3.5
    private const double DotSelected = 16;         // web h-4 w-4 (selected)
    private const double SelectedRingExtra = 6;    // web ring-2 around the selected dot
    private const double TouchTarget = 44;         // web touch-target-overlay hit area
    private const double AxisFontSize = 10;        // web text-[10px]
    private const double BodyFontSize = 12;        // web text-xs
    private const int AxisLetterSpacing = 80;      // web tracking-wider

    private const string PanelBackgroundKey = "TsColorSurfaceGlassBrush"; // web bg-white/[0.02]
    private const string SelectedRingKey = "TsColorTextPrimaryBrush";     // web border-strong / ring-white

    private readonly ILocalizer _localizer;
    private readonly StateTimelineDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private StateTimelineModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, diagnostics and clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="StateTimelineModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock backing the live "now" anchor + relative hint; defaults to system time.</param>
    public StateTimeline(
        ILocalizer localizer,
        StateTimelineModel? model = null,
        StateTimelineDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? StateTimelineModel.Empty;
        _diagnostics = diagnostics ?? new StateTimelineDiagnostics();
        _clock = clock ?? (static () => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when a tick is activated — carries the selected transition id (web <c>onSelect</c>).</summary>
    public event EventHandler<long>? TransitionSelected;

    /// <summary>Raised when the "Widen window" button is invoked (web <c>onWidenWindow</c>).</summary>
    public event EventHandler? WidenWindowRequested;

    /// <summary>Raised when the "Jump to last transition" button is invoked (web <c>onJumpToLast</c>).</summary>
    public event EventHandler? JumpToLastRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>StateTimeline</c>).</summary>
    public static string Slug => StateTimelineRegistration.Slug;

    /// <summary>The render model (the web props); reassigning re-projects and re-renders the surface.</summary>
    public StateTimelineModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
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

    private void Render()
    {
        var display = StateTimelineProjection.Project(_model, _localizer, _clock());

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State == StateTimelineState.Empty
            ? BuildEmpty(display)
            : BuildTimeline(display);
    }

    // ── Empty (no ticks in window — friendly, actionable stand-in) ────────────────────────────────────────
    private Border BuildEmpty(StateTimelineDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var text = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            FontSize = BodyFontSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        text.Inlines.Add(new Run { Text = display.EmptyMessage, Foreground = DisplayTokens.TextMuted });
        if (display.HasHint)
        {
            text.Inlines.Add(new Run { Text = "  \u00B7  ", Foreground = DisplayTokens.TextMuted });
            text.Inlines.Add(new Run { Text = display.LastSeenText, Foreground = DisplayTokens.TextSecondary });
        }

        Grid.SetColumn(text, 0);
        grid.Children.Add(text);

        if (display.HasHint && (display.ShowWiden || display.ShowJump))
        {
            var actions = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
            };

            if (display.ShowWiden)
            {
                var widen = new TsButton
                {
                    Variant = ButtonVariant.Primary,
                    Size = ControlSize.Small,
                    Text = display.WidenText,
                };
                AutomationProperties.SetAutomationId(widen, "state-timeline-widen");
                widen.Click += (_, _) => WidenWindowRequested?.Invoke(this, EventArgs.Empty);
                actions.Children.Add(widen);
            }

            if (display.ShowJump)
            {
                var jump = new TsButton
                {
                    Variant = ButtonVariant.Subtle,
                    Size = ControlSize.Small,
                    Text = display.JumpText,
                };
                AutomationProperties.SetAutomationId(jump, "state-timeline-jump");
                jump.Click += (_, _) => JumpToLastRequested?.Invoke(this, EventArgs.Empty);
                actions.Children.Add(jump);
            }

            Grid.SetColumn(actions, 1);
            grid.Children.Add(actions);
        }

        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);

        var panel = BuildPanel(grid);
        AutomationProperties.SetAutomationId(panel, "state-timeline-empty");
        return panel;
    }

    // ── Timeline (dot track) ──────────────────────────────────────────────────────────────────────────────
    private Border BuildTimeline(StateTimelineDisplay display)
    {
        var column = new StackPanel { Spacing = HeaderRowSpacing };
        column.Children.Add(BuildAxis(display));
        column.Children.Add(BuildTrack(display));

        var panel = BuildPanel(column);
        AutomationProperties.SetAutomationId(panel, "state-timeline");
        return panel;
    }

    private static Grid BuildAxis(StateTimelineDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var start = AxisLabel(display.StartText, HorizontalAlignment.Left);
        var window = AxisLabel(display.WindowLabel, HorizontalAlignment.Center);
        var end = AxisLabel(display.EndText, HorizontalAlignment.Right);

        // The dots carry the per-transition detail; the axis labels are decorative chrome for Narrator.
        AutomationProperties.SetAccessibilityView(start, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(window, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(end, AccessibilityView.Raw);

        Grid.SetColumn(start, 0);
        Grid.SetColumn(window, 1);
        Grid.SetColumn(end, 2);
        grid.Children.Add(start);
        grid.Children.Add(window);
        grid.Children.Add(end);
        return grid;
    }

    private Grid BuildTrack(StateTimelineDisplay display)
    {
        var track = new Grid { Height = TrackHeight };

        var hairline = new Border
        {
            Height = HairlineHeight,
            Background = DisplayTokens.Border,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        track.Children.Add(hairline);

        var canvas = new Canvas { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
        var placed = new List<(StateTimelineTick Tick, FrameworkElement Element)>(display.Ticks.Count);
        foreach (var tick in display.Ticks)
        {
            var element = BuildTick(tick);
            placed.Add((tick, element));
            canvas.Children.Add(element);
        }

        canvas.SizeChanged += (_, _) => PositionTicks(canvas, placed);
        track.Children.Add(canvas);
        return track;
    }

    private static void PositionTicks(Canvas canvas, List<(StateTimelineTick Tick, FrameworkElement Element)> placed)
    {
        double width = canvas.ActualWidth;
        double height = canvas.ActualHeight;
        if (width <= 0)
        {
            return;
        }

        foreach (var (tick, element) in placed)
        {
            double x = tick.LeftPercent / 100.0 * width;
            Canvas.SetLeft(element, x - (TouchTarget / 2));
            Canvas.SetTop(element, (height / 2) - (TouchTarget / 2));
        }
    }

    private TsTooltip BuildTick(StateTimelineTick tick)
    {
        double dotSize = tick.IsSelected ? DotSelected : DotNormal;
        var dot = new Ellipse
        {
            Width = dotSize,
            Height = dotSize,
            Fill = DisplayTokens.Brush(tick.DotColorKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        FrameworkElement visual = dot;
        if (tick.IsSelected)
        {
            var ring = new Ellipse
            {
                Width = dotSize + SelectedRingExtra,
                Height = dotSize + SelectedRingExtra,
                Stroke = DisplayTokens.Brush(SelectedRingKey),
                StrokeThickness = 2,
                Fill = Transparent(),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var stack = new Grid();
            stack.Children.Add(ring);
            stack.Children.Add(dot);
            visual = stack;
        }

        var button = new Button
        {
            Background = Transparent(),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            MinWidth = 0,
            MinHeight = 0,
            Width = TouchTarget,
            Height = TouchTarget,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Content = visual,
        };
        AutomationProperties.SetName(button, tick.AutomationName);
        AutomationProperties.SetAutomationId(button, string.Create(CultureInfo.InvariantCulture, $"state-timeline-tick-{tick.Id}"));
        button.Click += (_, _) => TransitionSelected?.Invoke(this, tick.Id);

        if (!tick.IsSelected)
        {
            // Web hover:h-3.5 w-3.5 — the dot grows slightly on pointer-over.
            button.PointerEntered += (_, _) =>
            {
                dot.Width = DotHover;
                dot.Height = DotHover;
            };
            button.PointerExited += (_, _) =>
            {
                dot.Width = DotNormal;
                dot.Height = DotNormal;
            };
        }

        return new TsTooltip { Hint = tick.TooltipText, Content = button };
    }

    private static TextBlock AxisLabel(string text, HorizontalAlignment alignment) => new()
    {
        Text = text.ToUpper(CultureInfo.CurrentCulture),
        FontSize = AxisFontSize,
        Foreground = DisplayTokens.TextMuted,
        CharacterSpacing = AxisLetterSpacing,
        HorizontalAlignment = alignment,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Border BuildPanel(UIElement content) => new()
    {
        Child = content,
        Background = DisplayTokens.Brush(PanelBackgroundKey),
        BorderBrush = DisplayTokens.Border,
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(PanelRadius),
        Padding = new Thickness(PanelPadding, PanelPaddingV, PanelPadding, PanelPaddingV),
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);

    protected override AutomationPeer OnCreateAutomationPeer() => new StateTimelineAutomationPeer(this);

    private sealed class StateTimelineAutomationPeer(StateTimeline owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
