using System.Text.Json;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The persistence seam the <see cref="AdvancedSettingsViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the three web <c>confirmSilence</c> helpers the web <c>AdvancedSettings</c> imports
/// (<c>listSilenced</c> / <c>unsilence</c> / <c>clearAllSilenced</c> in web/src/lib/confirmSilence.ts). It is
/// synchronous, per-device and offline — there is no network seam — exactly like the web localStorage store.
/// The view never touches storage directly: the app wires the durable
/// <see cref="LocalSettingsSilencedPromptsStore"/> (in the view file); headless callers and unit tests use
/// <see cref="InMemorySilencedPromptsStore"/>. Implementations must be best-effort — an unreadable store
/// yields an empty list and a failed write is swallowed (the web defensive try/catch contract).
/// </summary>
public interface ISilencedPromptsStore
{
    /// <summary>The currently-silenced action ids, deduped and ordinal-sorted (web <c>listSilenced()</c>).</summary>
    IReadOnlyList<string> List();

    /// <summary>Re-enable the prompt for a single action id, a no-op for an empty / absent id (web <c>unsilence</c>).</summary>
    /// <param name="key">The silenced action id to restore.</param>
    void Restore(string key);

    /// <summary>Wipe every silenced action id — "Restore all confirmation prompts" (web <c>clearAllSilenced</c>).</summary>
    void RestoreAll();
}

/// <summary>
/// Canonical storage schema for the silenced confirm-dialog ids — the native mirror of the web
/// <c>confirmSilence</c> contract (web/src/lib/confirmSilence.ts). The single allowlist key keeps the surface
/// area tiny and the stored shape is a JSON array of action ids; the <c>:v1</c> suffix lets the shape migrate
/// later without colliding. UI-free so the schema is asserted in unit tests.
/// </summary>
public static class SilencedPromptsStorage
{
    /// <summary>The single storage key holding the JSON array of silenced ids (web <c>teslasync:confirm-silence:v1</c>).</summary>
    public const string StorageKey = "teslasync:confirm-silence:v1";
}

/// <summary>
/// The pure JSON adapter behind the durable store — the native port of the web <c>confirmSilence</c>
/// <c>load()</c> / <c>save()</c> bodies (web/src/lib/confirmSilence.ts). <see cref="Parse"/> reads the stored
/// document branch-for-branch with the web: a null / empty / non-array / malformed payload yields an empty
/// list, otherwise the string entries are kept, deduped and ordinal-sorted (the web <c>Set</c> +
/// <c>listSilenced()</c> <c>.sort()</c>). <see cref="Serialize"/> writes back the deduped, sorted array.
/// Kept UI-free so the cached-document → projection-ready adapter is unit-tested without a XAML host.
/// </summary>
public static class SilencedPromptsCodec
{
    /// <summary>Parse the stored JSON document into the deduped, ordinal-sorted silenced ids (web <c>load()</c>).</summary>
    /// <param name="json">The raw stored JSON array string, or <see langword="null"/> when absent.</param>
    public static IReadOnlyList<string> Parse(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return Array.Empty<string>();
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return Array.Empty<string>();
            }

            var set = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var element in document.RootElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                string? value = element.GetString();
                if (!string.IsNullOrEmpty(value))
                {
                    set.Add(value);
                }
            }

            return set.Count == 0 ? Array.Empty<string>() : set.ToList();
        }
        catch (JsonException)
        {
            // Corrupt payload — the web JSON.parse throwing falls back to an empty set.
            return Array.Empty<string>();
        }
    }

    /// <summary>Serialize <paramref name="keys"/> back to the stored JSON array, deduped and ordinal-sorted (web <c>save()</c>).</summary>
    /// <param name="keys">The silenced ids to persist.</param>
    public static string Serialize(IEnumerable<string> keys)
    {
        ArgumentNullException.ThrowIfNull(keys);

        var set = new SortedSet<string>(StringComparer.Ordinal);
        foreach (string key in keys)
        {
            if (!string.IsNullOrEmpty(key))
            {
                set.Add(key);
            }
        }

        return JsonSerializer.Serialize(set);
    }
}

/// <summary>
/// An in-memory <see cref="ISilencedPromptsStore"/> used by unit tests (and as the headless fallback). It is
/// intentionally non-durable; the real app binds the <see cref="LocalSettingsSilencedPromptsStore"/>. Seed it
/// through the constructor (or <see cref="Silence"/>) to exercise a specific starting state. The ids are kept
/// deduped and ordinal-sorted so <see cref="List"/> matches the web <c>listSilenced()</c> ordering.
/// </summary>
public sealed class InMemorySilencedPromptsStore : ISilencedPromptsStore
{
    private readonly SortedSet<string> _keys;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (empty when omitted).</summary>
    /// <param name="initial">The initial silenced ids (deduped + sorted; empty / null entries dropped).</param>
    public InMemorySilencedPromptsStore(IEnumerable<string>? initial = null)
    {
        _keys = new SortedSet<string>(StringComparer.Ordinal);
        if (initial is not null)
        {
            foreach (string key in initial)
            {
                if (!string.IsNullOrEmpty(key))
                {
                    _keys.Add(key);
                }
            }
        }
    }

    /// <summary>Number of times an id was actually removed via <see cref="Restore"/> (a no-op restore is not counted).</summary>
    public int RestoreCount { get; private set; }

    /// <summary>Number of times <see cref="RestoreAll"/> was invoked.</summary>
    public int RestoreAllCount { get; private set; }

    /// <summary>Silence an action id (test/seed helper mirroring the web <c>silence</c>).</summary>
    /// <param name="key">The action id to silence.</param>
    public void Silence(string key)
    {
        if (!string.IsNullOrEmpty(key))
        {
            _keys.Add(key);
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> List() => _keys.Count == 0 ? Array.Empty<string>() : _keys.ToList();

    /// <inheritdoc />
    public void Restore(string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        if (_keys.Remove(key))
        {
            RestoreCount++;
        }
    }

    /// <inheritdoc />
    public void RestoreAll()
    {
        RestoreAllCount++;
        _keys.Clear();
    }
}
