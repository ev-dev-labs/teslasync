using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SqlPlaygroundPage</c> view — the native port of the web page's
/// data flow (web/src/features/power-user/pages/SqlPlaygroundPage.tsx). It owns the local editor state (the SQL text
/// and the last Run message), persists the draft through an injected <see cref="ISqlPlaygroundDraftStore"/> (the web
/// <c>localStorage['ai.sqlPlayground.draft']</c> contract) and projects the result through
/// <see cref="SqlPlaygroundProjection"/> so the view is a thin renderer. The page has no API data source, so it only
/// ever surfaces the success state. Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SqlPlaygroundPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly ISqlPlaygroundDraftStore _draftStore;
    private readonly SqlPlaygroundDiagnostics _diagnostics;

    private string _sql;
    private SqlRunMessageKind _runMessage = SqlRunMessageKind.None;
    private SqlPlaygroundDisplay _display;

    /// <summary>Creates the holder over its localizer, (optional) draft store and (optional) diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="draftStore">The draft persistence seam (defaults to the app-session-wide in-memory store).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SqlPlaygroundPageViewModel(
        ILocalizer localizer,
        ISqlPlaygroundDraftStore? draftStore = null,
        SqlPlaygroundDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _draftStore = draftStore ?? InMemorySqlPlaygroundDraftStore.Shared;
        _diagnostics = diagnostics ?? new SqlPlaygroundDiagnostics();
        _sql = _draftStore.Load() ?? string.Empty;
        _display = SqlPlaygroundProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SqlPlaygroundDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The current data state (always <see cref="SqlPlaygroundState.Success"/>).</summary>
    public SqlPlaygroundState State => _display.State;

    /// <summary>The localized page title (web <c>powerSql.title</c>).</summary>
    public string Title => _display.Title;

    /// <summary>The current SQL editor contents (web <c>sql</c>).</summary>
    public string Sql => _sql;

    /// <summary>True when the trimmed SQL is non-empty (web <c>canRun</c>); gates Run + Clear.</summary>
    public bool CanRun => _display.CanRun;

    /// <summary>Which run message (if any) the last Run action surfaced (web <c>runMessage</c>).</summary>
    public SqlRunMessageKind RunMessage => _runMessage;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Set the SQL editor contents (web <c>setSql</c>); persists the draft and re-projects.</summary>
    /// <param name="value">The new editor text (null is treated as empty).</param>
    public void SetSql(string? value)
    {
        var next = value ?? string.Empty;
        if (string.Equals(_sql, next, StringComparison.Ordinal))
        {
            return;
        }

        _sql = next;
        _draftStore.Save(_sql);
        Reproject();
    }

    /// <summary>
    /// Handle the Run action (web <c>handleRun</c>). There is no browser-side execution endpoint: an empty query
    /// surfaces the "type a query first" hint, otherwise the deterministic "copy into a DB client" notice.
    /// </summary>
    public void Run()
    {
        _runMessage = string.IsNullOrWhiteSpace(_sql)
            ? SqlRunMessageKind.Empty
            : SqlRunMessageKind.Unavailable;
        Reproject();
    }

    /// <summary>Clear the editor and any run message (web <c>handleClear</c>); persists the cleared draft.</summary>
    public void Clear()
    {
        if (_sql.Length == 0 && _runMessage == SqlRunMessageKind.None)
        {
            return;
        }

        _sql = string.Empty;
        _runMessage = SqlRunMessageKind.None;
        _draftStore.Save(_sql);
        Reproject();
    }

    /// <summary>
    /// Re-resolve every label from the localizer — the native analogue of react-i18next re-rendering the copy after
    /// the active language changes. Raises change notifications so the view re-renders without being reconstructed.
    /// </summary>
    public void Reload() => Reproject();

    private SqlPlaygroundModel BuildModel() => new(_sql, _runMessage);

    private void Reproject()
    {
        Display = SqlPlaygroundProjection.Project(BuildModel(), _localizer);
        Raise(nameof(State));
        Raise(nameof(Title));
        Raise(nameof(Sql));
        Raise(nameof(CanRun));
        Raise(nameof(RunMessage));
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
