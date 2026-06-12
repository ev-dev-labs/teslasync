using System.Text;

namespace TeslaSync.App.SharedSurfaces.BreadcrumbOverridesContextSurface;

/// <summary>
/// Canonical metadata for the <c>BreadcrumbOverridesContext</c> shared surface — the native mirror of the
/// module-level constants in <c>web/src/components/layout/BreadcrumbOverridesContext.tsx</c>. The web source is an
/// anonymous context bridge: it renders a bare children wrapper with no titles, labels or static copy, so there are
/// no i18n keys to resolve and no interactive elements of its own — only the diagnostics slug. UI-free, so the
/// metadata is asserted headlessly.
/// </summary>
public static class BreadcrumbOverridesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "BreadcrumbOverridesContext";
}

/// <summary>
/// Pure shallow-merge of an ordered sequence of breadcrumb-override maps — the native port of the web
/// <c>BreadcrumbOverridesProvider</c>'s <c>overrides</c> memo
/// (<c>for (const map of registrations.values()) for (const [k, v] of Object.entries(map)) if (v) merged[k] = v</c>).
/// Each map is a <c>Partial&lt;Record&lt;string, string&gt;&gt;</c> keyed by route pattern (e.g. <c>/drives/:id</c>)
/// whose value is the friendly label a page wants the global breadcrumb to show. Kept static and side-effect-free so
/// the canonical merge is unit-testable without a registry. Mirrors the web semantics exactly: a falsy value (web
/// <c>if (v)</c> — <c>null</c> or the empty string) contributes nothing, and a later map in the sequence wins for the
/// same route key (the web "later registration wins" / latest-effect-wins rule). Route-pattern keys are compared
/// ordinally because they are URL paths, never display copy.
/// </summary>
public static class BreadcrumbOverrideMerge
{
    /// <summary>
    /// Merge <paramref name="orderedMaps"/> shallow-left-to-right into a single override map. The sequence MUST be in
    /// registration order (the registry supplies it ordered by ascending registration id), so a later registration
    /// overwrites an earlier one for the same route key. <c>null</c> maps and falsy values (web <c>if (v)</c>) are
    /// skipped; the result is a fresh ordinal-keyed dictionary.
    /// </summary>
    /// <param name="orderedMaps">The per-registration override maps, in registration order.</param>
    public static IReadOnlyDictionary<string, string> Merge(IEnumerable<IReadOnlyDictionary<string, string>?> orderedMaps)
    {
        ArgumentNullException.ThrowIfNull(orderedMaps);

        var merged = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (IReadOnlyDictionary<string, string>? map in orderedMaps)
        {
            if (map is null)
            {
                continue;
            }

            foreach (KeyValuePair<string, string> entry in map)
            {
                // web: `if (v) merged[k] = v` — a falsy (null / empty) label is ignored; a later map wins.
                if (!string.IsNullOrEmpty(entry.Value))
                {
                    merged[entry.Key] = entry.Value;
                }
            }
        }

        return merged;
    }

    /// <summary>
    /// Structural ordinal equality of two merged override maps — used by the registry to raise its change event only
    /// when the merged result actually changes (the meaningful re-render), not on every registration churn.
    /// </summary>
    /// <param name="left">The first map.</param>
    /// <param name="right">The second map.</param>
    public static bool AreEqual(IReadOnlyDictionary<string, string> left, IReadOnlyDictionary<string, string> right)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);

        if (ReferenceEquals(left, right))
        {
            return true;
        }

        if (left.Count != right.Count)
        {
            return false;
        }

        foreach (KeyValuePair<string, string> entry in left)
        {
            if (!right.TryGetValue(entry.Key, out string? value) || !string.Equals(value, entry.Value, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }
}

/// <summary>
/// The stable-content codec the write-side handle uses to decide whether to re-register — the native analogue of the
/// web <c>useSetBreadcrumbOverrides</c> guard <c>const serialised = map ? JSON.stringify(map) : ''</c> that keeps the
/// registration effect from re-running when a caller passes a fresh object literal with identical content. The web
/// note is verbatim: "The map is JSON-compared so passing inline literals is safe." This native port canonicalises
/// <em>order-independently</em> (entries are sorted by key) and drops falsy values, so two maps with equal effective
/// content always serialize equal regardless of construction order — a safe superset of the web's positional
/// <c>JSON.stringify</c> compare, since the only requirement is "equal content ⇒ no re-registration". An empty or
/// all-falsy map serializes to the empty string, the sentinel the handle treats as "register nothing" (web
/// <c>!serialised</c>). Length-prefixed so a label that contains the field delimiters can never collide with a
/// different map.
/// </summary>
public static class BreadcrumbOverridesSerialization
{
    /// <summary>
    /// Produce the canonical, order-independent content key for <paramref name="map"/>. Falsy values are dropped; the
    /// surviving entries are ordinal-sorted by key and length-prefixed. A <c>null</c>, empty or all-falsy map yields
    /// the empty string (the web <c>''</c> sentinel).
    /// </summary>
    /// <param name="map">The override map a page wants to register, or null.</param>
    public static string Serialize(IReadOnlyDictionary<string, string>? map)
    {
        if (map is null || map.Count == 0)
        {
            return string.Empty;
        }

        List<KeyValuePair<string, string>> entries = map
            .Where(static entry => !string.IsNullOrEmpty(entry.Value))
            .OrderBy(static entry => entry.Key, StringComparer.Ordinal)
            .ToList();

        if (entries.Count == 0)
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        foreach (KeyValuePair<string, string> entry in entries)
        {
            builder
                .Append(entry.Key.Length).Append(':').Append(entry.Key)
                .Append('=')
                .Append(entry.Value.Length).Append(':').Append(entry.Value)
                .Append(';');
        }

        return builder.ToString();
    }
}

/// <summary>
/// The accessibility contract for the <c>BreadcrumbOverridesProvider</c> view — the native expression of the web
/// source rendering a bare fragment (<c>&lt;BreadcrumbOverridesContext.Provider&gt;{children}&lt;/&gt;</c>). A context
/// bridge has no visible chrome and no interactive affordance of its own: the global breadcrumb (the consumer of
/// <c>useBreadcrumbs(overrides)</c>) owns every label, and the pages own their content. So the provider contributes no
/// accessible node — the WinUI view maps this to <c>AccessibilityView.Raw</c> so Narrator traverses straight through
/// to the hosted content. Exposed as a constant so the (headless) accessibility test can assert the contract the WinUI
/// view consumes.
/// </summary>
public static class BreadcrumbOverridesAccessibility
{
    /// <summary>
    /// Whether the provider contributes an accessible node of its own. Always <c>false</c>: the web source is a
    /// transparent wrapper, so the native provider is an accessibility-raw structural element.
    /// </summary>
    public const bool ProviderContributesAccessibleNode = false;
}

/// <summary>
/// PII-safe diagnostics for the <c>BreadcrumbOverridesContext</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — <strong>never</strong> a route-pattern key or an override label.
/// A route key can carry an entity id (e.g. <c>/drives/:id</c>) and an override label is by design a friendly,
/// human-readable string that routinely carries location names (the web doc-comment's own example is
/// <c>"196th Street → Northeast 90th"</c>), so a diagnostics line that echoed either would leak PII. Thread-safe
/// because pages register and unregister from effects that can run off the UI thread.
/// </summary>
public sealed class BreadcrumbOverridesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _registered;
    private long _unregistered;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no key or label is ever passed).</param>
    public BreadcrumbOverridesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of override-map registrations made (count only, never the keys or labels).</summary>
    public long Registered => Interlocked.Read(ref _registered);

    /// <summary>Number of override-map unregistrations made (count only).</summary>
    public long Unregistered => Interlocked.Read(ref _unregistered);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BreadcrumbOverridesContext</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BreadcrumbOverridesRegistration.Slug}");
    }

    /// <summary>Record a registration, emitting <c>overrides.registered slug=BreadcrumbOverridesContext</c> (no key/label).</summary>
    public void RecordRegistered()
    {
        Interlocked.Increment(ref _registered);
        _sink?.Invoke($"overrides.registered slug={BreadcrumbOverridesRegistration.Slug}");
    }

    /// <summary>Record an unregistration, emitting <c>overrides.unregistered slug=BreadcrumbOverridesContext</c>.</summary>
    public void RecordUnregistered()
    {
        Interlocked.Increment(ref _unregistered);
        _sink?.Invoke($"overrides.unregistered slug={BreadcrumbOverridesRegistration.Slug}");
    }
}
