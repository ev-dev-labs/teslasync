using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.DlqInspector;

/// <summary>
/// The native WinUI 3 <c>StatusHeader</c> feature surface — a parity port of
/// web/src/features/admin/components/dlq-inspector/StatusHeader.tsx. It is a pure presentational control:
/// assign a <see cref="Model"/> and it renders the web layout — a three-up grid of
/// <see cref="TsStatCard"/> tiles (Total entries, Replayable, Replay mode) and, when replay is disabled, a
/// warning <see cref="TsAlertBanner"/> telling the operator that the replay button below will return
/// HTTP 403. Every tile is always shown (an em dash while loading, zeros for an absent response — never a
/// hidden surface). The view never performs HTTP; all value derivation, label resolution and formatting
/// happen in the WinUI-free <see cref="StatusHeaderProjection"/>. Every string resolves through the i18n
/// facade and the surface carries a Narrator name.
/// </summary>
public sealed partial class StatusHeader : ContentControl
{
    private readonly ILocalizer _localizer;
    private readonly StatusHeaderDiagnostics _diagnostics;

    private StatusHeaderModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="StatusHeaderModel.Initial"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StatusHeader(
        ILocalizer localizer,
        StatusHeaderModel? model = null,
        StatusHeaderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? StatusHeaderModel.Initial;
        _diagnostics = diagnostics ?? new StatusHeaderDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>StatusHeader</c>).</summary>
    public static string Slug => StatusHeaderRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public StatusHeaderModel Model
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
        var display = StatusHeaderProjection.Project(_model, _localizer);

        // Web `<Grid cols={{ default: 1, sm: 3 }} gap={4}>` — three tiles that collapse to one column when
        // the host is too narrow for three (TsGrid reduces the count below ItemMinWidth). gap-4 == 16px.
        var grid = new TsGrid { Columns = 3, Gutter = 16, ItemMinWidth = 200 };
        foreach (var card in display.Cards)
        {
            var tile = new TsStatCard
            {
                Label = card.Label,
                Value = card.Value,
                Sublabel = card.Sublabel,
                Glyph = card.Glyph,
            };
            AutomationProperties.SetName(tile, card.AutomationName);
            grid.Children.Add(tile);
        }

        // Web `space-y-4` between the grid and the conditional banner.
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(grid);

        if (display.ShowBanner)
        {
            // Web `<AlertBanner variant="warning" title=...>` with no onClose, so it is non-dismissible.
            var banner = new TsAlertBanner
            {
                Variant = CalloutVariant.Warning,
                Dismissible = false,
                Title = display.BannerTitle,
                Message = display.BannerMessage,
            };
            stack.Children.Add(banner);
        }

        AutomationProperties.SetName(this, display.AutomationName);
        Content = stack;
    }
}
