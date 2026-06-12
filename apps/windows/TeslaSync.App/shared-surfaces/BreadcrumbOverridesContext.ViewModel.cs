using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.BreadcrumbOverridesContextSurface;

/// <summary>
/// The read side of the breadcrumb-override context — the native port of the web <c>useBreadcrumbOverrides()</c> hook
/// (<c>web/src/components/layout/BreadcrumbOverridesContext.tsx</c>) that the global layout reads and forwards to
/// <c>useBreadcrumbs(overrides)</c>. It exposes the merged override map from an
/// <see cref="IBreadcrumbOverridesRegistry"/> and raises <see cref="INotifyPropertyChanged"/> whenever that map
/// changes — including changes made by a different page through the same shared registry — mirroring the web consumer
/// re-rendering on a new <c>overrides</c> value. <see cref="Dispose"/> detaches from the registry (the web effect
/// cleanup). The holder performs no I/O; it binds to the registry.
/// </summary>
public sealed class BreadcrumbOverridesState : INotifyPropertyChanged, IDisposable
{
    private readonly IBreadcrumbOverridesRegistry _registry;
    private IReadOnlyDictionary<string, string> _overrides;
    private bool _disposed;

    /// <summary>
    /// Creates the read-side holder over <paramref name="registry"/> (the web <c>useBreadcrumbOverrides()</c> call) and
    /// subscribes to registry changes (the web re-render on a new merged map).
    /// </summary>
    /// <param name="registry">The breadcrumb-override registry seam to read the merged map from.</param>
    public BreadcrumbOverridesState(IBreadcrumbOverridesRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(registry);

        _registry = registry;
        _overrides = registry.MergedOverrides;
        _registry.Changed += OnRegistryChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// The merged override map (web <c>useBreadcrumbOverrides()</c> result, which falls back to <c>{}</c> outside a
    /// provider). The returned dictionary is a snapshot; it is replaced (and <see cref="PropertyChanged"/> raised)
    /// whenever the registry's merged content changes.
    /// </summary>
    public IReadOnlyDictionary<string, string> MergedOverrides => _overrides;

    /// <summary>Detach from the registry (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _registry.Changed -= OnRegistryChanged;
        GC.SuppressFinalize(this);
    }

    private void OnRegistryChanged(object? sender, EventArgs e)
    {
        IReadOnlyDictionary<string, string> latest = _registry.MergedOverrides;
        if (BreadcrumbOverrideMerge.AreEqual(_overrides, latest))
        {
            return;
        }

        _overrides = latest;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(MergedOverrides)));
    }
}

/// <summary>
/// The write side of the breadcrumb-override context — the native port of the web
/// <c>useSetBreadcrumbOverrides(map?)</c> hook that a page calls to push its dynamic route labels up to the single
/// global breadcrumb (<c>web/src/components/layout/BreadcrumbOverridesContext.tsx</c>). It reproduces the web effect
/// exactly:
/// <list type="number">
///   <item><description>the map is canonicalised to a stable content key
///     (<see cref="BreadcrumbOverridesSerialization.Serialize"/>) so passing a fresh literal with identical content is
///     a no-op (web <c>serialised</c> dependency);</description></item>
///   <item><description>when the content changes, the previous registration is dropped and — for non-empty content — a
///     <em>fresh</em> id is allocated and the map re-registered, so this page moves to the end of the merge order and
///     wins for a shared route key (web effect cleanup <c>unregister(id); idRef = null</c> followed by the next effect
///     allocating <c>nextId++</c>);</description></item>
///   <item><description>empty / all-falsy content registers nothing (web <c>!serialised</c> branch);</description></item>
///   <item><description><see cref="Dispose"/> unregisters (the web unmount cleanup).</description></item>
/// </list>
/// </summary>
public sealed class BreadcrumbOverridesPublisher : IDisposable
{
    private readonly IBreadcrumbOverridesRegistry _registry;
    private readonly BreadcrumbOverridesDiagnostics? _diagnostics;
    private string _serialised = string.Empty;
    private int? _registrationId;
    private bool _disposed;

    /// <summary>
    /// Creates the write-side handle over <paramref name="registry"/> (the web <c>useSetBreadcrumbOverrides</c> call)
    /// and an optional PII-safe diagnostics collector for register / unregister counters.
    /// </summary>
    /// <param name="registry">The breadcrumb-override registry seam to push labels into.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public BreadcrumbOverridesPublisher(IBreadcrumbOverridesRegistry registry, BreadcrumbOverridesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(registry);

        _registry = registry;
        _diagnostics = diagnostics;
    }

    /// <summary>The current registration id, or <c>null</c> when nothing is registered (web <c>idRef.current</c>).</summary>
    public int? RegistrationId => _registrationId;

    /// <summary>Whether this handle currently has an override map registered.</summary>
    public bool IsRegistered => _registrationId is not null;

    /// <summary>
    /// Push <paramref name="map"/> up to the global breadcrumb for the current page (web
    /// <c>useSetBreadcrumbOverrides(map)</c>). Passing <c>null</c> (or a map whose values are all falsy) registers
    /// nothing and clears any previous registration. Calling repeatedly with content-equal maps is a no-op.
    /// </summary>
    /// <param name="map">The override map to register, or null to register nothing.</param>
    public void Set(IReadOnlyDictionary<string, string>? map)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        string serialised = BreadcrumbOverridesSerialization.Serialize(map);
        if (string.Equals(serialised, _serialised, StringComparison.Ordinal))
        {
            // web: the effect's `serialised` dependency is unchanged, so it does not re-run.
            return;
        }

        // web effect cleanup: unregister the previous id and reset idRef before the next effect runs.
        if (_registrationId is int previousId)
        {
            _registry.Unregister(previousId);
            _registrationId = null;
            _diagnostics?.RecordUnregistered();
        }

        _serialised = serialised;

        if (serialised.Length == 0)
        {
            // web `!serialised` branch: nothing to register.
            return;
        }

        // web next effect: allocate a fresh id (nextId++) and register the parsed map.
        int id = _registry.CreateRegistrationId();
        _registrationId = id;
        _registry.Register(id, map!);
        _diagnostics?.RecordRegistered();
    }

    /// <summary>Unregister this page's labels (the web unmount cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_registrationId is int id)
        {
            _registry.Unregister(id);
            _registrationId = null;
            _diagnostics?.RecordUnregistered();
        }

        GC.SuppressFinalize(this);
    }
}
