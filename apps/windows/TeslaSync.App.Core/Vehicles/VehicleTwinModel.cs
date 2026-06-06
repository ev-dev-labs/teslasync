namespace TeslaSync.App.Core.Vehicles;

/// <summary>Window position (port of the web <c>WindowState</c> union).</summary>
public enum WindowPosition
{
    /// <summary>Position not reported.</summary>
    Unknown,

    /// <summary>Fully closed.</summary>
    Closed,

    /// <summary>Partially open / vented.</summary>
    Partial,

    /// <summary>Fully open.</summary>
    Open,
}

/// <summary>Turn-signal state (port of the web <c>TurnSignalState</c> union).</summary>
public enum TurnSignal
{
    /// <summary>Not reported.</summary>
    Unknown,

    /// <summary>Off.</summary>
    Off,

    /// <summary>Left indicator.</summary>
    Left,

    /// <summary>Right indicator.</summary>
    Right,

    /// <summary>Both (hazards).</summary>
    Both,
}

/// <summary>
/// Combined digital-twin state (port of the web <c>VehicleTwinState</c>). Nullable
/// bool fields use a tri-state: true / false / null (unknown). The WinUI
/// <c>TsVehicleTwin</c> binds this directly so it renders real reported state.
/// </summary>
public sealed record VehicleTwinModel
{
    /// <summary>Driver-front door open.</summary>
    public bool? DoorDriverFront { get; init; }

    /// <summary>Passenger-front door open.</summary>
    public bool? DoorPassengerFront { get; init; }

    /// <summary>Driver-rear door open.</summary>
    public bool? DoorDriverRear { get; init; }

    /// <summary>Passenger-rear door open.</summary>
    public bool? DoorPassengerRear { get; init; }

    /// <summary>Front-driver window.</summary>
    public WindowPosition WindowDriverFront { get; init; } = WindowPosition.Unknown;

    /// <summary>Front-passenger window.</summary>
    public WindowPosition WindowPassengerFront { get; init; } = WindowPosition.Unknown;

    /// <summary>Rear-driver window.</summary>
    public WindowPosition WindowDriverRear { get; init; } = WindowPosition.Unknown;

    /// <summary>Rear-passenger window.</summary>
    public WindowPosition WindowPassengerRear { get; init; } = WindowPosition.Unknown;

    /// <summary>Frunk (front trunk) open.</summary>
    public bool? FrunkOpen { get; init; }

    /// <summary>Trunk (rear) open.</summary>
    public bool? TrunkOpen { get; init; }

    /// <summary>Charge port door open.</summary>
    public bool? ChargePortOpen { get; init; }

    /// <summary>Actively charging.</summary>
    public bool IsCharging { get; init; }

    /// <summary>Actively driving.</summary>
    public bool IsDriving { get; init; }

    /// <summary>Locked.</summary>
    public bool? Locked { get; init; }

    /// <summary>Sentry mode armed.</summary>
    public bool? SentryMode { get; init; }

    /// <summary>Headlights on.</summary>
    public bool? Headlights { get; init; }

    /// <summary>Turn-signal state.</summary>
    public TurnSignal TurnSignal { get; init; } = TurnSignal.Unknown;

    /// <summary>Tesla <c>exterior_color</c> code used to auto-detect the paint.</summary>
    public string? ExteriorColor { get; init; }
}
