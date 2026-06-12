namespace TeslaSync.App.SharedSurfaces.FormFieldSurface;

/// <summary>
/// The field-id seam (P1/S8 state-holder layer) — the native analogue of React's <c>useId()</c> hook the
/// web component calls (web/src/components/forms/FormField.tsx, <c>const autoId = useId()</c>). React
/// guarantees a process-stable, collision-free id per component instance; this seam supplies the same: each
/// mounted <see cref="FormFieldViewModel"/> requests one id at construction (the once-per-instance
/// <c>useId</c> call) and caches it, so the value is stable for the life of the surface. The view never
/// generates ids itself — it binds through the view-model, which binds through this seam. The canonical
/// implementation is <see cref="FieldIdProvider"/>; <see cref="FixedFieldIdProvider"/> stands in for
/// deterministic headless tests.
/// </summary>
public interface IFieldIdProvider
{
    /// <summary>Return a fresh, process-unique id (one <c>useId()</c> call). The caller caches it for stability.</summary>
    string NextId();
}

/// <summary>
/// The canonical field-id provider — the native port of React's <c>useId()</c> (web FormField's
/// <c>autoId</c>). Like React's module-level id counter it draws from a single process-wide monotonic
/// sequence, so every <see cref="FormFieldViewModel"/> instance (across every page / window) receives a
/// distinct id; combined with the view-model caching its id once, that reproduces React's per-instance
/// stable, collision-free guarantee. The sequence is advanced atomically so ids stay unique even when
/// surfaces are constructed off the UI thread.
/// </summary>
public sealed class FieldIdProvider : IFieldIdProvider
{
    /// <summary>The id prefix — a stable, DOM/automation-id-safe token (the opaque web <c>:r0:</c> analogue).</summary>
    public const string Prefix = "formfield";

    private static int _sequence;

    /// <summary>The process-wide shared provider (the React module-level counter analogue).</summary>
    public static FieldIdProvider Shared { get; } = new();

    /// <inheritdoc />
    public string NextId() =>
        string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{Prefix}-{Interlocked.Increment(ref _sequence)}");
}

/// <summary>
/// A deterministic field-id provider for headless tests — always returns the supplied id (the React
/// <c>useId()</c> value pinned to a known constant), so a projection's id derivations
/// (<c>fieldId</c> / <c>errorId</c> / <c>hintId</c>) can be asserted against an exact expected string.
/// </summary>
public sealed class FixedFieldIdProvider : IFieldIdProvider
{
    private readonly string _id;

    /// <summary>Creates a provider that always returns <paramref name="id"/>.</summary>
    /// <param name="id">The fixed id to return from every <see cref="NextId"/> call.</param>
    public FixedFieldIdProvider(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        _id = id;
    }

    /// <inheritdoc />
    public string NextId() => _id;
}
