using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.DlqInspector;

/// <summary>
/// The native WinUI 3 <c>AuditPanel</c> feature surface — a parity port of
/// web/src/features/admin/components/dlq-inspector/AuditPanel.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> and it renders exactly one of the web branches —
/// <see cref="AuditPanelState.Loading"/> (the audit table showing the "Loading audit log…" empty message, announced
/// as a live region), <see cref="AuditPanelState.Empty"/> (a friendly <see cref="TsEmptyState"/> with the scoped or
/// global "No replay attempts yet" copy), or <see cref="AuditPanelState.Data"/> (a <see cref="TsDataTable"/> of the
/// replay-audit rows). The view never performs HTTP; all branch selection, label resolution and formatting happen in
/// the WinUI-free <see cref="AuditPanelProjection"/>. The shared <see cref="TsDataTable"/> renders text cells, so the
/// result column shows its replay-result code (the textual content of the web <c>Badge</c>) while the
/// <c>RESULT_VARIANT</c> tint is computed and verified in the projection. Every string resolves through the i18n
/// facade and the surface carries a Narrator name in each state.
/// </summary>
public sealed partial class AuditPanel : ContentControl
{
    private readonly ILocalizer _localizer;
    private readonly AuditPanelDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private AuditPanelModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="AuditPanelModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    public AuditPanel(
        ILocalizer localizer,
        AuditPanelModel? model = null,
        AuditPanelDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? AuditPanelModel.Empty;
        _diagnostics = diagnostics ?? new AuditPanelDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AuditPanel</c>).</summary>
    public static string Slug => AuditPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public AuditPanelModel Model
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
        var display = AuditPanelProjection.Project(_model, _localizer, _clock());

        UIElement surface = display.State == AuditPanelState.Empty
            ? BuildEmpty(display)
            : BuildTable(display);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Empty (web !loading && rows.length === 0) ───────────────────────────────────────────────────
    private static TsEmptyState BuildEmpty(AuditPanelDisplay display) => new()
    {
        Title = display.EmptyTitle,
        Message = display.EmptyMessage,
    };

    // ── Data / Loading (web DataTable; empty message = loading ? "Loading audit log…" : "No replay attempts yet") ─
    private static TsDataTable BuildTable(AuditPanelDisplay display)
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
            PageSize = AuditPanelProjection.PageSize,
            Selectable = false,
            EmptyMessage = display.TableEmptyMessage,
        };

        if (display.State == AuditPanelState.Loading)
        {
            AutomationProperties.SetName(table, display.AutomationName);
            LiveRegion.Configure(table);
            LiveRegion.Announce(table);
        }

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
