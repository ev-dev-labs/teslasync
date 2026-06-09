using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SessionDetailPanel</c> feature surface — a parity port of
/// web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx. It is a presentational panel:
/// assign a <see cref="Model"/> (the web <c>session: ChargingSession</c> prop, narrowed to the rendered
/// fields) and it renders exactly one of three web-derived branches inside a glass panel headed
/// "Session Details" — <see cref="SessionDetailState.Loading"/> (skeleton rows while the parent fetches the
/// session list), <see cref="SessionDetailState.Empty"/> (a friendly "select a session" surface when no
/// session is bound), or <see cref="SessionDetailState.Ready"/> (the web label/value rows: Date, Charger
/// Type, SOC Range, Energy Added, Peak Power, the optional Avg Power, Duration, the optional Cost and the
/// optional Location, in that order, via the shared <see cref="TsKVList"/>). The view never performs HTTP;
/// all branch selection, label resolution and formatting happen in the WinUI-free
/// <see cref="SessionDetailProjection"/>. Every string resolves through the i18n facade, the header always
/// renders so a region is never blank, and the surface carries a Narrator name summarising the active state.
/// </summary>
public sealed partial class SessionDetailPanel : ContentControl
{
    private const double PanelPadding = 20;     // web p-5
    private const double HeaderSpacing = 12;    // web header mb-3 above the rows
    private const double SkeletonSpacing = 10;
    private const double SkeletonRowHeight = 18;
    private const int SkeletonRowCount = 6;

    private readonly ILocalizer _localizer;
    private readonly SessionDetailDiagnostics _diagnostics;

    private SessionDetailModel _model;
    private string _currencySymbol;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, optional diagnostics and currency.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SessionDetailModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The currency symbol for the cost row; defaults to "$".</param>
    public SessionDetailPanel(
        ILocalizer localizer,
        SessionDetailModel? model = null,
        SessionDetailDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SessionDetailModel.Pending;
        _diagnostics = diagnostics ?? new SessionDetailDiagnostics();
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? SessionDetailRegistration.DefaultCurrencySymbol
            : currencySymbol;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SessionDetailPanel</c>).</summary>
    public static string Slug => SessionDetailRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SessionDetailModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The currency symbol used for the cost row; reassigning re-projects the current model.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value)
                ? SessionDetailRegistration.DefaultCurrencySymbol
                : value;
            if (_currencySymbol == resolved)
            {
                return;
            }

            _currencySymbol = resolved;
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
        var display = SessionDetailProjection.Project(_model, _localizer, _currencySymbol);

        var content = new StackPanel { Spacing = HeaderSpacing };
        content.Children.Add(new SectionTitle { Value = display.Title });
        content.Children.Add(BuildBody(display));

        AutomationProperties.SetName(this, display.AutomationName);
        Content = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = content,
        };
    }

    private static FrameworkElement BuildBody(SessionDetailDisplay display) => display.State switch
    {
        SessionDetailState.Loading => BuildLoading(display),
        SessionDetailState.Empty => BuildEmpty(display),
        _ => BuildRows(display),
    };

    // ── Loading (parent still fetching the session list) ─────────────────────────────────────────────
    private static StackPanel BuildLoading(SessionDetailDisplay display)
    {
        var column = new StackPanel { Spacing = SkeletonSpacing };
        for (int i = 0; i < SkeletonRowCount; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = SkeletonRowHeight });
        }

        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        AutomationProperties.SetName(column, display.AutomationName);
        return column;
    }

    // ── Empty (web: no session selected yet) ─────────────────────────────────────────────────────────
    private static TsEmptyState BuildEmpty(SessionDetailDisplay display) => new()
    {
        Message = display.EmptyMessage,
    };

    // ── Ready (web fall-through: the label/value session-detail rows) ────────────────────────────────
    private static TsKVList BuildRows(SessionDetailDisplay display)
    {
        var items = new List<TsKeyValue>(display.Rows.Count);
        foreach (var row in display.Rows)
        {
            items.Add(new TsKeyValue(row.Label, row.Value));
        }

        return new TsKVList { Items = items };
    }
}
