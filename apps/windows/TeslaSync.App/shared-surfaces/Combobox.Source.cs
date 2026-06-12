using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// An async option loader — the native port of the web <c>Combobox</c>'s functional <c>options</c> form
/// (web/src/components/forms/Combobox.tsx L65-L67: <c>(query, signal) =&gt; Promise&lt;readonly T[]&gt;</c>).
/// It receives the current input text and a <see cref="CancellationToken"/> that is cancelled when a newer
/// keystroke arrives; implementations MUST forward the token to their cancellable fetch/geocode/API calls so
/// an in-flight request for a stale query is abandoned, exactly as the web loader is expected to forward its
/// <c>AbortSignal</c>. Loaders own their own filtering (the surface renders whatever the loader returns).
/// </summary>
/// <param name="query">The current input text to search for.</param>
/// <param name="cancellationToken">Cancelled when a newer keystroke supersedes this request.</param>
/// <returns>The matching options for <paramref name="query"/>.</returns>
public delegate Task<IReadOnlyList<ComboOption>> ComboboxOptionLoader(string query, CancellationToken cancellationToken);

/// <summary>
/// The combobox's option provider seam (P1/S8 state-holder layer) — the native unification of the web
/// <c>ComboboxOptions&lt;T&gt;</c> union (web/src/components/forms/Combobox.tsx L65-L67), which is either a
/// static array filtered locally or an async loader. The view never fetches directly; it asks this seam to
/// produce the options for the current query and renders the result. <see cref="IsAsync"/> mirrors the web
/// <c>typeof options === 'function'</c> branch: the async case shows the in-flight spinner and debounces +
/// cancels on each keystroke, while the static case resolves synchronously and never shows a fetch spinner.
/// </summary>
public interface IComboboxOptionsSource
{
    /// <summary>
    /// Whether this source loads asynchronously (web <c>isAsync = typeof options === 'function'</c>). When
    /// true the surface debounces queries, cancels the previous request on each keystroke and shows the
    /// loading spinner; when false it resolves <see cref="LoadAsync"/> synchronously with no spinner.
    /// </summary>
    bool IsAsync { get; }

    /// <summary>
    /// Produce the options for <paramref name="query"/> (web: the static filter, or the loader's resolved
    /// list). The static source filters its array locally; the async source delegates to its loader and maps
    /// the loader's error path to an empty list (web <c>catch</c> → <c>setAsyncOptions([])</c>). The
    /// <paramref name="cancellationToken"/> is cancelled when a newer keystroke arrives; a cancelled async
    /// load throws <see cref="OperationCanceledException"/> so the caller drops the stale result.
    /// </summary>
    Task<IReadOnlyList<ComboOption>> LoadAsync(string query, CancellationToken cancellationToken);
}

/// <summary>
/// A static-array option source — the native port of the web <c>Combobox</c>'s array <c>options</c> form
/// (web/src/components/forms/Combobox.tsx L65). It filters the fixed option set locally through the shared,
/// unit-tested <see cref="ComboboxFilter"/> (the native analogue of the web <c>defaultFilter</c>:
/// case-insensitive substring on the label, blank query returns everything), resolving synchronously with no
/// loading spinner (<see cref="IsAsync"/> is false). Construct it from the host's option list.
/// </summary>
public sealed class StaticComboboxOptionsSource : IComboboxOptionsSource
{
    private readonly IReadOnlyList<ComboOption> _options;

    /// <summary>Creates the source over a fixed option set (web static <c>options</c> array).</summary>
    public StaticComboboxOptionsSource(IReadOnlyList<ComboOption> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options;
    }

    /// <summary>An empty static source — the native analogue of mounting the web combobox with <c>options={[]}</c>.</summary>
    public static StaticComboboxOptionsSource Empty { get; } = new(Array.Empty<ComboOption>());

    /// <inheritdoc />
    public bool IsAsync => false;

    /// <summary>The full, unfiltered option set (exposed for hosting / tests).</summary>
    public IReadOnlyList<ComboOption> Options => _options;

    /// <inheritdoc />
    public Task<IReadOnlyList<ComboOption>> LoadAsync(string query, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // web defaultFilter: trim + case-insensitive substring on the label; a blank query returns all.
        return Task.FromResult(ComboboxFilter.Filter(_options, query));
    }
}

/// <summary>
/// An async option source — the native port of the web <c>Combobox</c>'s functional <c>options</c> form
/// (web/src/components/forms/Combobox.tsx L66-L67 + the fetch effect L231-L266). It delegates each query to a
/// <see cref="ComboboxOptionLoader"/> (forwarding the keystroke cancellation token), normalises a
/// <see langword="null"/> result to an empty list (web <c>next ?? []</c>), and maps the loader's failure path
/// to an empty list so a rejected fetch renders the friendly "No results" state rather than crashing the
/// surface (web <c>catch</c> → <c>setAsyncOptions([])</c>, L255-L260). A cancelled load is rethrown so the
/// surface drops the stale result instead of replacing fresher options (web "if (signal.aborted) return").
/// </summary>
public sealed class AsyncComboboxOptionsSource : IComboboxOptionsSource
{
    private readonly ComboboxOptionLoader _loader;

    /// <summary>Creates the source over a cancellable loader (web functional <c>options</c>).</summary>
    public AsyncComboboxOptionsSource(ComboboxOptionLoader loader)
    {
        ArgumentNullException.ThrowIfNull(loader);
        _loader = loader;
    }

    /// <inheritdoc />
    public bool IsAsync => true;

    /// <inheritdoc />
    public async Task<IReadOnlyList<ComboOption>> LoadAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            IReadOnlyList<ComboOption> result = await _loader(query, cancellationToken).ConfigureAwait(false);

            // web: `setAsyncOptions(next ?? [])` — a null/absent result is treated as no matches.
            return result ?? Array.Empty<ComboOption>();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // web: a superseded keystroke aborts the request — `if (signal.aborted) return;` — so the caller
            // keeps the in-flight load's result out of the UI. Rethrow so the view-model drops it.
            throw;
        }
        catch (Exception)
        {
            // web: any other rejection resolves to an empty list so the surface shows "No results" instead
            // of breaking (`.catch(() => { setAsyncOptions([]); })`).
            return Array.Empty<ComboOption>();
        }
    }
}
