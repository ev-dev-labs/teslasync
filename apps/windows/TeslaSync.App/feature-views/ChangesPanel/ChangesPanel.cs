using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.FeatureFlags;

/// <summary>
/// The native WinUI 3 <c>ChangesPanel</c> feature surface — a parity port of
/// web/src/features/admin/components/feature-flags/ChangesPanel.tsx. It is a pure presentational control:
/// assign a <see cref="Model"/> and it renders exactly one of the web branches —
/// <see cref="ChangesPanelState.Empty"/> (a <see cref="TsEmptyState"/> with the scoped or global guidance
/// message), <see cref="ChangesPanelState.Loading"/> (a <see cref="TsDataTable"/> showing the "Loading audit
/// log…" empty message, announced as a live region), or <see cref="ChangesPanelState.Data"/> (a
/// <see cref="TsDataTable"/> of the flag-change rows). The view never performs HTTP; all branch selection,
/// label resolution and value formatting happen in the WinUI-free <see cref="ChangesPanelProjection"/>. The web
/// operation <c>Badge</c> maps to the shared <see cref="TsDataTable"/> which renders the operation as a text
/// cell (its variant is preserved in the projection's <see cref="ChangesPanelRow.OperationStatus"/>); every
/// string resolves through the i18n facade.
/// </summary>
public sealed partial class ChangesPanel : ContentControl
{
    private readonly ILocalizer _localizer;
    private readonly ChangesPanelDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private ChangesPanelModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChangesPanelModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    public ChangesPanel(
        ILocalizer localizer,
        ChangesPanelModel? model = null,
        ChangesPanelDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChangesPanelModel.Empty;
        _diagnostics = diagnostics ?? new ChangesPanelDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChangesPanel</c>).</summary>
    public static string Slug => ChangesPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChangesPanelModel Model
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
        var display = ChangesPanelProjection.Project(_model, _localizer, _clock());

        UIElement surface = display.State switch
        {
            ChangesPanelState.Empty => BuildEmpty(display),
            ChangesPanelState.Loading => BuildLoading(display),
            _ => BuildTable(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Empty (web !loading && rows.length === 0) ───────────────────────────────────────────────────
    private static TsEmptyState BuildEmpty(ChangesPanelDisplay display)
    {
        var empty = new TsEmptyState
        {
            Title = display.EmptyTitle,
            Message = display.EmptyMessage,
        };
        AutomationProperties.SetName(empty, display.AutomationName);
        AutomationProperties.SetAccessibilityView(empty, AccessibilityView.Content);
        return empty;
    }

    // ── Loading (web table with the "Loading audit log…" empty message) ─────────────────────────────
    private static TsDataTable BuildLoading(ChangesPanelDisplay display)
    {
        var table = BuildTable(display);
        LiveRegion.Configure(table);
        LiveRegion.Announce(table);
        return table;
    }

    // ── Data + Loading share the table; Loading just renders zero rows + the loading empty message ───
    private static TsDataTable BuildTable(ChangesPanelDisplay display)
    {
        var columns = new List<TsDataColumn>(display.Columns.Count);
        foreach (var column in display.Columns)
        {
            columns.Add(new TsDataColumn { Key = column.Key, Header = column.Header });
        }

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (var row in display.Rows)
        {
            // The table conveys each row's accessible content through its cell values (a TsDataRow is a plain
            // value record, not a UI element, so it carries no AutomationProperties of its own).
            rows.Add(new TsDataRow(row.RowKey, ToValues(row.Cells)));
        }

        var table = new TsDataTable
        {
            Columns = columns,
            Rows = rows,
            PageSize = ChangesPanelProjection.PageSize,
            Selectable = false,
            EmptyMessage = display.LoadingMessage,
        };
        AutomationProperties.SetName(table, display.AutomationName);
        return table;
    }

    private static Dictionary<string, object?> ToValues(IReadOnlyDictionary<string, string> cells)
    {
        var values = new Dictionary<string, object?>(cells.Count, StringComparer.Ordinal);
        foreach (var cell in cells)
        {
            values[cell.Key] = cell.Value;
        }

        return values;
    }
}
