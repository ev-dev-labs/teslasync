using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Helix (AI) settings surface. Every getter returns a
/// fallback rather than throwing so a partial or schema-drifted <c>GET /settings</c> document never aborts the
/// parse (web parity: <c>AISettings.tsx</c>'s <c>readProviderString</c> / <c>isAiMode</c> tolerate undefined
/// fields). Kept private to the surface and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class AiSettingsJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, tolerating a real bool or a "true"/"false" string.</summary>
    public static bool GetBool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return false;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(prop.GetString(), out var b) => b,
            _ => false,
        };
    }

    /// <summary>The raw JSON text of the object property <paramref name="name"/>, or null when absent / not an object.</summary>
    public static string? GetObjectRaw(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Object
            ? prop.GetRawText()
            : null;

    /// <summary>Read a <c>{ id: bool }</c> map property into a deterministic dictionary (non-bool entries default to false).</summary>
    public static IReadOnlyDictionary<string, bool> ReadBoolMap(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var map)
            || map.ValueKind != JsonValueKind.Object)
        {
            return EmptyBoolMap;
        }

        var result = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var entry in map.EnumerateObject())
        {
            result[entry.Name] = entry.Value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.String when bool.TryParse(entry.Value.GetString(), out var b) => b,
                _ => false,
            };
        }

        return result;
    }

    /// <summary>A shared empty, immutable feature map (the parse fallback).</summary>
    public static IReadOnlyDictionary<string, bool> EmptyBoolMap { get; } =
        new Dictionary<string, bool>(StringComparer.Ordinal);
}

/// <summary>
/// The three canonical Helix modes — the native mirror of the web <c>AiMode = 'off' | 'local' | 'cloud'</c>
/// union (web/src/features/settings/components/AISettings.tsx). <see cref="Off"/> is the default per ADR-015
/// §I1 (a fresh install never auto-enables Helix).
/// </summary>
public enum AiMode
{
    /// <summary>Helix disabled (web <c>'off'</c>) — the default; nothing is enabled.</summary>
    Off,

    /// <summary>A private model on the user's network (web <c>'local'</c>) — no data leaves the install.</summary>
    Local,

    /// <summary>A cloud provider (web <c>'cloud'</c>) — requires an API key and may bill per token.</summary>
    Cloud,
}

/// <summary>
/// Parse/serialize helpers for <see cref="AiMode"/> — the native analogue of the web <c>isAiMode</c> guard
/// and the wire-string forms the <c>PUT /settings</c> body uses. UI-free so it is unit-tested without a host.
/// </summary>
public static class AiModes
{
    /// <summary>The canonical lowercase wire token for <paramref name="mode"/> (matches the Go API).</summary>
    public static string Wire(AiMode mode) => mode switch
    {
        AiMode.Local => "local",
        AiMode.Cloud => "cloud",
        _ => "off",
    };

    /// <summary>Parse a wire token to a mode; any unknown / empty token is the safe default <see cref="AiMode.Off"/>.</summary>
    public static AiMode Parse(string? raw) => raw switch
    {
        "local" => AiMode.Local,
        "cloud" => AiMode.Cloud,
        _ => AiMode.Off,
    };
}

/// <summary>
/// The lifecycle state the Helix settings surface can be in. Every branch maps onto a visible surface — none
/// is ever hidden (engineering rule #6). The web component renders the opt-in form while <c>isLoading</c>
/// gates only the Save button; the native cache-then-network surface additionally renders explicit
/// <see cref="Loading"/>, <see cref="Stale"/> and <see cref="Offline"/> branches (a strict superset that
/// satisfies the prompt's mandated state set).
/// </summary>
public enum AiSettingsPanelState
{
    /// <summary>First fetch with no cached settings — render the loading affordance.</summary>
    Loading,

    /// <summary>A fresh settings document (network or non-stale cache) — render the opt-in form.</summary>
    Loaded,

    /// <summary>The read resolved with no usable settings object — render the opt-in form at defaults.</summary>
    Empty,

    /// <summary>The read failed and no cached settings exist — render the retry affordance.</summary>
    Error,

    /// <summary>A cached document older than the freshness window — form plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached document remains — form plus an offline chip.</summary>
    Offline,
}

/// <summary>The cost-cap budget band — the native mirror of the web <c>level: 'ok' | 'warn' | 'critical'</c>.</summary>
public enum AiCostCapLevel
{
    /// <summary>Under 80% of the cap — informational (web cyan).</summary>
    Ok,

    /// <summary>At or above 80% of the cap — warning (web amber).</summary>
    Warn,

    /// <summary>At or above 100% of the cap — calls are now being rejected (web rose).</summary>
    Critical,
}

/// <summary>
/// The editable provider draft the surface round-trips on save — the native analogue of the web
/// <c>AIProviderDraft</c> (web/src/features/settings/components/AIProviderSection.tsx). Field names mirror the
/// Go API's snake_case provider config; <see cref="ApiKey"/> is never pre-populated from an off-mode read
/// (ADR-015 §I9) and an empty key is never forwarded (the server treats empty as an explicit clear). Pure
/// data — unit-tested without a UI host.
/// </summary>
public sealed record AiProviderDraft(
    string Provider,
    string BaseUrl,
    string Model,
    string ApiKey,
    long CostCapCents,
    string ApiVersion,
    string Flavor,
    string Deployment,
    string EmbeddingModel,
    string EmbeddingDeployment)
{
    /// <summary>An empty draft defaulting to the <c>ollama</c> provider (web first-run default).</summary>
    public static AiProviderDraft Empty { get; } = new(
        "ollama", string.Empty, string.Empty, string.Empty, 0,
        string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);
}

/// <summary>
/// The Helix slice of <c>GET /settings</c> the surface needs — the native analogue of the AI keys the web
/// <c>useSettings</c> hook reads (<c>ai_mode</c>, <c>ai_features</c>, <c>ai_provider_config</c>,
/// <c>ai_cost_cap_cents</c>, <c>ai_features_archived</c>). The full document JSON is retained so a save can
/// re-submit the whole single-document body (web <c>useSaveAiSettings</c> deep-merges the AI patch over the
/// cached document because <c>PUT /settings</c> is full-replace). Parsing is null-tolerant. Pure data.
/// </summary>
public sealed record AiSettingsSnapshot(
    AiMode Mode,
    IReadOnlyDictionary<string, bool> Features,
    IReadOnlyDictionary<string, bool> FeaturesArchived,
    long CostCapCents,
    string? ProviderConfigJson,
    string? DocumentJson)
{
    /// <summary>An empty snapshot (Helix off, no features) — the parse / projection fallback.</summary>
    public static AiSettingsSnapshot Empty { get; } = new(
        AiMode.Off, AiSettingsJson.EmptyBoolMap, AiSettingsJson.EmptyBoolMap, 0, null, null);

    /// <summary>True when the archived selection holds at least one restorable feature (web <c>archiveHasRestorableEntries</c>).</summary>
    public bool HasRestorableArchive
    {
        get
        {
            foreach (var value in FeaturesArchived.Values)
            {
                if (value)
                {
                    return true;
                }
            }

            return false;
        }
    }

    /// <summary>A stable signature of the Helix sub-tree (web <c>aiSnapshot</c>) — drives "reset local draft on document change".</summary>
    public string Signature() => string.Create(
        CultureInfo.InvariantCulture,
        $"{AiModes.Wire(Mode)}|{MapSignature(Features)}|{ProviderConfigJson ?? string.Empty}|{CostCapCents}");

    /// <summary>Parse a <c>GET /settings</c> JSON object into a tolerant Helix snapshot.</summary>
    public static AiSettingsSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new AiSettingsSnapshot(
            Mode: AiModes.Parse(AiSettingsJson.GetString(element, "ai_mode")),
            Features: AiSettingsJson.ReadBoolMap(element, "ai_features"),
            FeaturesArchived: AiSettingsJson.ReadBoolMap(element, "ai_features_archived"),
            CostCapCents: AiSettingsJson.GetLong(element, "ai_cost_cap_cents") ?? 0,
            ProviderConfigJson: AiSettingsJson.GetObjectRaw(element, "ai_provider_config"),
            DocumentJson: element.GetRawText());
    }

    private static string MapSignature(IReadOnlyDictionary<string, bool> map)
    {
        if (map.Count == 0)
        {
            return string.Empty;
        }

        var pairs = new List<string>(map.Count);
        foreach (var entry in map)
        {
            pairs.Add(string.Create(CultureInfo.InvariantCulture, $"{entry.Key}={entry.Value}"));
        }

        pairs.Sort(StringComparer.Ordinal);
        return string.Join(",", pairs);
    }
}

/// <summary>
/// Today's Helix spend slice of <c>GET /ai/usage/today</c> the cost-cap bar needs — the native analogue of
/// the web <c>AiUsageToday</c> (web/src/api/hooks/useAiUsage.ts). The backend stores spend in micro-cents
/// (1e-4 cent); an all-zeros payload is returned when nothing has been audited yet. Pure data.
/// </summary>
public sealed record AiUsageTodaySnapshot(long CostMicroCents)
{
    /// <summary>An empty usage snapshot (zero spend) — the parse fallback.</summary>
    public static AiUsageTodaySnapshot Empty { get; } = new(0);

    /// <summary>Parse a <c>GET /ai/usage/today</c> JSON object into a tolerant snapshot.</summary>
    public static AiUsageTodaySnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new AiUsageTodaySnapshot(AiSettingsJson.GetLong(element, "cost_micro_cents") ?? 0);
    }
}

/// <summary>
/// The projected, render-ready cost-cap spend bar — the native analogue of the web <c>AICostCapSpendBar</c>
/// inline component (web/src/features/settings/components/AISettings.tsx). Holds the localized title, the
/// "$today / $cap" amount (or a loading caption), the 0..100 fill percentage, the band <see cref="Level"/>
/// and its token brush key, the optional warn/critical hint and a Narrator name. Pure data.
/// </summary>
public sealed record AiCostCapDisplay(
    double Pct,
    double TodayDollars,
    double CapDollars,
    AiCostCapLevel Level,
    string AccentBrushKey,
    string AmountText,
    string TodayTitle,
    string BarLabel,
    string? Hint,
    string AutomationName);

/// <summary>
/// Pure projections from a parsed snapshot to the render-ready draft and cost-cap models — the native port of
/// the <c>useEffect</c> draft hydration, the provider/cost-cap derivation and the <c>AICostCapSpendBar</c>
/// math in web/src/features/settings/components/AISettings.tsx. <c>localizer</c> resolves every label through
/// the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AiSettingsProjection
{
    /// <summary>Hydrate the editable provider draft from a settings snapshot (web <c>useEffect</c> + first-render <c>useState</c>).</summary>
    public static AiProviderDraft InitProvider(AiSettingsSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        if (snapshot.ProviderConfigJson is not { } configJson)
        {
            return AiProviderDraft.Empty with { CostCapCents = snapshot.CostCapCents };
        }

        using var doc = ParseObjectOrNull(configJson);
        JsonElement cfg = doc?.RootElement ?? default;

        // F1 contract: the current provider name lives in `default` (legacy flat shape stored it as
        // `provider`; migration 000208 converts that on the next API boot, so fall back to it for the
        // unmigrated edge case).
        string providerName = NonEmptyOr(ReadString(cfg, "default"), ReadString(cfg, "provider", "ollama"));
        JsonElement entry = ReadObjectEntry(cfg, providerName) ?? cfg;

        return new AiProviderDraft(
            Provider: providerName,
            BaseUrl: ReadString(entry, "base_url"),
            Model: ReadString(entry, "model"),
            // ADR-015 §I9 — never surface the saved key when the server mode is off.
            ApiKey: snapshot.Mode == AiMode.Off ? string.Empty : ReadString(entry, "api_key"),
            CostCapCents: snapshot.CostCapCents,
            ApiVersion: ReadString(entry, "api_version"),
            Flavor: ReadString(entry, "flavor"),
            Deployment: ReadString(entry, "deployment"),
            EmbeddingModel: ReadString(entry, "embedding_model"),
            EmbeddingDeployment: ReadString(entry, "embedding_deployment"));
    }

    /// <summary>
    /// Reload the draft for a different provider on a provider switch (web <c>handleProviderChange</c>). Unlike
    /// <see cref="InitProvider"/> there is no <c>?? cfg</c> fallback: a provider with no saved entry yields blank
    /// fields, and the key is never pre-filled (the server redacts on read, and an empty key means "unchanged").
    /// </summary>
    public static AiProviderDraft SwitchProvider(AiSettingsSnapshot snapshot, string nextProvider, long costCapCents)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(nextProvider);

        using var doc = snapshot.ProviderConfigJson is { } json ? ParseObjectOrNull(json) : null;
        JsonElement entry = doc is null ? default : ReadObjectEntry(doc.RootElement, nextProvider) ?? default;

        return new AiProviderDraft(
            Provider: nextProvider,
            BaseUrl: ReadString(entry, "base_url"),
            Model: ReadString(entry, "model"),
            ApiKey: string.Empty,
            CostCapCents: costCapCents,
            ApiVersion: ReadString(entry, "api_version"),
            Flavor: ReadString(entry, "flavor"),
            Deployment: ReadString(entry, "deployment"),
            EmbeddingModel: ReadString(entry, "embedding_model"),
            EmbeddingDeployment: ReadString(entry, "embedding_deployment"));
    }

    /// <summary>Project today's usage + the cap into the render-ready spend bar (web <c>AICostCapSpendBar</c>).</summary>
    public static AiCostCapDisplay ProjectCostCap(
        long capCents,
        AiUsageTodaySnapshot? usage,
        bool usageLoading,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        long todayMicroCents = usage?.CostMicroCents ?? 0;
        long capMicroCents = capCents * 10_000; // 1 cent = 10_000 micro-cents
        double pct = capMicroCents > 0
            ? Math.Min(100, (double)todayMicroCents / capMicroCents * 100)
            : 0;
        double todayDollars = todayMicroCents / 1_000_000.0;
        double capDollars = capCents / 100.0;

        AiCostCapLevel level = pct >= 100
            ? AiCostCapLevel.Critical
            : pct >= 80
                ? AiCostCapLevel.Warn
                : AiCostCapLevel.Ok;

        string todayTitle = localizer.GetString("ai.settings.costCap.todayTitle", "Today\u2019s Helix spend");
        string barLabel = localizer.GetString("ai.settings.costCap.barLabel", "Helix cost cap usage");
        string amount = usageLoading
            ? localizer.GetString("ai.settings.costCap.loading", "Loading\u2026")
            : string.Format(
                CultureInfo.InvariantCulture,
                localizer.GetString("ai.settings.costCap.amount", "${0} / ${1}"),
                todayDollars.ToString("F2", CultureInfo.InvariantCulture),
                capDollars.ToString("F2", CultureInfo.InvariantCulture));

        string? hint = level switch
        {
            AiCostCapLevel.Critical => localizer.GetString(
                "ai.settings.costCap.criticalHint",
                "Cap reached \u2014 new Helix calls will be rejected until the cap resets at UTC midnight or you raise it."),
            AiCostCapLevel.Warn => localizer.GetString(
                "ai.settings.costCap.warnHint",
                "You are nearing today\u2019s cap. Calls will pause once you reach it."),
            _ => null,
        };

        string automationName = string.Format(CultureInfo.CurrentCulture, "{0}, {1}", barLabel, amount);

        return new AiCostCapDisplay(
            Pct: pct,
            TodayDollars: todayDollars,
            CapDollars: capDollars,
            Level: level,
            AccentBrushKey: StatusResources.AccentBrushKey(StatusFor(level)),
            AmountText: amount,
            TodayTitle: todayTitle,
            BarLabel: barLabel,
            Hint: hint,
            AutomationName: automationName);
    }

    /// <summary>Map a cost-cap band to its token status (web cyan/amber/rose → Info/Warning/Danger).</summary>
    public static StatusKind StatusFor(AiCostCapLevel level) => level switch
    {
        AiCostCapLevel.Warn => StatusKind.Warning,
        AiCostCapLevel.Critical => StatusKind.Danger,
        _ => StatusKind.Info,
    };

    private static string ReadString(JsonElement obj, string name, string fallback = "") =>
        AiSettingsJson.GetString(obj, name) ?? fallback;

    private static JsonElement? ReadObjectEntry(JsonElement cfg, string providerName)
    {
        if (cfg.ValueKind != JsonValueKind.Object
            || providerName.Length == 0
            || !cfg.TryGetProperty(providerName, out var entry)
            || entry.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return entry;
    }

    private static string NonEmptyOr(string primary, string fallback) =>
        primary.Length > 0 ? primary : fallback;

    private static JsonDocument? ParseObjectOrNull(string json)
    {
        try
        {
            var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                return doc;
            }

            doc.Dispose();
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// Builds the full <c>PUT /settings</c> body for a Helix save — the native port of <c>handleSave</c> +
/// <c>useSaveAiSettings</c> in web/src/features/settings/components/AISettings.tsx. <c>PUT /settings</c> is
/// full-replace, so the AI patch is merged over the current document (web <c>{ ...current, ...patch }</c>).
/// An off-mode save sends only <c>ai_mode</c> + an empty <c>ai_features</c> (ADR-015: the backend clears and
/// archives the prior selection and redacts the key, so we never leak the in-memory key over the wire). A
/// local/cloud save re-nests the provider config (F1 contract), stripping legacy top-level keys and emitting
/// optional / api-key fields only when non-empty. Pure — unit-tested without a network.
/// </summary>
public static class AiSettingsPatchBuilder
{
    private static readonly string[] LegacyTopLevelKeys = { "provider", "base_url", "model", "api_key" };

    /// <summary>Build the merged settings document to PUT for the given draft.</summary>
    public static JsonObject BuildSaveDocument(
        AiMode mode,
        IReadOnlyDictionary<string, bool> features,
        AiProviderDraft provider,
        string? documentJson)
    {
        ArgumentNullException.ThrowIfNull(features);
        ArgumentNullException.ThrowIfNull(provider);

        JsonObject document = ParseObjectOrEmpty(documentJson);

        if (mode == AiMode.Off)
        {
            document["ai_mode"] = "off";
            document["ai_features"] = new JsonObject();
            return document;
        }

        var currentConfig = document["ai_provider_config"] as JsonObject;

        document["ai_mode"] = AiModes.Wire(mode);
        document["ai_features"] = BoolMapToJson(features);
        document["ai_provider_config"] = BuildProviderConfig(provider, currentConfig);
        document["ai_cost_cap_cents"] = JsonValue.Create(provider.CostCapCents);
        return document;
    }

    /// <summary>
    /// Build a lighter <c>{ ai_mode, ai_features }</c> merge document (web <c>handleRestoreConfirm</c>'s
    /// save) — the provider config and cost cap stay at their current values because the patch omits them.
    /// </summary>
    public static JsonObject BuildFeaturesDocument(
        AiMode mode,
        IReadOnlyDictionary<string, bool> features,
        string? documentJson)
    {
        ArgumentNullException.ThrowIfNull(features);

        JsonObject document = ParseObjectOrEmpty(documentJson);
        document["ai_mode"] = AiModes.Wire(mode);
        document["ai_features"] = BoolMapToJson(features);
        return document;
    }

    private static JsonObject BuildProviderConfig(AiProviderDraft provider, JsonObject? current)
    {
        var result = new JsonObject();

        // stripLegacyTopLevelKeys — defense-in-depth against an export/import round-trip that kept the
        // pre-fix flat keys at the top level (migration 000208 handles this at rest).
        if (current is not null)
        {
            foreach (var pair in current)
            {
                if (Array.IndexOf(LegacyTopLevelKeys, pair.Key) >= 0)
                {
                    continue;
                }

                result[pair.Key] = pair.Value?.DeepClone();
            }
        }

        result["default"] = provider.Provider;

        var entry = new JsonObject();
        if (current?[provider.Provider] is JsonObject existing)
        {
            foreach (var pair in existing)
            {
                entry[pair.Key] = pair.Value?.DeepClone();
            }
        }

        entry["base_url"] = provider.BaseUrl;
        entry["model"] = provider.Model;
        SetIfPresent(entry, "api_version", provider.ApiVersion);
        SetIfPresent(entry, "flavor", provider.Flavor);
        SetIfPresent(entry, "deployment", provider.Deployment);
        SetIfPresent(entry, "embedding_model", provider.EmbeddingModel);
        SetIfPresent(entry, "embedding_deployment", provider.EmbeddingDeployment);
        // Only forward a non-empty key; an empty string would clobber a previously-saved key.
        SetIfPresent(entry, "api_key", provider.ApiKey);

        result[provider.Provider] = entry;
        return result;
    }

    private static void SetIfPresent(JsonObject target, string key, string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            target[key] = value;
        }
    }

    private static JsonObject BoolMapToJson(IReadOnlyDictionary<string, bool> features)
    {
        var obj = new JsonObject();
        foreach (var pair in features)
        {
            obj[pair.Key] = JsonValue.Create(pair.Value);
        }

        return obj;
    }

    private static JsonObject ParseObjectOrEmpty(string? documentJson)
    {
        if (string.IsNullOrWhiteSpace(documentJson))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(documentJson) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }
}

/// <summary>
/// The outcome of a single Helix save — the native analogue of the web mutation resolving. On success it
/// carries the re-parsed <see cref="Snapshot"/> from the <c>PUT /settings</c> response (web parity: the hook
/// merges the returned document back into the cache); on an HTTP fault it carries a classified
/// <see cref="Error"/> rather than throwing.
/// </summary>
public sealed record AiSettingsSaveOutcome(bool Success, AiSettingsSnapshot? Snapshot, RepositoryError? Error)
{
    /// <summary>A successful save carrying the server's new settings snapshot.</summary>
    public static AiSettingsSaveOutcome Ok(AiSettingsSnapshot snapshot) => new(true, snapshot, null);

    /// <summary>A classified failure.</summary>
    public static AiSettingsSaveOutcome Fail(RepositoryError error) => new(false, null, error);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> settings emissions to typed
/// <c>RepositoryResult&lt;AiSettingsSnapshot&gt;</c>, preserving the cache-then-network status/freshness while
/// parsing the snake_case payload. A value-bearing status always carries the parsed snapshot. Pure.
/// </summary>
public static class AiSettingsResultMapper
{
    /// <summary>Map a raw settings emission to a typed snapshot result.</summary>
    public static RepositoryResult<AiSettingsSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<AiSettingsSnapshot>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<AiSettingsSnapshot>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<AiSettingsSnapshot>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var snapshot = AiSettingsSnapshot.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<AiSettingsSnapshot>.Cached(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AiSettingsSnapshot>.Refreshing(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<AiSettingsSnapshot>.OfflineCached(
                snapshot, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<AiSettingsSnapshot>.Loaded(snapshot, fetchedAt),
        };
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> usage emissions to typed
/// <c>RepositoryResult&lt;AiUsageTodaySnapshot&gt;</c>, preserving the cache-then-network status while parsing
/// the snake_case payload. Pure.
/// </summary>
public static class AiUsageSnapshotResultMapper
{
    /// <summary>Map a raw usage emission to a typed snapshot result.</summary>
    public static RepositoryResult<AiUsageTodaySnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<AiUsageTodaySnapshot>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<AiUsageTodaySnapshot>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<AiUsageTodaySnapshot>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var snapshot = AiUsageTodaySnapshot.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<AiUsageTodaySnapshot>.Cached(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AiUsageTodaySnapshot>.Refreshing(snapshot, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<AiUsageTodaySnapshot>.OfflineCached(
                snapshot, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<AiUsageTodaySnapshot>.Loaded(snapshot, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Helix settings surface — the native mirror of the web AISettings panel
/// (web/src/features/settings/components/AISettings.tsx). Centralises the stable id, the diagnostics slug, and
/// the localized title/subtitle so the view and view-model stay free of literal copy.
/// </summary>
public static class AiSettingsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "ai-settings-panel";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AISettings";

    /// <summary>Localized panel title (web <c>ai.settings.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("ai.settings.title", "Helix");

    /// <summary>Localized panel subtitle (web <c>ai.settings.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "ai.settings.subtitle",
            "Optional. Helix is off by default; nothing is enabled until you opt in here.");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the Helix settings surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a mode, provider name, key or feature id
/// — so a diagnostics line can never leak operator-specific Helix configuration. Thread-safe.
/// </summary>
public sealed class AiSettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AiSettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AISettings</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AiSettingsRegistration.Slug}");
    }
}
