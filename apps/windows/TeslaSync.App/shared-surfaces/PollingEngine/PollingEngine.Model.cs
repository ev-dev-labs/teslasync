using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n catalog keys for the PollingEngine shared surface — the native mirror of the
/// module-level constants and the <c>t('…')</c> call sites in
/// <c>web/src/components/data-display/PollingEngine.tsx</c>. Every user-facing string the web component renders
/// is registered here as a P1/S10 catalog key plus its verbatim English fallback so the native surface resolves
/// the exact same key through the <see cref="ILocalizer"/> facade. The eight <c>translation.polling.*</c> keys the
/// web wraps in <c>t()</c> exist verbatim in <c>Strings/{en,ar,he}/Resources.resw</c>; the remaining keys cover
/// strings the web hardcodes and are namespaced under <c>translation.polling.*</c> (or reuse a shared
/// <c>translation.common.*</c> key) with the literal English the web shows as the fallback.
/// </summary>
public static class PollingEngineRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PollingEngine";

    /// <summary>The UI-automation id mirroring the web panel's stable identity.</summary>
    public const string RootAutomationId = "polling-engine-root";

    /// <summary>The <c>GET /polling/status</c> route (no version prefix — the client adds <c>/api/v1</c>).</summary>
    public const string StatusPath = "polling/status";

    /// <summary>The <c>GET /polling/savings</c> route (no version prefix — the client adds <c>/api/v1</c>).</summary>
    public const string SavingsPath = "polling/savings";

    // ── savings card — the eight web t() keys (present verbatim in Resources.resw) ───────────────────────────

    /// <summary>"Polls Saved" metric label key (web <c>polling.pollsSaved</c>).</summary>
    public const string PollsSavedKey = "translation.polling.pollsSaved";

    /// <summary>English fallback for <see cref="PollsSavedKey"/>.</summary>
    public const string PollsSavedFallback = "Polls Saved";

    /// <summary>"$ Saved" metric label key (web <c>polling.savedAmount</c>).</summary>
    public const string SavedAmountKey = "translation.polling.savedAmount";

    /// <summary>English fallback for <see cref="SavedAmountKey"/>.</summary>
    public const string SavedAmountFallback = "$ Saved";

    /// <summary>"Polls Made" metric label key (web <c>polling.pollsMade</c>).</summary>
    public const string PollsMadeKey = "translation.polling.pollsMade";

    /// <summary>English fallback for <see cref="PollsMadeKey"/>.</summary>
    public const string PollsMadeFallback = "Polls Made";

    /// <summary>"Credit Left" metric label key (web <c>polling.creditLeft</c>).</summary>
    public const string CreditLeftKey = "translation.polling.creditLeft";

    /// <summary>English fallback for <see cref="CreditLeftKey"/>.</summary>
    public const string CreditLeftFallback = "Credit Left";

    /// <summary>"Fleet Telemetry" breakdown label key (web <c>polling.fleetTelemetry</c>).</summary>
    public const string FleetTelemetryKey = "translation.polling.fleetTelemetry";

    /// <summary>English fallback for <see cref="FleetTelemetryKey"/>.</summary>
    public const string FleetTelemetryFallback = "Fleet Telemetry";

    /// <summary>"Idle Detection" breakdown label key (web <c>polling.idleDetection</c>).</summary>
    public const string IdleDetectionKey = "translation.polling.idleDetection";

    /// <summary>English fallback for <see cref="IdleDetectionKey"/>.</summary>
    public const string IdleDetectionFallback = "Idle Detection";

    /// <summary>"Prediction" breakdown label key (web <c>polling.prediction</c>).</summary>
    public const string PredictionKey = "translation.polling.prediction";

    /// <summary>English fallback for <see cref="PredictionKey"/>.</summary>
    public const string PredictionFallback = "Prediction";

    /// <summary>"Sleep" breakdown label key (web <c>polling.sleep</c>).</summary>
    public const string SleepKey = "translation.polling.sleep";

    /// <summary>English fallback for <see cref="SleepKey"/>.</summary>
    public const string SleepFallback = "Sleep";

    // ── chrome strings the web hardcodes (surface-namespaced keys + verbatim fallbacks) ──────────────────────

    /// <summary>Panel heading key (web literal "Adaptive Polling Engine").</summary>
    public const string TitleKey = "translation.polling.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Adaptive Polling Engine";

    /// <summary>"Active" status-chip key (shared common key; web literal "Active").</summary>
    public const string ActiveKey = "translation.common.active";

    /// <summary>English fallback for <see cref="ActiveKey"/>.</summary>
    public const string ActiveFallback = "Active";

    /// <summary>"Vehicle Activity" section-title key (web literal "Vehicle Activity").</summary>
    public const string VehicleActivityKey = "translation.polling.vehicleActivity";

    /// <summary>English fallback for <see cref="VehicleActivityKey"/>.</summary>
    public const string VehicleActivityFallback = "Vehicle Activity";

    /// <summary>Empty-state message key (web literal "No vehicles tracked yet…").</summary>
    public const string NoVehiclesKey = "translation.polling.noVehicles";

    /// <summary>English fallback for <see cref="NoVehiclesKey"/>.</summary>
    public const string NoVehiclesFallback = "No vehicles tracked yet. Polling engine will activate on first poll.";

    /// <summary>"Next" next-poll label key (web literal "Next:").</summary>
    public const string NextKey = "translation.polling.next";

    /// <summary>English fallback for <see cref="NextKey"/>.</summary>
    public const string NextFallback = "Next";

    /// <summary>"Interval" detail label key (web literal "Interval:").</summary>
    public const string IntervalKey = "translation.polling.interval";

    /// <summary>English fallback for <see cref="IntervalKey"/>.</summary>
    public const string IntervalFallback = "Interval";

    /// <summary>"Consecutive idle" detail label key (web literal "Consecutive idle:").</summary>
    public const string ConsecutiveIdleKey = "translation.polling.consecutiveIdle";

    /// <summary>English fallback for <see cref="ConsecutiveIdleKey"/>.</summary>
    public const string ConsecutiveIdleFallback = "Consecutive idle";

    /// <summary>"Battery" detail label key (web literal "Battery:").</summary>
    public const string BatteryKey = "translation.polling.battery";

    /// <summary>English fallback for <see cref="BatteryKey"/>.</summary>
    public const string BatteryFallback = "Battery";

    /// <summary>"Based on" prediction-source label key (web literal "Based on:").</summary>
    public const string BasedOnKey = "translation.polling.basedOn";

    /// <summary>English fallback for <see cref="BasedOnKey"/>.</summary>
    public const string BasedOnFallback = "Based on";

    /// <summary>Confidence-suffix label key (web literal "conf").</summary>
    public const string ConfidenceKey = "translation.polling.confidence";

    /// <summary>English fallback for <see cref="ConfidenceKey"/>.</summary>
    public const string ConfidenceFallback = "conf";

    // ── profile labels (web profileLabel switch) ─────────────────────────────────────────────────────────────

    /// <summary>"Driving" profile label key (web <c>profileLabel('driving')</c>).</summary>
    public const string ProfileDrivingKey = "translation.polling.profile.driving";

    /// <summary>English fallback for <see cref="ProfileDrivingKey"/>.</summary>
    public const string ProfileDrivingFallback = "Driving";

    /// <summary>"Charging" profile label key (web <c>profileLabel('charging')</c>).</summary>
    public const string ProfileChargingKey = "translation.polling.profile.charging";

    /// <summary>English fallback for <see cref="ProfileChargingKey"/>.</summary>
    public const string ProfileChargingFallback = "Charging";

    /// <summary>"Idle" profile label key (web <c>profileLabel('idle')</c>).</summary>
    public const string ProfileIdleKey = "translation.polling.profile.idle";

    /// <summary>English fallback for <see cref="ProfileIdleKey"/>.</summary>
    public const string ProfileIdleFallback = "Idle";

    /// <summary>"Sleeping" profile label key (web <c>profileLabel('sleeping')</c>).</summary>
    public const string ProfileSleepingKey = "translation.polling.profile.sleeping";

    /// <summary>English fallback for <see cref="ProfileSleepingKey"/>.</summary>
    public const string ProfileSleepingFallback = "Sleeping";

    // ── data-state affordances (loading / error / offline / stale) ───────────────────────────────────────────

    /// <summary>Loading label key (shared common key).</summary>
    public const string LoadingKey = "translation.common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading\u2026";

    /// <summary>Retry button key (shared common key).</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>Hard-error message key.</summary>
    public const string ErrorKey = "translation.polling.error";

    /// <summary>English fallback for <see cref="ErrorKey"/>.</summary>
    public const string ErrorFallback = "Couldn't load the polling engine";

    /// <summary>Offline (cached) message key.</summary>
    public const string OfflineKey = "translation.polling.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "You're offline — showing the last cached polling status";

    /// <summary>Short offline-chip label key (shared common key).</summary>
    public const string OfflineShortKey = "translation.common.offline";

    /// <summary>English fallback for <see cref="OfflineShortKey"/>.</summary>
    public const string OfflineShortFallback = "Offline";

    /// <summary>Stale-chip label key.</summary>
    public const string StaleKey = "translation.polling.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>Resolve the localized profile label for a wire profile (web <c>profileLabel</c>).</summary>
    /// <param name="profile">The wire profile string.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized label, or the raw profile when it is not one of the known buckets.</returns>
    public static string ProfileLabel(string profile, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return profile switch
        {
            "driving" => localizer.GetString(ProfileDrivingKey, ProfileDrivingFallback),
            "charging" => localizer.GetString(ProfileChargingKey, ProfileChargingFallback),
            "idle" => localizer.GetString(ProfileIdleKey, ProfileIdleFallback),
            "sleeping" => localizer.GetString(ProfileSleepingKey, ProfileSleepingFallback),
            _ => profile,
        };
    }
}

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="PollingEngineViewModel"/> can be in — the native union of
/// every branch the web <c>PollingEnginePanel</c> renders. Each branch maps onto a visible surface (none is hidden)
/// except <see cref="Disabled"/>, which collapses the whole surface exactly as the web <c>return null</c> does when
/// <c>!status?.enabled</c>.
/// </summary>
public enum PollingEngineState
{
    /// <summary>Initial fetch with no cached status — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Engine enabled with at least one tracked vehicle — render the savings card + vehicle list.</summary>
    Loaded,

    /// <summary>Engine enabled with no tracked vehicles — render the savings card + a friendly empty state.</summary>
    Empty,

    /// <summary>The status fetch failed and no cached status exists — render the retry affordance.</summary>
    Error,

    /// <summary>Cached status older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached status remains — render content plus an offline chip.</summary>
    Offline,

    /// <summary>The engine is disabled (web <c>!status?.enabled</c>) — collapse the entire surface.</summary>
    Disabled,
}

/// <summary>The polling-engine activity bucket (web <c>VehiclePollingStatus.activity</c> values).</summary>
public enum PollingActivity
{
    /// <summary>Actively polling (web <c>active</c>).</summary>
    Active,

    /// <summary>Critical cadence (web <c>critical</c>).</summary>
    Critical,

    /// <summary>Moderate cadence (web <c>moderate</c>).</summary>
    Moderate,

    /// <summary>Low cadence (web <c>low</c>).</summary>
    Low,

    /// <summary>Idle (web <c>idle</c>).</summary>
    Idle,

    /// <summary>Sleeping (web <c>sleeping</c>).</summary>
    Sleeping,

    /// <summary>An unrecognized activity string (web default branch).</summary>
    Unknown,
}

/// <summary>The savings-breakdown buckets the web SavingsCard renders as proportional bar segments + a legend.</summary>
public enum PollingBreakdownKind
{
    /// <summary>Fleet Telemetry streaming (web <c>fleet_telemetry</c>, blue).</summary>
    FleetTelemetry,

    /// <summary>Idle detection (web <c>idle_detection</c>, amber).</summary>
    IdleDetection,

    /// <summary>Prediction (web <c>prediction</c>, purple).</summary>
    Prediction,

    /// <summary>Sleep detection (web <c>sleep_detection</c>, grey).</summary>
    Sleep,
}

/// <summary>
/// A predicted next-state transition for a vehicle (web <c>PredictionInfo</c>). <see cref="EstimatedInNanos"/> is the
/// raw nanosecond horizon the Go API emits; the web divides it by 1e6 before formatting as a duration.
/// </summary>
/// <param name="NextState">The predicted next FSM state.</param>
/// <param name="EstimatedInNanos">Estimated time-to-transition in nanoseconds.</param>
/// <param name="Confidence">Model confidence in the range [0, 1].</param>
/// <param name="BasedOn">A human description of what the prediction was based on.</param>
public sealed record PollingPrediction(string NextState, double EstimatedInNanos, double Confidence, string BasedOn);

/// <summary>One adaptive-polling decision for a vehicle (web <c>PollDecision</c>, the parts the panel renders).</summary>
/// <param name="NextIntervalMs">The next poll interval in milliseconds.</param>
/// <param name="Reasons">The human-readable reasons that drove the decision.</param>
/// <param name="Prediction">The optional next-state prediction.</param>
public sealed record PollingDecision(double NextIntervalMs, IReadOnlyList<string> Reasons, PollingPrediction? Prediction);

/// <summary>
/// One vehicle's polling state from <c>GET /polling/status</c> (web <c>VehiclePollingStatus</c>). Field names mirror
/// the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Vin">The vehicle VIN (the map key).</param>
/// <param name="Activity">The raw activity bucket string.</param>
/// <param name="Profile">The raw FSM profile string.</param>
/// <param name="ConsecIdle">Consecutive idle poll count.</param>
/// <param name="NextPollAfter">The ISO timestamp of the next scheduled poll, or null.</param>
/// <param name="BatteryLevel">The last-known battery percentage.</param>
/// <param name="LastDecision">The most recent polling decision, or null.</param>
public sealed record PollingVehicleActivity(
    string Vin,
    string Activity,
    string Profile,
    int ConsecIdle,
    string? NextPollAfter,
    double BatteryLevel,
    PollingDecision? LastDecision)
{
    /// <summary>The parsed activity bucket (web <c>activityColor</c> / <c>activityIcon</c> switch input).</summary>
    public PollingActivity ActivityKind => Activity switch
    {
        "active" => PollingActivity.Active,
        "critical" => PollingActivity.Critical,
        "moderate" => PollingActivity.Moderate,
        "low" => PollingActivity.Low,
        "idle" => PollingActivity.Idle,
        "sleeping" => PollingActivity.Sleeping,
        _ => PollingActivity.Unknown,
    };
}

/// <summary>
/// The polling-engine status snapshot from <c>GET /polling/status</c> (web <c>PollEngineStatus</c>).
/// <see cref="Enabled"/> gates the whole surface (web <c>!status?.enabled</c> → render nothing).
/// </summary>
/// <param name="Enabled">Whether the adaptive polling engine is enabled.</param>
/// <param name="Vehicles">The per-VIN polling activity, in stable wire order.</param>
public sealed record PollingStatusSnapshot(bool Enabled, IReadOnlyList<PollingVehicleActivity> Vehicles)
{
    /// <summary>A disabled, vehicle-less snapshot (the parse fallback for an absent body).</summary>
    public static PollingStatusSnapshot Disabled { get; } =
        new(false, Array.Empty<PollingVehicleActivity>());

    /// <summary>Parse a <c>GET /polling/status</c> JSON object into a tolerant snapshot.</summary>
    /// <param name="element">The decoded response body.</param>
    /// <returns>The parsed snapshot, or <see cref="Disabled"/> when the body is not an object.</returns>
    public static PollingStatusSnapshot Parse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Disabled;
        }

        bool enabled = PollingEngineJson.GetBool(element, "enabled") ?? false;
        var vehicles = new List<PollingVehicleActivity>();

        if (element.TryGetProperty("vehicles", out JsonElement vehiclesProp) &&
            vehiclesProp.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty member in vehiclesProp.EnumerateObject())
            {
                if (member.Value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                vehicles.Add(new PollingVehicleActivity(
                    Vin: member.Name,
                    Activity: PollingEngineJson.GetString(member.Value, "activity") ?? string.Empty,
                    Profile: PollingEngineJson.GetString(member.Value, "profile") ?? string.Empty,
                    ConsecIdle: (int)(PollingEngineJson.GetDouble(member.Value, "consec_idle") ?? 0),
                    NextPollAfter: PollingEngineJson.GetString(member.Value, "next_poll_after"),
                    BatteryLevel: PollingEngineJson.GetDouble(member.Value, "battery_level") ?? 0,
                    LastDecision: ParseDecision(member.Value)));
            }
        }

        return new PollingStatusSnapshot(enabled, vehicles);
    }

    private static PollingDecision? ParseDecision(JsonElement vehicle)
    {
        if (!vehicle.TryGetProperty("last_decision", out JsonElement decision) ||
            decision.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var reasons = new List<string>();
        if (decision.TryGetProperty("reasons", out JsonElement reasonsProp) &&
            reasonsProp.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement reason in reasonsProp.EnumerateArray())
            {
                if (reason.ValueKind == JsonValueKind.String)
                {
                    reasons.Add(reason.GetString() ?? string.Empty);
                }
            }
        }

        return new PollingDecision(
            NextIntervalMs: PollingEngineJson.GetDouble(decision, "next_interval_ms") ?? 0,
            Reasons: reasons,
            Prediction: ParsePrediction(decision));
    }

    private static PollingPrediction? ParsePrediction(JsonElement decision)
    {
        if (!decision.TryGetProperty("prediction", out JsonElement prediction) ||
            prediction.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new PollingPrediction(
            NextState: PollingEngineJson.GetString(prediction, "next_state") ?? string.Empty,
            EstimatedInNanos: PollingEngineJson.GetDouble(prediction, "estimated_in") ?? 0,
            Confidence: PollingEngineJson.GetDouble(prediction, "confidence") ?? 0,
            BasedOn: PollingEngineJson.GetString(prediction, "based_on") ?? string.Empty);
    }
}

/// <summary>
/// The cost snapshot from <c>GET /polling/savings</c> (web <c>CostSnapshot</c>, the parts the SavingsCard renders).
/// The four breakdown buckets are read explicitly; <see cref="BreakdownTotal"/> is the sum of <em>all</em> breakdown
/// values (web <c>Object.values(breakdown).reduce(...)</c>) so the proportional bar matches the web exactly even
/// when the API adds buckets the panel does not name.
/// </summary>
/// <param name="SavingsPercent">Percent of polls saved.</param>
/// <param name="EstimatedSavings">Estimated dollar savings.</param>
/// <param name="PollsMade">Number of polls actually made.</param>
/// <param name="RemainingCredit">Remaining monthly API credit, in dollars.</param>
/// <param name="FleetTelemetry">Polls saved by Fleet Telemetry streaming.</param>
/// <param name="IdleDetection">Polls saved by idle detection.</param>
/// <param name="Prediction">Polls saved by prediction.</param>
/// <param name="SleepDetection">Polls saved by sleep detection.</param>
/// <param name="BreakdownTotal">Sum of every breakdown value.</param>
public sealed record PollingSavings(
    double SavingsPercent,
    double EstimatedSavings,
    double PollsMade,
    double RemainingCredit,
    double FleetTelemetry,
    double IdleDetection,
    double Prediction,
    double SleepDetection,
    double BreakdownTotal)
{
    /// <summary>Parse a <c>GET /polling/savings</c> JSON object into a tolerant cost snapshot.</summary>
    /// <param name="element">The decoded response body.</param>
    /// <returns>The parsed snapshot (zeros when the body is not an object).</returns>
    public static PollingSavings Parse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new PollingSavings(0, 0, 0, 0, 0, 0, 0, 0, 0);
        }

        double fleet = 0, idle = 0, prediction = 0, sleep = 0, total = 0;
        if (element.TryGetProperty("savings_breakdown", out JsonElement breakdown) &&
            breakdown.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty bucket in breakdown.EnumerateObject())
            {
                if (bucket.Value.ValueKind != JsonValueKind.Number)
                {
                    continue;
                }

                double value = bucket.Value.GetDouble();
                total += value;
                switch (bucket.Name)
                {
                    case "fleet_telemetry": fleet = value; break;
                    case "idle_detection": idle = value; break;
                    case "prediction": prediction = value; break;
                    case "sleep_detection": sleep = value; break;
                    default: break;
                }
            }
        }

        return new PollingSavings(
            SavingsPercent: PollingEngineJson.GetDouble(element, "savings_percent") ?? 0,
            EstimatedSavings: PollingEngineJson.GetDouble(element, "estimated_savings") ?? 0,
            PollsMade: PollingEngineJson.GetDouble(element, "polls_made") ?? 0,
            RemainingCredit: PollingEngineJson.GetDouble(element, "remaining_credit") ?? 0,
            FleetTelemetry: fleet,
            IdleDetection: idle,
            Prediction: prediction,
            SleepDetection: sleep,
            BreakdownTotal: total);
    }
}

/// <summary>One metric cell in the savings card (label + animated value + format), projected for the view.</summary>
/// <param name="LabelKey">The i18n key for the metric caption.</param>
/// <param name="LabelFallback">The English fallback for the caption.</param>
/// <param name="Value">The numeric value to count up to.</param>
/// <param name="Precision">Fraction digits to render.</param>
/// <param name="Prefix">A leading symbol (e.g. <c>$</c>) or empty.</param>
/// <param name="Suffix">A trailing symbol (e.g. <c>%</c>) or empty.</param>
/// <param name="Emphasis">Whether the value is the emphasised (savings-accent) colour (web emerald-400).</param>
public sealed record PollingSavingsMetric(
    string LabelKey,
    string LabelFallback,
    double Value,
    int Precision,
    string Prefix,
    string Suffix,
    bool Emphasis);

/// <summary>One proportional segment of the savings breakdown bar (web SavingsCard bar + legend).</summary>
/// <param name="Kind">Which breakdown bucket this segment represents.</param>
/// <param name="LabelKey">The i18n key for the legend label.</param>
/// <param name="LabelFallback">The English fallback for the legend label.</param>
/// <param name="ColorHex">The semantic data colour the web bar uses for this bucket.</param>
/// <param name="Value">The bucket's raw value.</param>
/// <param name="Fraction">The bucket's share of the breakdown total, in [0, 1].</param>
public sealed record PollingBreakdownSegment(
    PollingBreakdownKind Kind,
    string LabelKey,
    string LabelFallback,
    string ColorHex,
    double Value,
    double Fraction);

/// <summary>The projected savings card (web <c>SavingsCard</c>): four metric cells plus the breakdown segments.</summary>
/// <param name="Metrics">The four headline metrics, in render order.</param>
/// <param name="Segments">The breakdown segments with a positive value (empty hides the bar + legend).</param>
public sealed record PollingSavingsView(
    IReadOnlyList<PollingSavingsMetric> Metrics,
    IReadOnlyList<PollingBreakdownSegment> Segments)
{
    /// <summary>Whether the proportional bar + legend are shown (web <c>total &gt; 0</c>).</summary>
    public bool HasBreakdown => Segments.Count > 0;

    /// <summary>Project a <see cref="PollingSavings"/> into the view shape (web SavingsCard render).</summary>
    /// <param name="savings">The parsed cost snapshot.</param>
    /// <returns>The projected card.</returns>
    public static PollingSavingsView Project(PollingSavings savings)
    {
        ArgumentNullException.ThrowIfNull(savings);

        var metrics = new[]
        {
            new PollingSavingsMetric(
                PollingEngineRegistration.PollsSavedKey, PollingEngineRegistration.PollsSavedFallback,
                savings.SavingsPercent, 1, string.Empty, "%", Emphasis: true),
            new PollingSavingsMetric(
                PollingEngineRegistration.SavedAmountKey, PollingEngineRegistration.SavedAmountFallback,
                savings.EstimatedSavings, 2, "$", string.Empty, Emphasis: true),
            new PollingSavingsMetric(
                PollingEngineRegistration.PollsMadeKey, PollingEngineRegistration.PollsMadeFallback,
                savings.PollsMade, 0, string.Empty, string.Empty, Emphasis: false),
            new PollingSavingsMetric(
                PollingEngineRegistration.CreditLeftKey, PollingEngineRegistration.CreditLeftFallback,
                savings.RemainingCredit, 2, "$", string.Empty, Emphasis: false),
        };

        var segments = new List<PollingBreakdownSegment>(4);
        if (savings.BreakdownTotal > 0)
        {
            AddSegment(segments, PollingBreakdownKind.FleetTelemetry, PollingEngineRegistration.FleetTelemetryKey,
                PollingEngineRegistration.FleetTelemetryFallback, "#3b82f6", savings.FleetTelemetry, savings.BreakdownTotal);
            AddSegment(segments, PollingBreakdownKind.IdleDetection, PollingEngineRegistration.IdleDetectionKey,
                PollingEngineRegistration.IdleDetectionFallback, "#f59e0b", savings.IdleDetection, savings.BreakdownTotal);
            AddSegment(segments, PollingBreakdownKind.Prediction, PollingEngineRegistration.PredictionKey,
                PollingEngineRegistration.PredictionFallback, "#a855f7", savings.Prediction, savings.BreakdownTotal);
            AddSegment(segments, PollingBreakdownKind.Sleep, PollingEngineRegistration.SleepKey,
                PollingEngineRegistration.SleepFallback, "#6b7280", savings.SleepDetection, savings.BreakdownTotal);
        }

        return new PollingSavingsView(metrics, segments);
    }

    private static void AddSegment(
        List<PollingBreakdownSegment> segments,
        PollingBreakdownKind kind,
        string labelKey,
        string labelFallback,
        string colorHex,
        double value,
        double total)
    {
        if (value > 0)
        {
            segments.Add(new PollingBreakdownSegment(kind, labelKey, labelFallback, colorHex, value, value / total));
        }
    }
}

/// <summary>The projected, localized prediction line shown when a vehicle row is expanded (web prediction block).</summary>
/// <param name="NextState">The predicted next state.</param>
/// <param name="InLabel">The formatted time-to-transition (web <c>formatDuration(estimated_in / 1e6)</c>).</param>
/// <param name="ConfidencePercent">Confidence rounded to a whole percent.</param>
/// <param name="BasedOn">What the prediction was based on.</param>
public sealed record PollingPredictionRow(string NextState, string InLabel, int ConfidencePercent, string BasedOn);

/// <summary>
/// One projected vehicle row (web <c>VehicleActivity</c>): the always-visible summary plus the disclosure detail.
/// Built by <see cref="Project"/> so the view binds strings and never re-derives them.
/// </summary>
/// <param name="VinTail">The last 8 VIN characters (web <c>vin.slice(-8)</c>).</param>
/// <param name="ActivityChip">The "activity · profile" chip text.</param>
/// <param name="ActivityColorHex">The activity accent colour (web <c>activityColor</c>).</param>
/// <param name="ActivityGlyph">The Segoe Fluent glyph for the activity (web <c>activityIcon</c>).</param>
/// <param name="Animate">Whether the activity dot pulses (web only animates the <c>active</c> bucket).</param>
/// <param name="NextPollLabel">The "Next: …" relative label.</param>
/// <param name="HasDetails">Whether a last decision exists to disclose (web <c>expanded &amp;&amp; last_decision</c>).</param>
/// <param name="IntervalLabel">The formatted next interval, when a decision exists.</param>
/// <param name="ConsecIdle">Consecutive idle poll count.</param>
/// <param name="BatteryLevel">Battery percentage.</param>
/// <param name="Reasons">The decision reasons.</param>
/// <param name="Prediction">The optional projected prediction line.</param>
public sealed record PollingVehicleRow(
    string VinTail,
    string ActivityChip,
    string ActivityColorHex,
    string ActivityGlyph,
    bool Animate,
    string NextPollLabel,
    bool HasDetails,
    string? IntervalLabel,
    int ConsecIdle,
    double BatteryLevel,
    IReadOnlyList<string> Reasons,
    PollingPredictionRow? Prediction)
{
    /// <summary>Project a <see cref="PollingVehicleActivity"/> into the localized row shape.</summary>
    /// <param name="activity">The parsed vehicle activity.</param>
    /// <param name="now">The wall clock used for the relative "Next: …" label (injected for determinism).</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The projected row.</returns>
    public static PollingVehicleRow Project(PollingVehicleActivity activity, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(activity);
        ArgumentNullException.ThrowIfNull(localizer);

        string profileLabel = PollingEngineRegistration.ProfileLabel(activity.Profile, localizer);
        string chip = string.IsNullOrEmpty(activity.Activity)
            ? profileLabel
            : string.Concat(activity.Activity, " \u00b7 ", profileLabel);

        PollingDecision? decision = activity.LastDecision;
        PollingPredictionRow? prediction = null;
        if (decision?.Prediction is { } p)
        {
            prediction = new PollingPredictionRow(
                NextState: p.NextState,
                InLabel: PollingEngineFormat.FormatDuration(p.EstimatedInNanos / 1e6),
                ConfidencePercent: (int)Math.Round(p.Confidence * 100, MidpointRounding.AwayFromZero),
                BasedOn: p.BasedOn);
        }

        return new PollingVehicleRow(
            VinTail: PollingEngineFormat.VinTail(activity.Vin),
            ActivityChip: chip,
            ActivityColorHex: PollingEngineFormat.ActivityColorHex(activity.ActivityKind),
            ActivityGlyph: PollingEngineFormat.ActivityGlyph(activity.ActivityKind),
            Animate: activity.ActivityKind == PollingActivity.Active,
            NextPollLabel: PollingEngineFormat.FormatTimeUntil(activity.NextPollAfter, now),
            HasDetails: decision is not null,
            IntervalLabel: decision is null ? null : PollingEngineFormat.FormatDuration(decision.NextIntervalMs),
            ConsecIdle: activity.ConsecIdle,
            BatteryLevel: activity.BatteryLevel,
            Reasons: decision?.Reasons ?? Array.Empty<string>(),
            Prediction: prediction);
    }
}

/// <summary>
/// Pure formatting + palette helpers ported 1:1 from <c>web/src/components/data-display/PollingEngine.tsx</c>
/// (<c>formatDuration</c>, <c>formatTimeUntil</c>) and <c>web/src/lib/colors.ts</c> (<c>activityColor</c>). Time-unit
/// symbols ("s"/"m"/"h") and the "now" literal follow the shipped Core <c>FreshnessLogic.FormatAge</c> convention
/// of treating short relative-time tokens as locale-neutral format symbols rather than translated copy.
/// </summary>
public static class PollingEngineFormat
{
    /// <summary>The "instant" / non-positive duration token (web <c>formatDuration</c> returns "now").</summary>
    public const string Now = "now";

    /// <summary>The last 8 characters of a VIN, or the whole VIN when shorter (web <c>vin.slice(-8)</c>).</summary>
    /// <param name="vin">The VIN to trim.</param>
    /// <returns>The trailing 8 characters.</returns>
    public static string VinTail(string vin)
    {
        ArgumentNullException.ThrowIfNull(vin);
        return vin.Length <= 8 ? vin : vin.Substring(vin.Length - 8);
    }

    /// <summary>
    /// Format a millisecond duration into the web's tiered string: <c>now</c> (≤0), <c>{s}s</c> (&lt; 60 s),
    /// <c>{m}m</c> (&lt; 60 min) or <c>{h}h {m}m</c> (web <c>formatDuration</c>).
    /// </summary>
    /// <param name="ms">The duration in milliseconds.</param>
    /// <returns>The formatted duration string.</returns>
    public static string FormatDuration(double ms)
    {
        if (ms <= 0 || double.IsNaN(ms))
        {
            return Now;
        }

        long seconds = (long)Math.Floor(ms / 1000);
        if (seconds < 60)
        {
            return string.Concat(seconds.ToString(CultureInfo.InvariantCulture), "s");
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return string.Concat(minutes.ToString(CultureInfo.InvariantCulture), "m");
        }

        long hours = minutes / 60;
        long remMinutes = minutes % 60;
        return string.Concat(
            hours.ToString(CultureInfo.InvariantCulture), "h ",
            remMinutes.ToString(CultureInfo.InvariantCulture), "m");
    }

    /// <summary>
    /// Format the time remaining until an ISO timestamp relative to <paramref name="now"/> (web
    /// <c>formatTimeUntil</c>): <c>now</c> when the target is past/unparseable, else the tiered duration.
    /// </summary>
    /// <param name="iso">The target ISO timestamp, or null.</param>
    /// <param name="now">The reference instant.</param>
    /// <returns>The formatted relative label.</returns>
    public static string FormatTimeUntil(string? iso, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(iso) ||
            !DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out DateTimeOffset target))
        {
            return Now;
        }

        double diffMs = (target - now).TotalMilliseconds;
        return diffMs <= 0 ? Now : FormatDuration(diffMs);
    }

    /// <summary>The web semantic activity colour (<c>activityColor</c>) as a "#RRGGBB" string.</summary>
    /// <param name="activity">The parsed activity bucket.</param>
    /// <returns>The hex colour.</returns>
    public static string ActivityColorHex(PollingActivity activity) => activity switch
    {
        PollingActivity.Active or PollingActivity.Critical => "#10b981",
        PollingActivity.Moderate => "#3b82f6",
        PollingActivity.Low => "#f59e0b",
        PollingActivity.Idle => "#6b7280",
        PollingActivity.Sleeping => "#4b5563",
        _ => "#6b7280",
    };

    /// <summary>The Segoe Fluent glyph mirroring the web <c>activityIcon</c> for an activity bucket.</summary>
    /// <param name="activity">The parsed activity bucket.</param>
    /// <returns>The glyph code point.</returns>
    public static string ActivityGlyph(PollingActivity activity) => activity switch
    {
        PollingActivity.Active or PollingActivity.Critical => "\uE945",  // Lightning / energy (web Zap)
        PollingActivity.Moderate => "\uE83E",                            // Battery charging (web BatteryCharging)
        PollingActivity.Low => "\uE9D9",                                 // Activity / pulse (web Activity)
        PollingActivity.Idle or PollingActivity.Sleeping => "\uE708",    // Quiet hours / moon (web Moon)
        _ => "\uE9E9",                                                    // Speedometer (web Gauge)
    };
}

/// <summary>
/// Maps the cache-then-network <see cref="RepositoryResult{T}"/> of raw JSON onto the typed polling snapshots while
/// preserving the lifecycle status / fetch time / staleness / error — the native analogue of the web query layer
/// re-deriving render state from a refetch. Mirrors the established <c>AlertFeedResultMapper</c> shape.
/// </summary>
public static class PollingEngineResultMapper
{
    /// <summary>Map a raw status emission to a typed <see cref="PollingStatusSnapshot"/> emission.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same lifecycle status.</returns>
    public static RepositoryResult<PollingStatusSnapshot> MapStatus(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, PollingStatusSnapshot.Parse, PollingStatusSnapshot.Disabled);
    }

    /// <summary>Map a raw savings emission to a typed <see cref="PollingSavings"/> emission.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The typed emission with the same lifecycle status.</returns>
    public static RepositoryResult<PollingSavings> MapSavings(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return Map(raw, PollingSavings.Parse, new PollingSavings(0, 0, 0, 0, 0, 0, 0, 0, 0));
    }

    private static RepositoryResult<T> Map<T>(
        RepositoryResult<JsonElement> raw,
        Func<JsonElement, T> parse,
        T fallback)
        where T : class
    {
        T Value() => raw.HasValue ? parse(raw.Value) : fallback;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<T>.Loading(),
            LoadStatus.Cached => RepositoryResult<T>.Cached(Value(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<T>.Refreshing(Value(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<T>.Loaded(Value(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<T>.OfflineCached(Value(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<T>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// PII-safe diagnostics for the PollingEngine surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> signal with the surface slug — never a VIN, savings figure, prediction reason or any data row —
/// so a diagnostics line can never leak polling content. Thread-safe.
/// </summary>
public sealed class PollingEngineDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public PollingEngineDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PollingEngine</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PollingEngineRegistration.Slug}");
    }
}

/// <summary>Small null-tolerant <see cref="JsonElement"/> readers for the polling wire shapes (snake_case).</summary>
internal static class PollingEngineJson
{
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out JsonElement v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    public static double? GetDouble(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.Number &&
        v.TryGetDouble(out double d)
            ? d
            : null;
}
