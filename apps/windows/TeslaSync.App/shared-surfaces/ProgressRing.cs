using System.ComponentModel;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 ProgressRing surface (the <see cref="TsProgressRing"/> control) — a parity port of
/// <c>web/src/components/data-display/ProgressRing.tsx</c>. The class is <c>Ts</c>-prefixed (the repo's
/// convention for native controls that would otherwise collide with a WinUI built-in — here
/// <c>Microsoft.UI.Xaml.Controls.ProgressRing</c>, the indeterminate spinner); the surface, slug, automation id
/// and state-holder all remain <c>ProgressRing</c>. The web component is a pure presentational gauge: an
/// SVG with a full background <c>&lt;circle&gt;</c> track and a stroke-dash value arc swept <c>value / max</c>
/// from 12 o'clock, an optional centred main / sub readout overlaid in the middle, and an optional caption
/// beneath. This surface reproduces that with a <see cref="Canvas"/> carrying a token-stroked
/// <see cref="Ellipse"/> track plus a rounded-cap arc <c>Path</c> (the shared
/// <see cref="ChartGeometry.RingArc(PointD, double, double, double)"/> geometry, 12 o'clock / clockwise), a
/// centred <see cref="StackPanel"/> of two tabular-figure <see cref="TextBlock"/>s for the readout, and a caption
/// <see cref="TextBlock"/> below. All geometry and every render branch are decided by the UI-thread-free
/// <see cref="ProgressRingViewModel"/> + <see cref="ProgressRingProjection"/>, so this view is a thin renderer.
/// The arc tints from the W1 palette via the projection's <see cref="ChartRole"/> / colour index (the web
/// <c>color</c> hex replaced by tokens, ADR-009), so it stays theme-aware. The ring always renders (track plus
/// the swept arc), even at value 0, so the surface is never a blank box. Because the component reads no network
/// data (its only inputs are caller-supplied props), there is no loading / error / stale / offline chrome; the
/// reproduced branches are the with/without centred main readout, the with/without centred sub readout, and the
/// with/without caption, across the value-clamp range. It carries no motion, so it is inherently
/// reduced-motion-safe, and the text honours the system text-scale factor. The centre overlay is decorative
/// (web <c>aria-hidden</c>): the meaningful readout is the surface's accessible name via a Text automation peer,
/// so Narrator announces the value rather than traversing the inner glyphs. The <c>view.opened</c> diagnostic is
/// emitted exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class TsProgressRing : ContentControl
{
    private const double CaptionFontSize = 12.0;
    private const int SubLabelTracking = 50;

    private readonly ProgressRingViewModel _viewModel;
    private readonly ProgressRingDiagnostics _diagnostics;
    private readonly Canvas _canvas = new();
    private readonly Grid _ring = new();
    private readonly StackPanel _centerPanel;
    private readonly TextBlock _main;
    private readonly TextBlock _sub;
    private readonly TextBlock _caption;
    private bool _opened;

    /// <summary>
    /// Creates an empty ring at value 0 with the web prop defaults (the parameterless host / designer entry
    /// point). Set <see cref="Value"/> / <see cref="CenterLabel"/> etc. to populate it.
    /// </summary>
    public TsProgressRing()
        : this(new ProgressRingViewModel(0), diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the ring over the web props. The arc colour is expressed as a token-driven
    /// <paramref name="role"/> / <paramref name="colorIndex"/> rather than the web <c>color</c> hex.
    /// </summary>
    /// <param name="value">The value the arc represents (web <c>value</c>).</param>
    /// <param name="max">The full-sweep maximum (web <c>max</c>).</param>
    /// <param name="size">The ring diameter in pixels (web <c>size</c>).</param>
    /// <param name="strokeWidth">The arc stroke width in pixels (web <c>strokeWidth</c>).</param>
    /// <param name="centerLabel">The centred primary readout (web <c>centerLabel</c>), or null for none.</param>
    /// <param name="centerSubLabel">The centred secondary readout (web <c>centerSubLabel</c>), or null for none.</param>
    /// <param name="label">The caption rendered beneath the ring (web <c>label</c>), or null for none.</param>
    /// <param name="role">The semantic role tinting the value arc (token-driven).</param>
    /// <param name="colorIndex">The categorical palette index tinting the arc when <paramref name="role"/> is None.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TsProgressRing(
        double value,
        double max = ProgressRingRegistration.DefaultMax,
        double size = ProgressRingRegistration.DefaultSize,
        double strokeWidth = ProgressRingRegistration.DefaultStrokeWidth,
        string? centerLabel = null,
        string? centerSubLabel = null,
        string? label = null,
        ChartRole role = ChartRole.None,
        int colorIndex = ProgressRingRegistration.DefaultColorIndex,
        ProgressRingDiagnostics? diagnostics = null)
        : this(
            new ProgressRingViewModel(value, max, size, strokeWidth, centerLabel, centerSubLabel, label, role, colorIndex),
            diagnostics)
    {
    }

    /// <summary>Creates the ring over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TsProgressRing(ProgressRingViewModel viewModel, ProgressRingDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ProgressRingDiagnostics();

        _main = new TextBlock
        {
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        // web tabular-nums: keep digit columns from shifting as the readout updates.
        Typography.SetNumeralAlignment(_main, FontNumeralAlignment.Tabular);

        _sub = new TextBlock
        {
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,

            // web tracking-wide; the casing is left to the already-localized caller (a forced upper-case
            // transform is not safe across every locale), so only the letter-spacing is mirrored here.
            CharacterSpacing = SubLabelTracking,
        };

        _centerPanel = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _centerPanel.Children.Add(_main);
        _centerPanel.Children.Add(_sub);

        _ring.Children.Add(_canvas);
        _ring.Children.Add(_centerPanel);

        _caption = new TextBlock
        {
            FontSize = CaptionFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        var root = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        root.Children.Add(_ring);
        root.Children.Add(_caption);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Center;
        VerticalContentAlignment = VerticalAlignment.Center;
        Content = root;

        // The centre overlay and caption are decorative (web aria-hidden); the composed readout below is the
        // single meaningful accessible name surfaced on the control.
        AutomationProperties.SetAccessibilityView(_main, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_sub, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_caption, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, ProgressRingRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>ProgressRing</c>).</summary>
    public static string Slug => ProgressRingRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ProgressRingViewModel ViewModel => _viewModel;

    /// <summary>The value the arc represents (web <c>value</c>); assigning re-projects and re-renders.</summary>
    public double Value
    {
        get => _viewModel.Value;
        set => _viewModel.Value = value;
    }

    /// <summary>The centred primary readout (web <c>centerLabel</c>); assigning re-projects and re-renders.</summary>
    public string? CenterLabel
    {
        get => _viewModel.CenterLabel;
        set => _viewModel.CenterLabel = value;
    }

    /// <summary>The centred secondary readout (web <c>centerSubLabel</c>); assigning re-projects and re-renders.</summary>
    public string? CenterSubLabel
    {
        get => _viewModel.CenterSubLabel;
        set => _viewModel.CenterSubLabel = value;
    }

    /// <summary>The caption rendered beneath the ring (web <c>label</c>); assigning re-projects and re-renders.</summary>
    public string? Label
    {
        get => _viewModel.Label;
        set => _viewModel.Label = value;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RingAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ProgressRingViewModel.Projection))
        {
            Render();
        }
    }

    private void Render()
    {
        var projection = _viewModel.Projection;

        _ring.Width = projection.Size;
        _ring.Height = projection.Size;
        _canvas.Width = projection.Size;
        _canvas.Height = projection.Size;
        _canvas.Children.Clear();
        _canvas.Children.Add(BuildTrack(projection));

        var arc = BuildArc(projection);
        if (arc is not null)
        {
            _canvas.Children.Add(arc);
        }

        _main.FontSize = projection.MainFontSize;
        _main.Text = projection.CenterLabel;
        _main.Visibility = projection.HasCenterLabel ? Visibility.Visible : Visibility.Collapsed;

        _sub.FontSize = projection.SubFontSize;
        _sub.Text = projection.CenterSubLabel;
        _sub.Visibility = projection.HasCenterSubLabel ? Visibility.Visible : Visibility.Collapsed;

        _centerPanel.Visibility = projection.HasCenter ? Visibility.Visible : Visibility.Collapsed;

        _caption.Text = projection.Label;
        _caption.Visibility = projection.HasLabel ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, projection.AutomationName);
    }

    private static Ellipse BuildTrack(ProgressRingProjection projection)
    {
        // web background <circle>: a full, untrimmed ring stroked in the themed hairline brush.
        var diameter = projection.Radius * 2.0;
        var track = new Ellipse
        {
            Width = diameter,
            Height = diameter,
            Stroke = ChartBrushes.Border,
            StrokeThickness = projection.StrokeWidth,
        };

        Canvas.SetLeft(track, projection.Center - projection.Radius);
        Canvas.SetTop(track, projection.Center - projection.Radius);
        return track;
    }

    private static Microsoft.UI.Xaml.Shapes.Path? BuildArc(ProgressRingProjection projection)
    {
        if (projection.Fraction <= 0 || projection.Radius <= 0)
        {
            return null;
        }

        // A full sweep is drawn at 0.9999 so the single arc segment never degenerates to a zero-length path
        // (start == end at exactly 1.0); visually it still reads as a complete ring.
        var drawFraction = Math.Min(projection.Fraction, 0.9999);
        var center = new PointD(projection.Center, projection.Center);
        var brush = projection.Role != ChartRole.None
            ? ChartBrushes.Resolve(ChartPalette.KeyForRole(projection.Role))
            : ChartBrushes.ForIndex(projection.ColorIndex);

        return ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, projection.Radius, drawFraction),
            brush,
            projection.StrokeWidth);
    }

    private sealed class RingAutomationPeer : FrameworkElementAutomationPeer
    {
        public RingAutomationPeer(TsProgressRing owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TsProgressRing)Owner).ViewModel.Projection.AutomationName
                : name;
        }
    }
}
