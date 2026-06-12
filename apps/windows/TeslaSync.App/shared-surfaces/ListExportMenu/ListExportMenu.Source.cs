using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The export-action seam the menu invokes — the native port of the web component's callback props
/// (web/src/components/forms/ListExportMenu.tsx L7-L23: <c>onExportCsv</c> and <c>onExportJson</c>, each
/// receiving the chosen <see cref="ListExportScope"/>). The host wires these to a real serialiser that formats
/// the columns, builds the filename and triggers the download — the web component is "purely presentational:
/// the caller is responsible for serialising the data" (web class doc). Both actions return
/// <see cref="Task"/> so the menu can be driven from a UI thread without blocking, mirroring the web
/// <c>void | Promise&lt;void&gt;</c> callback signature. The view never touches this seam directly — it binds
/// through the view-model.
/// </summary>
public interface IListExportActions
{
    /// <summary>Export the rows as CSV for the chosen <paramref name="scope"/> (web <c>onExportCsv(scope)</c>).</summary>
    Task ExportCsvAsync(ListExportScope scope);

    /// <summary>Export the rows as JSON for the chosen <paramref name="scope"/> (web <c>onExportJson(scope)</c>).</summary>
    Task ExportJsonAsync(ListExportScope scope);
}

/// <summary>
/// A delegate-backed <see cref="IListExportActions"/> — the canonical implementation a host builds from its
/// row serialisers (the native analogue of passing the web export functions as the component's
/// <c>onExportCsv</c> / <c>onExportJson</c> props). Null delegates degrade to completed no-ops so a
/// partially-wired host never throws; the scope the user chose is forwarded verbatim to each delegate.
/// </summary>
public sealed class ListExportActions : IListExportActions
{
    private readonly Func<ListExportScope, Task>? _exportCsv;
    private readonly Func<ListExportScope, Task>? _exportJson;

    /// <summary>Creates the action set from its CSV / JSON export delegates (either may be <see langword="null"/>).</summary>
    public ListExportActions(
        Func<ListExportScope, Task>? exportCsv,
        Func<ListExportScope, Task>? exportJson)
    {
        _exportCsv = exportCsv;
        _exportJson = exportJson;
    }

    /// <summary>
    /// Builds an action set from synchronous callbacks — the common host shape, since the web callbacks are
    /// usually a synchronous "serialise + download" (web <c>void</c> branch). Each callback is wrapped into a
    /// completed <see cref="Task"/>.
    /// </summary>
    public static ListExportActions FromSync(
        Action<ListExportScope>? exportCsv,
        Action<ListExportScope>? exportJson) =>
        new(
            exportCsv is null ? null : scope => { exportCsv(scope); return Task.CompletedTask; },
            exportJson is null ? null : scope => { exportJson(scope); return Task.CompletedTask; });

    /// <inheritdoc />
    public Task ExportCsvAsync(ListExportScope scope) => _exportCsv?.Invoke(scope) ?? Task.CompletedTask;

    /// <inheritdoc />
    public Task ExportJsonAsync(ListExportScope scope) => _exportJson?.Invoke(scope) ?? Task.CompletedTask;
}

/// <summary>
/// The inert action set — every export is a completed no-op. Used as the safe default when a host has not
/// wired a serialiser yet (e.g. a gallery / design host), so the menu still renders its full structure without
/// an action seam to drive, the native analogue of mounting the web component with no-op callbacks.
/// </summary>
public sealed class NoOpListExportActions : IListExportActions
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpListExportActions Instance { get; } = new();

    private NoOpListExportActions()
    {
    }

    /// <inheritdoc />
    public Task ExportCsvAsync(ListExportScope scope) => Task.CompletedTask;

    /// <inheritdoc />
    public Task ExportJsonAsync(ListExportScope scope) => Task.CompletedTask;
}
