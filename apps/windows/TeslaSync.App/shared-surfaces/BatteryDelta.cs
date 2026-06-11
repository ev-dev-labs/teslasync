using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.BatteryDeltaSurface;

/// <summary>
/// The native WinUI 3 <c>BatteryDelta</c> shared surface — a parity port of
/// <c>web/src/components/data-display/BatteryDelta.tsx</c>. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>startPct</c> / <c>endPct</c> / <c>showIcon</c> / <c>variant</c> props) and it
/// renders the web layout — an inline row (<c>inline-flex items-center gap-1</c>) of an optional leading battery
/// <see cref="FontIcon"/> followed by the delta text. The view never performs HTTP; the <c>hasData</c> guard,
/// the signed-delta / sign / magnitude derivation, the tone selection and the <c>aria-label</c> interpolation
/// all happen in the WinUI-free <see cref="BatteryDeltaProjection"/>. The colour mirrors the web split exactly:
/// in the data branch only the numeric text carries the tone brush (emerald for a rise, amber for a drop) while
/// the icon inherits the ambient foreground (the web outer span sets no colour, so the icon is
/// <c>currentColor</c>); in the no-data branch both the icon and the em dash are muted (the web outer span is
/// <c>text-[var(--text-muted)]</c>). The decorative icon is hidden from Narrator and the surface carries the
/// single composed <c>aria-label</c> as its accessible name, so the screen reader reads the announcement rather
/// than the glyph. Because the web component is synchronous and prop-driven (its parent row owns any data
/// fetching), it has no loading / error / stale / offline chrome — only the data and no-data branches, both of
/// which always render — so this surface reproduces those two branches and never hides itself. The web
/// <c>tabular-nums</c> figure styling has no <see cref="TextBlock"/>-level equivalent on WinUI and is a purely
/// visual alignment nicety; the value, composition, tone and accessible name are all reproduced.
/// </summary>
public sealed partial class BatteryDelta : ContentControl
{
    private const double IconFontSize = 12;   // web `h-3 w-3`
    private const double RowSpacing = 4;       // web `gap-1`

    private readonly ILocalizer _localizer;
    private readonly BatteryDeltaDiagnostics _diagnostics;

    private BatteryDeltaModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the accessible-name strings resolve through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="BatteryDeltaModel.Unknown"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryDelta(
        ILocalizer localizer,
        BatteryDeltaModel? model = null,
        BatteryDeltaDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? BatteryDeltaModel.Unknown;
        _diagnostics = diagnostics ?? new BatteryDeltaDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>BatteryDelta</c>).</summary>
    public static string Slug => BatteryDeltaRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public BatteryDeltaModel Model
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
        BatteryDeltaDisplay display = BatteryDeltaProjection.Project(_model, _localizer);
        Brush accent = DisplayTokens.Brush(display.AccentBrushKey);

        // Web `inline-flex items-center gap-1`: a horizontal row, vertically centred, with a 4px gap.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (display.ShowIcon)
        {
            var icon = new FontIcon
            {
                Glyph = display.IconGlyph,
                FontSize = IconFontSize,
                VerticalAlignment = VerticalAlignment.Center,
            };

            // Web colour split: in the no-data branch the outer span is muted, so the icon is muted too; in the
            // data branch the outer span sets no colour, so the icon stays `currentColor` (the ambient
            // foreground) and only the text below is toned. Leaving the icon foreground unset lets it inherit.
            if (!display.HasData)
            {
                icon.Foreground = accent;
            }

            // Decorative (web `aria-hidden`) — the surface's accessible name already carries the announcement.
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            row.Children.Add(icon);
        }

        var text = new TextBlock
        {
            Text = display.VisibleText,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The web parent span's aria-label replaces the inner text for assistive tech, so the visible text adds
        // no separate accessible node; Narrator reads only the composed name set on this surface.
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        row.Children.Add(text);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = row;
    }
}
