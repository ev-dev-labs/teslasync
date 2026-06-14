using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The runtime type of a live signal value — the native union of the web
/// <c>'number' | 'string' | 'boolean'</c> discriminator the tail derives with its <c>detectType</c>
/// helper (web/src/features/telemetry/hooks/useLiveSignalStream.ts). Drives both the Type-column chip
/// colour and the value-cell accent exactly as the web <c>TYPE_VALUE_COLOR</c> map does. Pure data.
/// </summary>
public enum SignalEntryType
{
    /// <summary>A numeric value (web <c>'number'</c>).</summary>
    Number,

    /// <summary>A textual value (web <c>'string'</c>) — also the fallback for null / compound values.</summary>
    Text,

    /// <summary>A boolean value (web <c>'boolean'</c>).</summary>
    Boolean,
}

/// <summary>
/// One signal extracted from a live <c>vehicle_update</c> batch before it is buffered — the native
/// analogue of the per-event push the web tail builds inside <c>handleVehicleUpdate</c>
/// (web/src/features/telemetry/hooks/useLiveSignalStream.ts) before assigning it a monotonically
/// increasing id. Pure data produced by <see cref="LiveSignalTailParser"/>.
/// </summary>
/// <param name="Name">The signal name (web <c>name</c>).</param>
/// <param name="Value">The already-rendered display value (web <c>String(value)</c>).</param>
/// <param name="Type">The detected runtime type (web <c>detectType(value)</c>).</param>
/// <param name="Timestamp">The batch timestamp (web <c>ts = data.timestamp ?? now</c>).</param>
public sealed record ParsedTailSignal(string Name, string Value, SignalEntryType Type, DateTimeOffset Timestamp);

/// <summary>
/// One buffered tail row — a <see cref="ParsedTailSignal"/> stamped with the monotonic id the web tail
/// assigns from <c>tailIdRef</c> so each row has a stable React-style key. Pure data.
/// </summary>
/// <param name="Id">The monotonic row id (web <c>tailIdRef.current</c>).</param>
/// <param name="Name">The signal name.</param>
/// <param name="Value">The rendered display value.</param>
/// <param name="Type">The detected runtime type.</param>
/// <param name="Timestamp">The batch timestamp.</param>
public sealed record SignalTailEntry(long Id, string Name, string Value, SignalEntryType Type, DateTimeOffset Timestamp);

/// <summary>
/// Null-tolerant parser that turns one decoded <c>vehicle_update</c> payload into the flat list of tail
/// rows the web hook derives — the native port of <c>handleVehicleUpdate</c>'s firehose branch
/// (web/src/features/telemetry/hooks/useLiveSignalStream.ts). It honours the same vehicle-scope filter
/// (events for other vehicles are dropped; system events with no <c>vehicle_id</c> pass through), the same
/// three payload shapes — a <c>cold</c> array of <c>{ name, value }</c>, a <c>tables</c> map of column
/// objects, or a bare <c>signals</c> map (falling back to the payload itself) — and the same
/// <c>detectType</c> / <c>String(value)</c> coercion. No WinUI types: unit-tested without a UI host.
/// </summary>
public static class LiveSignalTailParser
{
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.Ordinal) { "timestamp", "vehicle_id", "ts" };

    /// <summary>
    /// Extract every tail row from one <c>vehicle_update</c> <paramref name="data"/> payload, scoped to
    /// <paramref name="selectedVehicleId"/> (0 = all). <paramref name="fallbackTimestamp"/> is used when the
    /// payload carries no parseable <c>timestamp</c> (web <c>data.timestamp ?? new Date().toISOString()</c>).
    /// </summary>
    public static IReadOnlyList<ParsedTailSignal> Extract(
        JsonElement data,
        long selectedVehicleId,
        DateTimeOffset fallbackTimestamp)
    {
        if (data.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<ParsedTailSignal>();
        }

        if (selectedVehicleId > 0 && !MatchesVehicle(data, selectedVehicleId))
        {
            return Array.Empty<ParsedTailSignal>();
        }

        DateTimeOffset ts = ReadTimestamp(data, fallbackTimestamp);
        var rows = new List<ParsedTailSignal>();

        bool hasCold = data.TryGetProperty("cold", out var cold) && cold.ValueKind == JsonValueKind.Array;
        bool hasTables = data.TryGetProperty("tables", out var tables) && tables.ValueKind == JsonValueKind.Object;

        if (hasCold)
        {
            foreach (var item in cold.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object
                    && item.TryGetProperty("name", out var name)
                    && name.ValueKind == JsonValueKind.String
                    && item.TryGetProperty("value", out var value))
                {
                    string? signal = name.GetString();
                    if (!string.IsNullOrEmpty(signal))
                    {
                        rows.Add(new ParsedTailSignal(signal, RenderValue(value), DetectType(value), ts));
                    }
                }
            }
        }

        if (hasTables)
        {
            foreach (var table in tables.EnumerateObject())
            {
                if (table.Value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                foreach (var column in table.Value.EnumerateObject())
                {
                    rows.Add(new ParsedTailSignal(column.Name, RenderValue(column.Value), DetectType(column.Value), ts));
                }
            }
        }

        if (!hasCold && !hasTables)
        {
            JsonElement signals = data.TryGetProperty("signals", out var inner) && inner.ValueKind != JsonValueKind.Null
                ? inner
                : data;

            if (signals.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in signals.EnumerateObject())
                {
                    if (ReservedKeys.Contains(property.Name))
                    {
                        continue;
                    }

                    if (property.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                    {
                        continue;
                    }

                    rows.Add(new ParsedTailSignal(
                        property.Name,
                        RenderValue(property.Value),
                        DetectType(property.Value),
                        ts));
                }
            }
        }

        return rows;
    }

    /// <summary>The detected runtime type of a JSON value (web <c>detectType</c>): booleans and numbers are
    /// special-cased, everything else (strings, null, compound) is <see cref="SignalEntryType.Text"/>.</summary>
    public static SignalEntryType DetectType(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True or JsonValueKind.False => SignalEntryType.Boolean,
        JsonValueKind.Number => SignalEntryType.Number,
        _ => SignalEntryType.Text,
    };

    /// <summary>Coerce a JSON value to its display string (web <c>String(value)</c>), never throwing: null
    /// renders the literal "null", numbers / booleans render their literal text, and any compound value
    /// renders as compact JSON so a typed object never crashes the cell.</summary>
    public static string RenderValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        JsonValueKind.Object or JsonValueKind.Array => value.GetRawText(),
        _ => string.Empty,
    };

    /// <summary>The wire type token the Type column renders (web renders <c>entry.type</c> verbatim).</summary>
    public static string WireLabel(SignalEntryType type) => type switch
    {
        SignalEntryType.Number => "number",
        SignalEntryType.Boolean => "boolean",
        _ => "string",
    };

    private static bool MatchesVehicle(JsonElement data, long selectedVehicleId)
    {
        if (!data.TryGetProperty("vehicle_id", out var vehicleId))
        {
            // System events without a vehicle_id pass through (web parity).
            return true;
        }

        return vehicleId.ValueKind switch
        {
            JsonValueKind.Number => !vehicleId.TryGetInt64(out long n) || n == selectedVehicleId,
            JsonValueKind.String => !long.TryParse(vehicleId.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) || s == selectedVehicleId,
            _ => true,
        };
    }

    private static DateTimeOffset ReadTimestamp(JsonElement data, DateTimeOffset fallback)
    {
        if (data.TryGetProperty("timestamp", out var ts)
            && ts.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(
                ts.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return parsed;
        }

        return fallback;
    }
}

/// <summary>
/// The lifecycle state of the live tail body. Every branch renders a visible surface — none is hidden
/// (engineering rule #6). The web tail shows its waiting / no-match empty copy inside a <c>DataTable</c>;
/// the native surface additionally renders an explicit <see cref="Loading"/> (connecting shimmer) and
/// <see cref="Error"/> (retry) branch, a strict superset of the web that satisfies the prompt's mandated
/// loading / empty / error state set for the live SSE source.
/// </summary>
public enum LiveSignalMonitorBodyState
{
    /// <summary>The stream is establishing its first connection and nothing has streamed yet — the shimmer.</summary>
    Loading,

    /// <summary>The stream is attached but no signal has arrived yet — the "Waiting for signals…" empty state.</summary>
    Empty,

    /// <summary>At least one signal has streamed — the scrolling table (with its own filtered-empty copy).</summary>
    Streaming,

    /// <summary>The stream failed and could not recover — the retry affordance.</summary>
    Error,
}

/// <summary>
/// One projected, render-ready tail row — the parsed <see cref="SignalTailEntry"/> plus its wire type
/// token and a Narrator name composed from the localized column labels. Pure data.
/// </summary>
/// <param name="Id">The stable row key.</param>
/// <param name="Name">The signal name.</param>
/// <param name="Value">The rendered display value.</param>
/// <param name="Type">The detected runtime type (drives the chip / value accent).</param>
/// <param name="TypeLabel">The wire type token rendered in the Type column.</param>
/// <param name="Timestamp">The batch timestamp (drives the Time + Freshness cells).</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record LiveSignalMonitorDisplayEntry(
    long Id,
    string Name,
    string Value,
    SignalEntryType Type,
    string TypeLabel,
    DateTimeOffset Timestamp,
    string AutomationName);

/// <summary>
/// The render-time model the <c>LiveSignalMonitorPage</c> projects from — the native analogue of the web
/// page + tail hook state (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx +
/// useLiveSignalStream.ts). Pure data (no WinUI types) so the projection is unit-tested headlessly.
/// </summary>
/// <param name="VehicleId">The selected vehicle id (web <c>useSelectedVehicle</c>); 0 = none/all.</param>
/// <param name="Connected">The SSE connection state (web <c>live.connected</c>).</param>
/// <param name="Connecting">True while the first connection is being established (drives the shimmer).</param>
/// <param name="Errored">True when the stream failed unrecoverably (drives the error branch).</param>
/// <param name="Paused">Whether the tail is paused (web <c>live.tailPaused</c>).</param>
/// <param name="AutoScroll">Whether auto-scroll is on (web local <c>autoScroll</c>).</param>
/// <param name="Filter">The signal-name filter (web local <c>filter</c>).</param>
/// <param name="Entries">The newest-first buffered rows (web <c>live.tailEntries</c>).</param>
/// <param name="Rate">Signals/sec over the last second (web <c>live.tailRate</c>).</param>
/// <param name="BufferMax">The buffer cap shown in the Buffer-Size stat (web <c>TAIL_MAX</c> = 500).</param>
public sealed record LiveSignalMonitorModel(
    long VehicleId,
    bool Connected,
    bool Connecting,
    bool Errored,
    bool Paused,
    bool AutoScroll,
    string Filter,
    IReadOnlyList<SignalTailEntry> Entries,
    int Rate,
    int BufferMax);

/// <summary>
/// The fully projected, render-ready view of the Live Signal Monitor — every label, stat value, column
/// header, data-state flag and the filtered tail rows the web derives with its <c>useMemo</c> chain. The
/// view binds to this and performs no logic of its own. Pure data.
/// </summary>
public sealed record LiveSignalMonitorDisplay
{
    /// <summary>The page title (web <c>liveMonitor.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The page subtitle (web <c>liveMonitor.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The connection badge text (web <c>liveMonitor.connected</c> / <c>.disconnected</c>).</summary>
    public required string ConnectionLabel { get; init; }

    /// <summary>Whether the connection badge reads "Connected".</summary>
    public required bool Connected { get; init; }

    /// <summary>The filter field hint text (web filter input).</summary>
    public required string FilterHint { get; init; }

    /// <summary>The filter field accessible name (web <c>liveMonitor.filterLabel</c>).</summary>
    public required string FilterAria { get; init; }

    /// <summary>The pause/resume button text (web <c>liveMonitor.pause</c> / <c>.resume</c>).</summary>
    public required string PauseLabel { get; init; }

    /// <summary>Whether the tail is currently paused (drives the pause glyph).</summary>
    public required bool Paused { get; init; }

    /// <summary>The auto-scroll button text (web <c>liveMonitor.autoScroll</c>).</summary>
    public required string AutoScrollLabel { get; init; }

    /// <summary>Whether auto-scroll is on (drives the active button accent).</summary>
    public required bool AutoScroll { get; init; }

    /// <summary>The clear button text (web <c>liveMonitor.clear</c>).</summary>
    public required string ClearLabel { get; init; }

    /// <summary>The signals/sec stat label (web <c>liveMonitor.sigPerSec</c>).</summary>
    public required string RateLabel { get; init; }

    /// <summary>The signals/sec stat value.</summary>
    public required string RateValue { get; init; }

    /// <summary>The buffer-size stat label (web <c>liveMonitor.bufferSize</c>).</summary>
    public required string BufferLabel { get; init; }

    /// <summary>The buffer-size stat value (the current count).</summary>
    public required string BufferValue { get; init; }

    /// <summary>The buffer-size stat sub-line (web <c>/ {bufferMax}</c>).</summary>
    public required string BufferSublabel { get; init; }

    /// <summary>The unique-signals stat label (web <c>liveMonitor.uniqueSignals</c>).</summary>
    public required string UniqueLabel { get; init; }

    /// <summary>The unique-signals stat value.</summary>
    public required string UniqueValue { get; init; }

    /// <summary>The filtered stat label (web <c>liveMonitor.filtered</c>).</summary>
    public required string FilteredLabel { get; init; }

    /// <summary>The filtered stat value (rows matching the filter).</summary>
    public required string FilteredValue { get; init; }

    /// <summary>The Time column header (web <c>liveMonitor.time</c>).</summary>
    public required string TimeHeader { get; init; }

    /// <summary>The Signal column header (web <c>liveMonitor.signal</c>).</summary>
    public required string SignalHeader { get; init; }

    /// <summary>The Value column header (web <c>liveMonitor.value</c>).</summary>
    public required string ValueHeader { get; init; }

    /// <summary>The Type column header (web <c>liveMonitor.type</c>).</summary>
    public required string TypeHeader { get; init; }

    /// <summary>The Freshness column header (web <c>liveMonitor.freshness</c>).</summary>
    public required string FreshnessHeader { get; init; }

    /// <summary>The waiting empty-state copy (web <c>liveMonitor.waiting</c>).</summary>
    public required string WaitingMessage { get; init; }

    /// <summary>The filtered-empty in-table copy (web <c>liveMonitor.noMatch</c>).</summary>
    public required string NoMatchMessage { get; init; }

    /// <summary>The loading shimmer announce copy.</summary>
    public required string LoadingLabel { get; init; }

    /// <summary>The error-state title.</summary>
    public required string ErrorTitle { get; init; }

    /// <summary>The error-state retry button text.</summary>
    public required string RetryLabel { get; init; }

    /// <summary>The active body state (loading / empty / streaming / error).</summary>
    public required LiveSignalMonitorBodyState BodyState { get; init; }

    /// <summary>True when there are rows but none match the filter (the in-table no-match copy).</summary>
    public required bool ShowNoMatch { get; init; }

    /// <summary>The filtered, newest-first rows the table renders.</summary>
    public required IReadOnlyList<LiveSignalMonitorDisplayEntry> Entries { get; init; }

    /// <summary>The composed accessible name for the surface (the title).</summary>
    public required string AutomationName { get; init; }
}

/// <summary>
/// Pure projection from <see cref="LiveSignalMonitorModel"/> to <see cref="LiveSignalMonitorDisplay"/> — the
/// native port of the web tail's <c>filtered</c> / <c>uniqueSignals</c> <c>useMemo</c> chain and every
/// inline <c>t(key, default)</c> call across the page + tail
/// (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx +
/// web/src/features/telemetry/components/LiveSignalTail.tsx). Every one of the page's i18n keys is resolved
/// on every call — regardless of state — so a single headless projection asserts the whole manifest set.
/// No WinUI types.
/// </summary>
public static class LiveSignalMonitorProjection
{
    /// <summary>Project the model into its render-ready display, resolving every label through <paramref name="localizer"/>.</summary>
    public static LiveSignalMonitorDisplay Project(LiveSignalMonitorModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string query = model.Filter.Trim();
        IReadOnlyList<SignalTailEntry> filtered = query.Length == 0
            ? model.Entries
            : model.Entries.Where(e => e.Name.Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();

        int uniqueSignals = model.Entries.Select(e => e.Name).Distinct(StringComparer.Ordinal).Count();

        string connectedLabel = localizer.GetString("liveMonitor.connected", "Connected");
        string disconnectedLabel = localizer.GetString("liveMonitor.disconnected", "Disconnected");
        string pauseLabel = localizer.GetString("liveMonitor.pause", "Pause");
        string resumeLabel = localizer.GetString("liveMonitor.resume", "Resume");

        string timeHeader = localizer.GetString("liveMonitor.time", "Time");
        string valueHeader = localizer.GetString("liveMonitor.value", "Value");
        string typeHeader = localizer.GetString("liveMonitor.type", "Type");
        string freshnessHeader = localizer.GetString("liveMonitor.freshness", "Freshness");

        LiveSignalMonitorBodyState bodyState = ResolveBodyState(model);

        var entries = new List<LiveSignalMonitorDisplayEntry>(filtered.Count);
        foreach (var entry in filtered)
        {
            entries.Add(new LiveSignalMonitorDisplayEntry(
                entry.Id,
                entry.Name,
                entry.Value,
                entry.Type,
                LiveSignalTailParser.WireLabel(entry.Type),
                entry.Timestamp,
                AutomationName(entry, valueHeader, typeHeader, freshnessHeader)));
        }

        string title = localizer.GetString("liveMonitor.title", "Live Signal Monitor");

        return new LiveSignalMonitorDisplay
        {
            Title = title,
            Subtitle = localizer.GetString("liveMonitor.subtitle", "Real-time scrolling view of incoming vehicle signals"),
            ConnectionLabel = model.Connected ? connectedLabel : disconnectedLabel,
            Connected = model.Connected,

            FilterHint = localizer.GetString("liveMonitor.filterPlaceholder", "Filter by signal name..."), // parity:allow web i18n key liveMonitor.filterPlaceholder (web LiveSignalTail.tsx)
            FilterAria = localizer.GetString("liveMonitor.filterLabel", "Filter signals"),

            PauseLabel = model.Paused ? resumeLabel : pauseLabel,
            Paused = model.Paused,
            AutoScrollLabel = localizer.GetString("liveMonitor.autoScroll", "Auto-scroll"),
            AutoScroll = model.AutoScroll,
            ClearLabel = localizer.GetString("liveMonitor.clear", "Clear"),

            RateLabel = localizer.GetString("liveMonitor.sigPerSec", "Signals / sec"),
            RateValue = FmtInt(model.Rate),
            BufferLabel = localizer.GetString("liveMonitor.bufferSize", "Buffer Size"),
            BufferValue = FmtInt(model.Entries.Count),
            BufferSublabel = string.Create(CultureInfo.CurrentCulture, $"/ {FmtInt(model.BufferMax)}"),
            UniqueLabel = localizer.GetString("liveMonitor.uniqueSignals", "Unique Signals"),
            UniqueValue = FmtInt(uniqueSignals),
            FilteredLabel = localizer.GetString("liveMonitor.filtered", "Filtered"),
            FilteredValue = FmtInt(filtered.Count),

            TimeHeader = timeHeader,
            SignalHeader = localizer.GetString("liveMonitor.signal", "Signal"),
            ValueHeader = valueHeader,
            TypeHeader = typeHeader,
            FreshnessHeader = freshnessHeader,

            WaitingMessage = localizer.GetString("liveMonitor.waiting", "Waiting for signals\u2026"),
            NoMatchMessage = localizer.GetString("liveMonitor.noMatch", "No signals match filter"),
            LoadingLabel = localizer.GetString("liveMonitor.waiting", "Waiting for signals\u2026"),
            ErrorTitle = localizer.GetString("error.loadFailed", "Failed to load data"),
            RetryLabel = localizer.GetString("error.retry", "Retry"),

            BodyState = bodyState,
            ShowNoMatch = bodyState == LiveSignalMonitorBodyState.Streaming && entries.Count == 0,
            Entries = entries,

            AutomationName = title,
        };
    }

    /// <summary>The active body state for a model: error wins, then any streamed rows, then the connecting
    /// shimmer (nothing yet), then the waiting empty state.</summary>
    public static LiveSignalMonitorBodyState ResolveBodyState(LiveSignalMonitorModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        if (model.Errored)
        {
            return LiveSignalMonitorBodyState.Error;
        }

        if (model.Entries.Count > 0)
        {
            return LiveSignalMonitorBodyState.Streaming;
        }

        return model.Connecting ? LiveSignalMonitorBodyState.Loading : LiveSignalMonitorBodyState.Empty;
    }

    /// <summary>Format an integer with locale grouping — the native port of the web number rendering.</summary>
    public static string FmtInt(long value) => value.ToString("N0", CultureInfo.CurrentCulture);

    private static string AutomationName(
        SignalTailEntry entry,
        string valueLabel,
        string typeLabel,
        string freshnessLabel)
    {
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}: {2}, {3}: {4}, {5}",
            entry.Name,
            valueLabel,
            entry.Value,
            typeLabel,
            LiveSignalTailParser.WireLabel(entry.Type),
            freshnessLabel);
    }
}

/// <summary>
/// Canonical registry metadata for the <c>LiveSignalMonitorPage</c> surface — the stable navigation route
/// name (so the shell page factory binds <c>/live-monitor</c> to this view) and the diagnostics slug.
/// Centralised so the view, view-model and feed stay free of literal identifiers.
/// </summary>
public static class LiveSignalMonitorRegistration
{
    /// <summary>The navigation route name (matches RouteTable.cs <c>Page("LiveSignalMonitor","live-monitor",…)</c>).</summary>
    public const string RouteName = "LiveSignalMonitor";

    /// <summary>The diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveSignalMonitorPage";

    /// <summary>The buffer cap the tail keeps (web <c>TAIL_MAX</c>).</summary>
    public const int TailMax = 500;
}

/// <summary>
/// PII-safe diagnostics for the <c>LiveSignalMonitorPage</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a signal name, value or
/// vehicle id — so a diagnostics line can never leak which vehicle or telemetry value streamed. Thread-safe.
/// </summary>
public sealed class LiveSignalMonitorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveSignalMonitorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveSignalMonitorPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveSignalMonitorRegistration.Slug}");
    }
}
