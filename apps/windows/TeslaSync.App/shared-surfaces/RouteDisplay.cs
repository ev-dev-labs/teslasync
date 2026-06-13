using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.RouteDisplaySurface;

/// <summary>
/// The native WinUI 3 <c>RouteDisplay</c> shared surface — a parity port of
/// <c>web/src/components/data-display/RouteDisplay.tsx</c>. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>start</c> / <c>end</c> / <c>roundTripThresholdM</c> / <c>showIcon</c> props)
/// and it renders the web layout — an inline row (<c>flex items-center gap-1 truncate</c>) of an optional
/// leading map-pin <see cref="FontIcon"/> followed by the resolved "from → to" / "↻ round trip" / single-location
/// / "No location data" line. The view never performs HTTP; the endpoint labelling, haversine distance and
/// round-trip detection all happen in the WinUI-free <see cref="RouteLogic"/> + <see cref="RouteDisplayProjection"/>,
/// which also pre-derive the ordered text runs and each run's muted flag. The colour mirrors the web split: the
/// row text is the ambient secondary foreground (web <c>text-[var(--text-secondary)]</c>) while the de-emphasised
/// parts — the leading icon, the "No location data" line and the trailing "↻ round trip" note (all web
/// <c>opacity-60</c>) — use the muted text token. The decorative icon is hidden from Narrator and the surface
/// carries the line's text content as its accessible name (the web element has no explicit <c>aria-label</c>, so
/// its accessible name is exactly that text), so the screen reader reads the route rather than the glyph. Because
/// the web component is synchronous and prop-driven (its parent history row owns any data fetching), it has no
/// loading / error / stale / offline chrome — only the three resolved branches (no-location, round-trip,
/// point-to-point), all of which always render — so this surface reproduces those branches and never hides
/// itself. The web <c>truncate</c> single-line ellipsis is reproduced with character trimming; the value,
/// composition, emphasis split and accessible name are all reproduced.
/// </summary>
public sealed partial class RouteDisplay : ContentControl
{
    private const double IconFontSize = 10;   // web `h-2.5 w-2.5`
    private const double TextFontSize = 11;    // web `text-[11px]`
    private const double RowSpacing = 4;       // web `gap-1`

    private readonly ILocalizer _localizer;
    private readonly RouteDisplayDiagnostics _diagnostics;

    private RouteDisplayModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the route strings resolve through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="RouteDisplayModel.None"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RouteDisplay(
        ILocalizer localizer,
        RouteDisplayModel? model = null,
        RouteDisplayDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? RouteDisplayModel.None;
        _diagnostics = diagnostics ?? new RouteDisplayDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>RouteDisplay</c>).</summary>
    public static string Slug => RouteDisplayRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public RouteDisplayModel Model
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
        RouteDisplayDisplay display = RouteDisplayProjection.Project(_model, _localizer);
        Brush secondary = DisplayTokens.TextSecondary;
        Brush muted = DisplayTokens.TextMuted;

        // Web `flex items-center gap-1 truncate`: a horizontal row, vertically centred, with a 4px gap.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (display.ShowIcon)
        {
            // Web leading MapPin: `h-2.5 w-2.5 shrink-0 opacity-60` — muted (the web opacity-60 over the
            // secondary row colour maps to the muted text token).
            var icon = new FontIcon
            {
                Glyph = display.IconGlyph,
                FontSize = IconFontSize,
                Foreground = muted,
                VerticalAlignment = VerticalAlignment.Center,
            };

            // Decorative (web `aria-hidden`) — the surface's accessible name already carries the line text.
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            row.Children.Add(icon);
        }

        // Web body span: `truncate` (single-line ellipsis). Each run carries the secondary foreground, except
        // the muted runs (the no-location text and the round-trip note) which use the muted token.
        var text = new TextBlock
        {
            Foreground = secondary,
            FontSize = TextFontSize,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        foreach (RouteDisplaySegment segment in display.Segments)
        {
            text.Inlines.Add(new Run
            {
                Text = segment.Text,
                Foreground = segment.Muted ? muted : secondary,
            });
        }

        // The web element exposes no separate aria-label, so the line's text content is its accessible name;
        // marking the runs Raw keeps Narrator reading only the single composed name set on this surface.
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        row.Children.Add(text);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = row;
    }
}
