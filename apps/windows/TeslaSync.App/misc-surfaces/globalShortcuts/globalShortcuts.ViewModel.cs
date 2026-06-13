using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="GlobalShortcuts"/> view — the native port of the
/// web seeder (web/src/lib/globalShortcuts.tsx). The web component builds its definitions from the static
/// catalogue + <c>useTranslation</c> (a <c>useMemo</c>) and registers them into the shortcut registry for its
/// lifetime via <c>useShortcut(defs)</c> (register on mount, unregister on unmount). This holder reproduces
/// that: it builds the definitions through <see cref="GlobalShortcutsCatalog.Build"/>, projects the render-ready
/// grouped <see cref="Display"/> through <see cref="GlobalShortcutsProjection"/>, and — on
/// <see cref="Activate"/> (the web mount) — registers every definition into the bound
/// <see cref="IShortcutRegistry"/> (the P1/S8 state-holder seam, shared with the cheatsheet) and records the
/// <c>view.opened</c> diagnostic; <see cref="Deactivate"/> (the web unmount) unregisters them.
/// <see cref="Reload"/> rebuilds + re-registers after a language change (react-i18next re-render). The view
/// never performs HTTP or storage. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class GlobalShortcutsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IShortcutRegistry _registry;
    private readonly GlobalShortcutsDiagnostics _diagnostics;

    private IReadOnlyList<ShortcutDefinition> _definitions;
    private GlobalShortcutsDisplay _display;
    private bool _isActive;
    private bool _disposed;

    /// <summary>Creates the holder over the i18n facade, the shared shortcut registry and optional diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="registry">The shared shortcut registry the surface seeds (web <c>useShortcut</c> seam).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public GlobalShortcutsViewModel(
        ILocalizer localizer,
        IShortcutRegistry registry,
        GlobalShortcutsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(registry);

        _localizer = localizer;
        _registry = registry;
        _diagnostics = diagnostics ?? new GlobalShortcutsDiagnostics();
        _definitions = GlobalShortcutsCatalog.Build(localizer);
        _display = GlobalShortcutsProjection.Project(_definitions, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready grouped display for the inline global-shortcuts panel.</summary>
    public GlobalShortcutsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The built global-shortcut definitions the surface seeds (web <c>defs</c>).</summary>
    public IReadOnlyList<ShortcutDefinition> Definitions => _definitions;

    /// <summary>True while the surface is mounted and its definitions are registered (web mounted state).</summary>
    public bool IsActive
    {
        get => _isActive;
        private set
        {
            if (_isActive == value)
            {
                return;
            }

            _isActive = value;
            Raise(nameof(IsActive));
        }
    }

    /// <summary>
    /// Mount the seeder (web component mount → <c>useShortcut</c> effect): register every definition into the
    /// shared registry and record the <c>view.opened</c> diagnostic. Idempotent — a second call while already
    /// active is a no-op (no duplicate registration, no duplicate diagnostic).
    /// </summary>
    public void Activate()
    {
        if (_disposed || _isActive)
        {
            return;
        }

        RegisterAll();
        IsActive = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>
    /// Unmount the seeder (web component unmount → <c>useShortcut</c> cleanup): unregister every definition from
    /// the shared registry. Idempotent — a call while inactive is a no-op.
    /// </summary>
    public void Deactivate()
    {
        if (!_isActive)
        {
            return;
        }

        foreach (ShortcutDefinition def in _definitions)
        {
            _registry.Unregister(def.Id);
        }

        IsActive = false;
    }

    /// <summary>
    /// Re-resolve every label and re-project — the native analogue of react-i18next re-rendering after the
    /// active language changes. Rebuilds the definitions from the catalogue, re-projects the
    /// <see cref="Display"/>, and (when active) re-registers them so the cheatsheet picks up the new copy. Does
    /// not re-emit the <c>view.opened</c> diagnostic (a language change is not a re-open).
    /// </summary>
    public void Reload()
    {
        if (_disposed)
        {
            return;
        }

        _definitions = GlobalShortcutsCatalog.Build(_localizer);
        if (_isActive)
        {
            // Register replaces by id (last-writer-wins, keeps position) so the registry copy refreshes in place.
            RegisterAll();
        }

        Display = GlobalShortcutsProjection.Project(_definitions, _localizer);
    }

    /// <summary>Unregister the definitions and stop responding (idempotent). Mirrors the web unmount cleanup.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        Deactivate();
        _disposed = true;
    }

    private void RegisterAll()
    {
        foreach (ShortcutDefinition def in _definitions)
        {
            _registry.Register(def);
        }
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
