using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>LiveStatusPill</c> feature surface — a parity port of
/// web/src/features/system/components/status/LiveStatusPill.tsx. It is a pure presentational control mounted
/// next to the /system-status Refresh button: assign a <see cref="Model"/> (the web <c>state</c> /
/// <c>lastUpdateAt</c> props) and it renders the web fragment — a tokenized rounded pill ringed in the state's
/// accent colour holding a state-coloured status dot (web <c>h-2 w-2 rounded-full</c>), the Segoe Fluent glyph
/// standing in for the web Lucide icon (Activity / Wifi / WifiOff), the bold state label, a muted middle dot
/// and the muted relative "updated" age. The dot pulses only while reconnecting and only when motion is
/// allowed (web <c>animate-pulse</c>, gated by <see cref="ReduceMotion"/>). The view never performs HTTP; the
/// tier colour, glyph, pulse flag, label and relative-time formatting all happen in the WinUI-free
/// <see cref="LiveStatusPillProjection"/>. Every accent brush is the generated design token for the tier (so
/// light / dark / high-contrast all flow from the token set), the decorative dot / icon / separator subtree is
/// hidden from Narrator, and the control carries the composed <c>aria-label</c> as its Narrator name with a
/// polite live-region setting (web <c>role="status" aria-live="polite"</c>). The relative label advances when
/// the host re-renders the surface via <see cref="Refresh"/> or <see cref="Update"/> — the native analogue of
/// the web parent passing a ticking <c>now</c> prop.
/// </summary>
public sealed partial class LiveStatusPill : ContentControl
{
    private const double DotSize = 8;          // web `h-2 w-2`
    private const double IconFontSize = 14;    // web `h-3.5 w-3.5`
    private const double LabelFontSize = 12;   // web `text-xs`
    private const double RowSpacing = 6;       // web `gap-1.5`
    private const double PillPaddingX = 10;    // web `px-2.5`
    private const double PillPaddingY = 4;     // web `py-1`

    /// <summary>When true, suppress the reconnecting pulse (system / accessibility reduced-motion setting).</summary>
    public static readonly DependencyProperty ReduceMotionProperty = DependencyProperty.Register(
        nameof(ReduceMotion), typeof(bool), typeof(LiveStatusPill),
        new PropertyMetadata(false, OnReduceMotionChanged));

    private readonly ILocalizer _localizer;
    private readonly LiveStatusPillDiagnostics _diagnostics;

    private LiveStatusPillModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its localizer, an initial model and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade resolving the label, "just now"/"ago" and the aria-label template.</param>
    /// <param name="model">The initial render model; defaults to <see cref="LiveStatusPillModel.Connecting"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveStatusPill(
        ILocalizer localizer,
        LiveStatusPillModel? model = null,
        LiveStatusPillDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _model = model ?? LiveStatusPillModel.Connecting;
        _diagnostics = diagnostics ?? new LiveStatusPillDiagnostics();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        // web `role="status" aria-live="polite"`: a polite live region whose Narrator name is the aria-label.
        AutomationProperties.SetLiveSetting(this, AutomationLiveSetting.Polite);
        AutomationProperties.SetAutomationId(this, LiveStatusPillRegistration.Slug);

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LiveStatusPill</c>).</summary>
    public static string Slug => LiveStatusPillRegistration.Slug;

    /// <summary>The render model (state / last-update); reassigning re-projects and re-renders the surface.</summary>
    public LiveStatusPillModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>Whether the reconnecting pulse is suppressed (reduced-motion).</summary>
    public bool ReduceMotion
    {
        get => (bool)GetValue(ReduceMotionProperty);
        set => SetValue(ReduceMotionProperty, value);
    }

    /// <summary>Set the connection state and last-update timestamp in one step, then re-render.</summary>
    /// <param name="state">The live-pipeline connection state (web <c>state</c>).</param>
    /// <param name="lastUpdateAt">When the last snapshot landed, or null (web <c>lastUpdateAt</c>).</param>
    public void Update(StatusLiveState state, DateTimeOffset? lastUpdateAt)
    {
        _model = new LiveStatusPillModel(state, lastUpdateAt);
        Render();
    }

    /// <summary>Re-project against the current clock so the relative "updated" label advances (web <c>now</c> tick).</summary>
    public void Refresh() => Render();

    private static void OnReduceMotionChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((LiveStatusPill)d).Render();

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
        var display = LiveStatusPillProjection.Project(_model, _localizer, DateTimeOffset.Now);
        Brush accent = DisplayTokens.Brush(display.AccentBrushKey);
        Brush muted = DisplayTokens.TextMuted;

        // web `inline-flex items-center gap-1.5`: dot · icon · label · "·" · relative.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var dot = new Ellipse
        {
            Width = DotSize,
            Height = DotSize,
            Fill = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (display.Pulse && !ReduceMotion)
        {
            PulseHelper.Attach(dot);
        }

        row.Children.Add(dot);

        row.Children.Add(new FontIcon
        {
            Glyph = display.IconGlyph,
            FontSize = IconFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        row.Children.Add(new TextBlock
        {
            Text = display.Label,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        row.Children.Add(new TextBlock
        {
            Text = LiveStatusPillRegistration.MiddleDot,
            FontSize = LabelFontSize,
            Foreground = muted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        row.Children.Add(new TextBlock
        {
            Text = display.RelativeText,
            FontSize = LabelFontSize,
            Foreground = muted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        // web `rounded-full px-2.5 py-1 ring-1 ring-{tone}`: a pill ringed in the accent over the panel surface.
        var pill = new Border
        {
            Child = row,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = accent,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(PillPaddingX, PillPaddingY, PillPaddingX, PillPaddingY),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative subtree — the control's Narrator name (web `aria-label`) is authoritative.
        AutomationProperties.SetAccessibilityView(pill, AccessibilityView.Raw);
        AutomationProperties.SetName(this, display.AutomationName);
        Content = pill;
    }
}
