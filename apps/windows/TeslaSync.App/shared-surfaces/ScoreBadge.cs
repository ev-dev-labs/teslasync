using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.ScoreBadgeSurface;

/// <summary>
/// The native WinUI 3 <c>ScoreBadge</c> shared surface — a parity port of
/// <c>web/src/components/data-display/ScoreBadge.tsx</c>. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>score</c> / <c>grade</c> / <c>size</c> / <c>ariaLabel</c> / <c>testId</c>
/// props) and it renders the web layout — a single bold, palette-coloured letter grade (A+ / A / B / C / D / F /
/// —). The letter IS the badge, with no extra "SCORE" sub-label, exactly as the web source. The view never
/// performs HTTP; the grade resolution, the shared-palette colour, the parity font size and the
/// <c>aria-label</c> interpolation all happen in the WinUI-free <see cref="ScoreBadgeProjection"/>. Because the
/// web component is synchronous and prop-driven (its parent row / header owns any data fetching), it has no
/// loading / error / stale / offline chrome — only the graded branch and the no-data branch (the muted "—"),
/// both of which always render — so this surface reproduces those two branches and never hides itself. The
/// grade colour is rendered via <see cref="DisplayPrimitives.HexBrush"/>: the A–F palette is a semantic data
/// attribute shared with the web (like a chart series colour), not an ad-hoc theme colour, so it is the one
/// blessed place a palette hex is materialised; ambient theming still flows through the token brushes. The web
/// <c>tabular-nums</c> figure styling is a no-op here because the label is a letter, not digits; the web
/// <c>leading-none</c> is reproduced by collapsing the line height to the font size. The composed
/// <c>aria-label</c> is set as the surface's accessible name and the visible glyph is hidden from Narrator, so
/// the screen reader reads "Score B" rather than the bare letter.
/// </summary>
public sealed partial class ScoreBadge : ContentControl
{
    private readonly ILocalizer _localizer;
    private readonly ScoreBadgeDiagnostics _diagnostics;

    private ScoreBadgeModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the accessible-name strings resolve through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="ScoreBadgeModel.Unknown"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ScoreBadge(
        ILocalizer localizer,
        ScoreBadgeModel? model = null,
        ScoreBadgeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ScoreBadgeModel.Unknown;
        _diagnostics = diagnostics ?? new ScoreBadgeDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ScoreBadge</c>).</summary>
    public static string Slug => ScoreBadgeRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ScoreBadgeModel Model
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
        ScoreBadgeDisplay display = ScoreBadgeProjection.Project(_model, _localizer);
        Brush accent = DisplayPrimitives.HexBrush(display.ColorHex);

        // Web `inline-block font-bold leading-none`: the bold palette-coloured letter, with the line height
        // collapsed to the glyph size (leading-none). `tabular-nums` is a no-op for a letter label.
        var label = new TextBlock
        {
            Text = display.Label,
            FontSize = display.FontSize,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
            LineHeight = display.FontSize,
            LineStackingStrategy = LineStackingStrategy.BlockLineHeight,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The web span's aria-label replaces its inner text for assistive tech, so the visible glyph adds no
        // separate accessible node; Narrator reads only the composed name set on this surface.
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        AutomationProperties.SetName(this, display.AutomationName);
        if (!string.IsNullOrEmpty(display.AutomationId))
        {
            AutomationProperties.SetAutomationId(this, display.AutomationId);
        }

        Content = label;
    }
}
