// The native command catalogue for the VehicleCommandCenter feature view — the 1:1 port of the web
// `COMMANDS` array (web/src/features/system/commands.ts), the data the orchestrator imports rather than
// owns. 67 entries (72 backend commands: 5 toggle pairs merged) across the 14 categories. Each entry maps
// the web `CommandDef` fields the native orchestrator + its inline tiles read; the lucide `icon` maps to
// the nearest authored [CommandGlyph] (the shared icon catalog ships no command glyphs and editing it is
// outside this surface's allowed files — the same approach the CollapsibleCommandGroup port documents).
//
// Pure data, exercised off-device by the :android:testReleaseUnitTest gate (catalogue invariants: count,
// category coverage, default-favourite set, toggle/dialog wiring).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

/**
 * The full Vehicle Commands catalogue, in display order — the native analogue of the web `COMMANDS` array.
 * The orchestrator filters, groups, and favourites over this list exactly as the web component does.
 */
val DEFAULT_COMMAND_CATALOG: List<CommandCenterCommand> =
    listOf(
        // ── Security & Access — 15 entries (17 commands: 2 toggles) ──────────────────────────────────
        CommandCenterCommand(
            id = "wake_up",
            command = "wake_up",
            labels =
                CommandLabels(
                    labelKey = "commands.security.wakeUp",
                    labelFallback = "Wake Up",
                    sublabelKey = "commands.security.wakeVehicle",
                    sublabelFallback = "Wake vehicle",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Action,
            glyph = CommandGlyph.Power,
            variant = CommandVariant.Success,
            defaultFavorite = true,
        ),
        CommandCenterCommand(
            id = "lock",
            command = "lock",
            commandOff = "unlock",
            labels = CommandLabels(labelKey = "commands.security.lock", labelFallback = "Lock"),
            category = CommandCenterCategory.Security,
            type = CommandType.Toggle,
            glyph = CommandGlyph.Lock,
            stateField = ToggleField.IsLocked,
            defaultFavorite = true,
        ),
        CommandCenterCommand(
            id = "sentry",
            command = "sentry_on",
            commandOff = "sentry_off",
            labels = CommandLabels(labelKey = "commands.security.sentry", labelFallback = "Sentry"),
            category = CommandCenterCategory.Security,
            type = CommandType.Toggle,
            glyph = CommandGlyph.Shield,
            variant = CommandVariant.Danger,
            stateField = ToggleField.SentryMode,
            defaultFavorite = true,
        ),
        CommandCenterCommand(
            id = "speed_limit_set",
            command = "speed_limit_set_limit",
            labels =
                CommandLabels(
                    labelKey = "commands.security.speedLimit",
                    labelFallback = "Speed Limit",
                    sublabelKey = "commands.security.setMph",
                    sublabelFallback = "Set MPH",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Input,
            glyph = CommandGlyph.Gauge,
            variant = CommandVariant.Danger,
            input =
                InputConfigDef(
                    promptKey = "commands.security.enterSpeedLimit",
                    promptFallback = "Enter speed limit (50-90 MPH):",
                    paramName = "limit_mph",
                    validation = InputValidation.Number,
                    bounds = InputBounds(min = 50, max = 90),
                ),
        ),
        CommandCenterCommand(
            id = "speed_limit_on",
            command = "speed_limit_on",
            labels =
                CommandLabels(
                    labelKey = "commands.security.speedActivate",
                    labelFallback = "Activate",
                    sublabelKey = "commands.security.speedLimitMode",
                    sublabelFallback = "Speed Limit",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Input,
            glyph = CommandGlyph.Gauge,
            variant = CommandVariant.Danger,
            input =
                InputConfigDef(
                    promptKey = "commands.security.enterSpeedPin",
                    promptFallback = "Enter 4-digit PIN:",
                    paramName = "pin",
                    validation = InputValidation.Pin,
                ),
        ),
        CommandCenterCommand(
            id = "speed_limit_off",
            command = "speed_limit_off",
            labels =
                CommandLabels(
                    labelKey = "commands.security.speedDeactivate",
                    labelFallback = "Deactivate",
                    sublabelKey = "commands.security.speedLimitMode",
                    sublabelFallback = "Speed Limit",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Input,
            glyph = CommandGlyph.Gauge,
            input =
                InputConfigDef(
                    promptKey = "commands.security.enterSpeedPin",
                    promptFallback = "Enter 4-digit PIN:",
                    paramName = "pin",
                    validation = InputValidation.Pin,
                ),
        ),
        CommandCenterCommand(
            id = "speed_limit_clear_pin",
            command = "speed_limit_clear_pin",
            labels =
                CommandLabels(
                    labelKey = "commands.security.clearSpeedPin",
                    labelFallback = "Clear Speed PIN",
                    sublabelKey = "commands.security.requiresPin",
                    sublabelFallback = "Requires PIN",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Input,
            glyph = CommandGlyph.Gauge,
            variant = CommandVariant.Danger,
            input =
                InputConfigDef(
                    promptKey = "commands.security.enterSpeedPin",
                    promptFallback = "Enter 4-digit PIN:",
                    paramName = "pin",
                    validation = InputValidation.Pin,
                ),
        ),
        CommandCenterCommand(
            id = "speed_limit_clear_pin_admin",
            command = "speed_limit_clear_pin_admin",
            labels =
                CommandLabels(
                    labelKey = "commands.security.clearSpeedPin",
                    labelFallback = "Clear Speed PIN",
                    sublabelKey = "commands.security.admin",
                    sublabelFallback = "Admin",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Action,
            glyph = CommandGlyph.Gauge,
            variant = CommandVariant.Danger,
            dangerous = true,
            confirm =
                ConfirmConfig(
                    confirmKey = "commands.security.confirmClearPin",
                    confirmFallback = "Clear speed limit PIN without authentication?",
                ),
        ),
        CommandCenterCommand(
            id = "valet_mode",
            command = "set_valet_mode",
            commandOff = "valet_off",
            labels = CommandLabels(labelKey = "commands.security.valetMode", labelFallback = "Valet Mode"),
            category = CommandCenterCategory.Security,
            type = CommandType.Toggle,
            glyph = CommandGlyph.User,
            variant = CommandVariant.Danger,
            input =
                InputConfigDef(
                    promptKey = "commands.security.enterValetPin",
                    promptFallback = "Enter 4-digit valet PIN:",
                    paramName = "password",
                    validation = InputValidation.Pin,
                ),
            params = mapOf("on" to "true"),
        ),
        CommandCenterCommand(
            id = "reset_valet_pin",
            command = "reset_valet_pin",
            labels =
                CommandLabels(
                    labelKey = "commands.security.resetValetPin",
                    labelFallback = "Reset Valet PIN",
                    sublabelKey = "commands.security.admin",
                    sublabelFallback = "Admin",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Action,
            glyph = CommandGlyph.User,
            variant = CommandVariant.Danger,
        ),
        CommandCenterCommand(
            id = "guest_mode",
            command = "guest_mode_on",
            commandOff = "guest_mode_off",
            labels = CommandLabels(labelKey = "commands.security.guestMode", labelFallback = "Guest Mode"),
            category = CommandCenterCategory.Security,
            type = CommandType.Toggle,
            glyph = CommandGlyph.User,
        ),
        CommandCenterCommand(
            id = "erase_user_data",
            command = "erase_user_data",
            labels =
                CommandLabels(
                    labelKey = "commands.security.eraseData",
                    labelFallback = "Erase Data",
                    sublabelKey = "commands.security.guestOnly",
                    sublabelFallback = "Guest mode only",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Action,
            glyph = CommandGlyph.Eraser,
            variant = CommandVariant.Danger,
            dangerous = true,
            confirm =
                ConfirmConfig(
                    confirmKey = "commands.security.confirmErase",
                    confirmFallback = "This will erase all user data from the vehicle touchscreen. Continue?",
                    confirmInput = "ERASE",
                    countdown = 5,
                ),
        ),
        CommandCenterCommand(
            id = "pin_to_drive",
            command = "set_pin_to_drive",
            labels =
                CommandLabels(
                    labelKey = "commands.security.pinToDrive",
                    labelFallback = "PIN to Drive",
                    sublabelKey = "commands.security.enable",
                    sublabelFallback = "Enable",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Input,
            glyph = CommandGlyph.Key,
            variant = CommandVariant.Danger,
            input =
                InputConfigDef(
                    promptKey = "commands.security.enterPin",
                    promptFallback = "Enter 4-digit PIN:",
                    paramName = "password",
                    validation = InputValidation.Pin,
                ),
            params = mapOf("on" to "true"),
        ),
        CommandCenterCommand(
            id = "reset_pin_to_drive_pin",
            command = "reset_pin_to_drive_pin",
            labels =
                CommandLabels(
                    labelKey = "commands.security.resetPin",
                    labelFallback = "Reset PIN",
                    sublabelKey = "commands.security.pinToDrive",
                    sublabelFallback = "PIN to Drive",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Action,
            glyph = CommandGlyph.Key,
            variant = CommandVariant.Danger,
        ),
        CommandCenterCommand(
            id = "clear_pin_to_drive_admin",
            command = "clear_pin_to_drive_admin",
            labels =
                CommandLabels(
                    labelKey = "commands.security.clearPin",
                    labelFallback = "Clear PIN",
                    sublabelKey = "commands.security.admin",
                    sublabelFallback = "Admin",
                ),
            category = CommandCenterCategory.Security,
            type = CommandType.Action,
            glyph = CommandGlyph.Key,
            variant = CommandVariant.Danger,
            dangerous = true,
            confirm =
                ConfirmConfig(
                    confirmKey = "commands.security.confirmClearDrivePin",
                    confirmFallback = "Clear PIN to Drive without authentication?",
                ),
        ),
        // ── Climate & Comfort — 5 entries (6 commands: 1 toggle) ─────────────────────────────────────
        CommandCenterCommand(
            id = "climate",
            command = "climate_on",
            commandOff = "climate_off",
            labels = CommandLabels(labelKey = "commands.climate.climate", labelFallback = "Climate"),
            category = CommandCenterCategory.Climate,
            type = CommandType.Toggle,
            glyph = CommandGlyph.Thermometer,
            stateField = ToggleField.IsClimateOn,
            defaultFavorite = true,
        ),
        CommandCenterCommand(
            id = "set_temps",
            command = "set_temps",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.setTemps",
                    labelFallback = "Set Temps",
                    sublabelKey = "commands.climate.driverPassenger",
                    sublabelFallback = "Driver/Passenger",
                ),
            category = CommandCenterCategory.Climate,
            type = CommandType.Input,
            glyph = CommandGlyph.Thermometer,
            input =
                InputConfigDef(
                    promptKey = "commands.climate.enterTemp",
                    promptFallback = "Enter temperature in °C (e.g., 21):",
                    paramName = "driver_temp",
                    validation = InputValidation.Decimal,
                    bounds = InputBounds(min = 15, max = 30),
                ),
        ),
        CommandCenterCommand(
            id = "seat_heater",
            command = "seat_heater",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.seatHeat",
                    labelFallback = "Seat Heat",
                    sublabelKey = "commands.climate.driver",
                    sublabelFallback = "Driver",
                ),
            category = CommandCenterCategory.Climate,
            type = CommandType.Action,
            glyph = CommandGlyph.Flame,
            params = mapOf("heater" to "0", "level" to "3"),
        ),
        CommandCenterCommand(
            id = "seat_cooler",
            command = "seat_cooler",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.seatCool",
                    labelFallback = "Seat Cool",
                    sublabelKey = "commands.climate.driver",
                    sublabelFallback = "Driver",
                ),
            category = CommandCenterCategory.Climate,
            type = CommandType.Action,
            glyph = CommandGlyph.Snowflake,
            params = mapOf("seat_position" to "0", "seat_cooler_level" to "3"),
        ),
        CommandCenterCommand(
            id = "steering_wheel_heat",
            command = "steering_wheel_heat",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.steeringHeat",
                    labelFallback = "Steering Heat",
                    sublabelKey = "commands.climate.toggle",
                    sublabelFallback = "Toggle",
                ),
            category = CommandCenterCategory.Climate,
            type = CommandType.Action,
            glyph = CommandGlyph.Gauge,
            params = mapOf("on" to "true"),
        ),
        // ── Climate Protection — 10 entries (12 commands: 2 toggles) ─────────────────────────────────
        CommandCenterCommand(
            id = "bioweapon",
            command = "bioweapon_on",
            commandOff = "bioweapon_off",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.bioweapon",
                    labelFallback = "Bioweapon",
                    sublabelKey = "commands.climate.defenseMode",
                    sublabelFallback = "Defense Mode",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Toggle,
            glyph = CommandGlyph.ShieldAlert,
            variant = CommandVariant.Danger,
        ),
        CommandCenterCommand(
            id = "cop_on",
            command = "cop_on",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.cop",
                    labelFallback = "Overheat Protect",
                    sublabelKey = "commands.climate.copOn",
                    sublabelFallback = "On (AC)",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Action,
            glyph = CommandGlyph.Thermometer,
        ),
        CommandCenterCommand(
            id = "cop_fan_only",
            command = "cop_fan_only",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.copFan",
                    labelFallback = "Overheat Protect",
                    sublabelKey = "commands.climate.fanOnly",
                    sublabelFallback = "Fan only",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Action,
            glyph = CommandGlyph.Thermometer,
        ),
        CommandCenterCommand(
            id = "cop_off",
            command = "cop_off",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.copOff",
                    labelFallback = "Overheat Protect",
                    sublabelKey = "commands.climate.off",
                    sublabelFallback = "OFF",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Action,
            glyph = CommandGlyph.Thermometer,
        ),
        CommandCenterCommand(
            id = "set_cop_temp",
            command = "set_cop_temp",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.copTemp",
                    labelFallback = "COP Temp",
                    sublabelKey = "commands.climate.setLevel",
                    sublabelFallback = "Low/Med/High",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Input,
            glyph = CommandGlyph.Thermometer,
            select =
                SelectConfigDef(
                    paramName = "cop_temp",
                    options =
                        listOf(
                            SelectOptionDef("0", "commands.climate.copLow", "Low", "90°F / 30°C"),
                            SelectOptionDef("1", "commands.climate.copMedium", "Medium", "95°F / 35°C"),
                            SelectOptionDef("2", "commands.climate.copHigh", "High", "100°F / 40°C"),
                        ),
                ),
        ),
        CommandCenterCommand(
            id = "climate_keeper",
            command = "climate_keeper_on",
            commandOff = "climate_keeper_off",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.climateKeeper",
                    labelFallback = "Climate Keeper",
                    sublabelKey = "commands.climate.keepMode",
                    sublabelFallback = "Keep",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Toggle,
            glyph = CommandGlyph.Wind,
            variant = CommandVariant.Success,
        ),
        CommandCenterCommand(
            id = "dog_mode",
            command = "dog_mode",
            labels = CommandLabels(labelKey = "commands.climate.dogMode", labelFallback = "Dog Mode"),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Action,
            glyph = CommandGlyph.Dog,
            variant = CommandVariant.Success,
        ),
        CommandCenterCommand(
            id = "camp_mode",
            command = "camp_mode",
            labels = CommandLabels(labelKey = "commands.climate.campMode", labelFallback = "Camp Mode"),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Action,
            glyph = CommandGlyph.Tent,
            variant = CommandVariant.Success,
        ),
        CommandCenterCommand(
            id = "preconditioning_max",
            command = "preconditioning_max",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.maxPrecondition",
                    labelFallback = "Max Precondition",
                    sublabelKey = "commands.climate.override",
                    sublabelFallback = "Override",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Action,
            glyph = CommandGlyph.Flame,
            variant = CommandVariant.Danger,
        ),
        CommandCenterCommand(
            id = "preconditioning_reset",
            command = "preconditioning_reset",
            labels =
                CommandLabels(
                    labelKey = "commands.climate.resetPrecondition",
                    labelFallback = "Reset Precondition",
                    sublabelKey = "commands.climate.default",
                    sublabelFallback = "Default",
                ),
            category = CommandCenterCategory.ClimateProtection,
            type = CommandType.Action,
            glyph = CommandGlyph.Flame,
        ),
        // ── Charging — 7 entries (8 commands: 1 toggle) ──────────────────────────────────────────────
        CommandCenterCommand(
            id = "charge_port_open",
            command = "charge_port_open",
            labels =
                CommandLabels(
                    labelKey = "commands.charging.chargePort",
                    labelFallback = "Charge Port",
                    sublabelKey = "commands.charging.open",
                    sublabelFallback = "Open",
                ),
            category = CommandCenterCategory.Charging,
            type = CommandType.Action,
            glyph = CommandGlyph.Bolt,
        ),
        CommandCenterCommand(
            id = "close_charge_port",
            command = "close_charge_port",
            labels =
                CommandLabels(
                    labelKey = "commands.charging.chargePort",
                    labelFallback = "Charge Port",
                    sublabelKey = "commands.charging.close",
                    sublabelFallback = "Close",
                ),
            category = CommandCenterCategory.Charging,
            type = CommandType.Action,
            glyph = CommandGlyph.Bolt,
        ),
        CommandCenterCommand(
            id = "charge",
            command = "charge_start",
            commandOff = "charge_stop",
            labels = CommandLabels(labelKey = "commands.charging.charge", labelFallback = "Charge"),
            category = CommandCenterCategory.Charging,
            type = CommandType.Toggle,
            glyph = CommandGlyph.Bolt,
            variant = CommandVariant.Success,
            stateField = ToggleField.IsCharging,
        ),
        CommandCenterCommand(
            id = "charge_max_range",
            command = "charge_max_range",
            labels =
                CommandLabels(
                    labelKey = "commands.charging.maxRange",
                    labelFallback = "Max Range",
                    sublabelKey = "commands.charging.tripMode",
                    sublabelFallback = "Trip mode",
                ),
            category = CommandCenterCategory.Charging,
            type = CommandType.Action,
            glyph = CommandGlyph.Battery,
            variant = CommandVariant.Danger,
        ),
        CommandCenterCommand(
            id = "charge_standard",
            command = "charge_standard",
            labels =
                CommandLabels(
                    labelKey = "commands.charging.standard",
                    labelFallback = "Standard",
                    sublabelKey = "commands.charging.dailyMode",
                    sublabelFallback = "Daily mode",
                ),
            category = CommandCenterCategory.Charging,
            type = CommandType.Action,
            glyph = CommandGlyph.Battery,
            variant = CommandVariant.Success,
        ),
        CommandCenterCommand(
            id = "set_charging_amps",
            command = "set_charging_amps",
            labels =
                CommandLabels(
                    labelKey = "commands.charging.setAmps",
                    labelFallback = "Set Amps",
                    sublabelKey = "commands.charging.amperage",
                    sublabelFallback = "Amperage",
                ),
            category = CommandCenterCategory.Charging,
            type = CommandType.Input,
            glyph = CommandGlyph.Gauge,
            input =
                InputConfigDef(
                    promptKey = "commands.charging.enterAmps",
                    promptFallback = "Enter charging amps (e.g., 16, 32, 48):",
                    paramName = "charging_amps",
                    validation = InputValidation.Number,
                ),
        ),
        CommandCenterCommand(
            id = "set_charge_limit",
            command = "set_charge_limit",
            labels =
                CommandLabels(
                    labelKey = "commands.charging.setLimit",
                    labelFallback = "Set Limit",
                    sublabelKey = "commands.charging.percent",
                    sublabelFallback = "Charge %",
                ),
            category = CommandCenterCategory.Charging,
            type = CommandType.Input,
            glyph = CommandGlyph.Battery,
            input =
                InputConfigDef(
                    promptKey = "commands.charging.enterLimit",
                    promptFallback = "Enter charge limit % (50–100):",
                    paramName = "percent",
                    validation = InputValidation.Number,
                    defaultValue = "80",
                ),
        ),
        // ── Doors & Trunk — 2 entries ────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "frunk_open",
            command = "frunk_open",
            labels =
                CommandLabels(
                    labelKey = "commands.doors.frunk",
                    labelFallback = "Frunk",
                    sublabelKey = "commands.doors.open",
                    sublabelFallback = "Open",
                ),
            category = CommandCenterCategory.Doors,
            type = CommandType.Action,
            glyph = CommandGlyph.Door,
            defaultFavorite = true,
        ),
        CommandCenterCommand(
            id = "trunk_open",
            command = "trunk_open",
            labels =
                CommandLabels(
                    labelKey = "commands.doors.trunk",
                    labelFallback = "Trunk",
                    sublabelKey = "commands.doors.open",
                    sublabelFallback = "Open",
                ),
            category = CommandCenterCategory.Doors,
            type = CommandType.Action,
            glyph = CommandGlyph.Door,
        ),
        // ── Drive — 1 entry ──────────────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "remote_start_drive",
            command = "remote_start_drive",
            labels =
                CommandLabels(
                    labelKey = "commands.drive.remoteStart",
                    labelFallback = "Remote Start",
                    sublabelKey = "commands.drive.keylessDrive",
                    sublabelFallback = "Keyless drive",
                ),
            category = CommandCenterCategory.Drive,
            type = CommandType.Action,
            glyph = CommandGlyph.Car,
            variant = CommandVariant.Danger,
            dangerous = true,
            confirm =
                ConfirmConfig(
                    confirmKey = "commands.drive.confirmRemoteStart",
                    confirmFallback = "This will enable keyless driving for 2 minutes. Continue?",
                    countdown = 3,
                ),
        ),
        // ── Windows — 2 entries ──────────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "vent_windows",
            command = "vent_windows",
            labels = CommandLabels(labelKey = "commands.windows.vent", labelFallback = "Vent Windows"),
            category = CommandCenterCategory.Windows,
            type = CommandType.Action,
            glyph = CommandGlyph.Window,
        ),
        CommandCenterCommand(
            id = "close_windows",
            command = "close_windows",
            labels = CommandLabels(labelKey = "commands.windows.close", labelFallback = "Close Windows"),
            category = CommandCenterCategory.Windows,
            type = CommandType.Action,
            glyph = CommandGlyph.Window,
        ),
        // ── Sunroof — 3 entries ──────────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "sunroof_vent",
            command = "sunroof_vent",
            labels =
                CommandLabels(
                    labelKey = "commands.sunroof.vent",
                    labelFallback = "Sunroof",
                    sublabelKey = "commands.sunroof.ventMode",
                    sublabelFallback = "Vent",
                ),
            category = CommandCenterCategory.Sunroof,
            type = CommandType.Action,
            glyph = CommandGlyph.Sun,
        ),
        CommandCenterCommand(
            id = "sunroof_close",
            command = "sunroof_close",
            labels =
                CommandLabels(
                    labelKey = "commands.sunroof.close",
                    labelFallback = "Sunroof",
                    sublabelKey = "commands.sunroof.closeMode",
                    sublabelFallback = "Close",
                ),
            category = CommandCenterCategory.Sunroof,
            type = CommandType.Action,
            glyph = CommandGlyph.Sun,
        ),
        CommandCenterCommand(
            id = "sunroof_stop",
            command = "sunroof_stop",
            labels =
                CommandLabels(
                    labelKey = "commands.sunroof.stop",
                    labelFallback = "Sunroof",
                    sublabelKey = "commands.sunroof.stopMode",
                    sublabelFallback = "Stop",
                ),
            category = CommandCenterCategory.Sunroof,
            type = CommandType.Action,
            glyph = CommandGlyph.Sun,
        ),
        // ── Schedules — 4 entries ────────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "add_charge_schedule",
            command = "add_charge_schedule",
            labels =
                CommandLabels(
                    labelKey = "commands.schedules.addCharge",
                    labelFallback = "Add Charge Schedule",
                    sublabelKey = "commands.schedules.midnight",
                    sublabelFallback = "Midnight daily",
                ),
            category = CommandCenterCategory.Schedules,
            type = CommandType.Action,
            glyph = CommandGlyph.Calendar,
            variant = CommandVariant.Success,
            params =
                mapOf(
                    "id" to "0",
                    "name" to "Default",
                    "days_of_week" to "127",
                    "start_enabled" to "true",
                    "start_time" to "0",
                    "end_enabled" to "false",
                    "end_time" to "0",
                    "one_time" to "false",
                ),
        ),
        CommandCenterCommand(
            id = "remove_charge_schedule",
            command = "remove_charge_schedule",
            labels =
                CommandLabels(
                    labelKey = "commands.schedules.removeCharge",
                    labelFallback = "Remove Schedule",
                    sublabelKey = "commands.schedules.byId",
                    sublabelFallback = "By ID",
                ),
            category = CommandCenterCategory.Schedules,
            type = CommandType.Input,
            glyph = CommandGlyph.CalendarMinus,
            variant = CommandVariant.Danger,
            input =
                InputConfigDef(
                    promptKey = "commands.schedules.enterScheduleId",
                    promptFallback = "Enter schedule ID to remove:",
                    paramName = "id",
                ),
        ),
        CommandCenterCommand(
            id = "add_precondition_schedule",
            command = "add_precondition_schedule",
            labels =
                CommandLabels(
                    labelKey = "commands.schedules.addPrecondition",
                    labelFallback = "Add Precondition",
                    sublabelKey = "commands.schedules.morning",
                    sublabelFallback = "7 AM daily",
                ),
            category = CommandCenterCategory.Schedules,
            type = CommandType.Action,
            glyph = CommandGlyph.Calendar,
            variant = CommandVariant.Success,
            params =
                mapOf(
                    "id" to "0",
                    "name" to "Morning",
                    "days_of_week" to "127",
                    "precondition_time" to "420",
                    "one_time" to "false",
                ),
        ),
        CommandCenterCommand(
            id = "remove_precondition_schedule",
            command = "remove_precondition_schedule",
            labels =
                CommandLabels(
                    labelKey = "commands.schedules.removePrecondition",
                    labelFallback = "Remove Precondition",
                    sublabelKey = "commands.schedules.byId",
                    sublabelFallback = "By ID",
                ),
            category = CommandCenterCategory.Schedules,
            type = CommandType.Input,
            glyph = CommandGlyph.CalendarMinus,
            variant = CommandVariant.Danger,
            input =
                InputConfigDef(
                    promptKey = "commands.schedules.enterScheduleId",
                    promptFallback = "Enter schedule ID to remove:",
                    paramName = "id",
                ),
        ),
        // ── Alerts & Location — 5 entries ────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "honk_horn",
            command = "honk_horn",
            labels = CommandLabels(labelKey = "commands.alerts.horn", labelFallback = "Horn"),
            category = CommandCenterCategory.Alerts,
            type = CommandType.Action,
            glyph = CommandGlyph.Volume,
            variant = CommandVariant.Danger,
            defaultFavorite = true,
        ),
        CommandCenterCommand(
            id = "flash_lights",
            command = "flash_lights",
            labels = CommandLabels(labelKey = "commands.alerts.flashLights", labelFallback = "Flash Lights"),
            category = CommandCenterCategory.Alerts,
            type = CommandType.Action,
            glyph = CommandGlyph.Bolt,
        ),
        CommandCenterCommand(
            id = "boombox_fart",
            command = "boombox_fart",
            labels =
                CommandLabels(
                    labelKey = "commands.alerts.boombox",
                    labelFallback = "Boombox",
                    sublabelKey = "commands.alerts.randomFart",
                    sublabelFallback = "Random fart",
                ),
            category = CommandCenterCategory.Alerts,
            type = CommandType.Action,
            glyph = CommandGlyph.Speaker,
        ),
        CommandCenterCommand(
            id = "boombox_ping",
            command = "boombox_ping",
            labels =
                CommandLabels(
                    labelKey = "commands.alerts.locatePing",
                    labelFallback = "Locate Ping",
                    sublabelKey = "commands.alerts.findMyCar",
                    sublabelFallback = "Find my car",
                ),
            category = CommandCenterCategory.Alerts,
            type = CommandType.Action,
            glyph = CommandGlyph.Navigation,
        ),
        CommandCenterCommand(
            id = "trigger_homelink",
            command = "trigger_homelink",
            labels =
                CommandLabels(
                    labelKey = "commands.homelink.trigger",
                    labelFallback = "HomeLink",
                    sublabelKey = "commands.homelink.garage",
                    sublabelFallback = "Garage door",
                ),
            category = CommandCenterCategory.Alerts,
            type = CommandType.Input,
            glyph = CommandGlyph.Door,
            input =
                InputConfigDef(
                    promptKey = "commands.homelink.triggerTitle",
                    promptFallback = "Enter vehicle coordinates",
                    paramName = "",
                    fields =
                        listOf(
                            InputFieldDef("lat", "commands.homelink.latitude", "Latitude", "37.7749", InputValidation.Decimal),
                            InputFieldDef("lon", "commands.homelink.longitude", "Longitude", "-122.4194", InputValidation.Decimal),
                        ),
                ),
        ),
        // ── Navigation — 3 entries ───────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "navigation_request",
            command = "navigation_request",
            labels =
                CommandLabels(
                    labelKey = "commands.nav.sendAddress",
                    labelFallback = "Send Address",
                    sublabelKey = "commands.nav.toVehicleNav",
                    sublabelFallback = "To vehicle nav",
                ),
            category = CommandCenterCategory.Navigation,
            type = CommandType.Input,
            glyph = CommandGlyph.Navigation,
            input =
                InputConfigDef(
                    promptKey = "commands.nav.enterAddress",
                    promptFallback = "Enter destination address:",
                    paramName = "address",
                    validation = InputValidation.Text,
                ),
        ),
        CommandCenterCommand(
            id = "navigation_gps_request",
            command = "navigation_gps_request",
            labels =
                CommandLabels(
                    labelKey = "commands.nav.sendGPS",
                    labelFallback = "Send GPS",
                    sublabelKey = "commands.nav.coordinates",
                    sublabelFallback = "Lat / Lon",
                ),
            category = CommandCenterCategory.Navigation,
            type = CommandType.Input,
            glyph = CommandGlyph.Navigation,
            input =
                InputConfigDef(
                    promptKey = "commands.nav.sendGPSTitle",
                    promptFallback = "Enter GPS coordinates",
                    paramName = "",
                    fields =
                        listOf(
                            InputFieldDef("lat", "commands.nav.latitude", "Latitude", "37.7749", InputValidation.Decimal),
                            InputFieldDef("lon", "commands.nav.longitude", "Longitude", "-122.4194", InputValidation.Decimal),
                        ),
                ),
        ),
        CommandCenterCommand(
            id = "navigation_sc_request",
            command = "navigation_sc_request",
            labels =
                CommandLabels(
                    labelKey = "commands.nav.supercharger",
                    labelFallback = "Supercharger",
                    sublabelKey = "commands.nav.byId",
                    sublabelFallback = "By ID",
                ),
            category = CommandCenterCategory.Navigation,
            type = CommandType.Input,
            glyph = CommandGlyph.Bolt,
            input =
                InputConfigDef(
                    promptKey = "commands.nav.enterScId",
                    promptFallback = "Enter Supercharger ID:",
                    paramName = "id",
                    validation = InputValidation.Number,
                ),
            params = mapOf("order" to "0"),
        ),
        // ── Software — 2 entries ─────────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "schedule_software_update",
            command = "schedule_software_update",
            labels =
                CommandLabels(
                    labelKey = "commands.software.scheduleUpdate",
                    labelFallback = "Schedule Update",
                    sublabelKey = "commands.software.installNow",
                    sublabelFallback = "Install now",
                ),
            category = CommandCenterCategory.Software,
            type = CommandType.Input,
            glyph = CommandGlyph.Download,
            variant = CommandVariant.Success,
            input =
                InputConfigDef(
                    promptKey = "commands.software.enterDelay",
                    promptFallback = "Install in how many minutes? (0 = now, 120 = 2 hours)",
                    paramName = "offset_sec",
                    validation = InputValidation.Number,
                    defaultValue = "0",
                ),
        ),
        CommandCenterCommand(
            id = "cancel_software_update",
            command = "cancel_software_update",
            labels =
                CommandLabels(
                    labelKey = "commands.software.cancelUpdate",
                    labelFallback = "Cancel Update",
                    sublabelKey = "commands.software.stopPending",
                    sublabelFallback = "Stop pending",
                ),
            category = CommandCenterCategory.Software,
            type = CommandType.Action,
            glyph = CommandGlyph.Download,
            variant = CommandVariant.Danger,
        ),
        // ── Vehicle — 1 entry ────────────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "set_vehicle_name",
            command = "set_vehicle_name",
            labels =
                CommandLabels(
                    labelKey = "commands.vehicle.rename",
                    labelFallback = "Rename",
                    sublabelKey = "commands.vehicle.changeName",
                    sublabelFallback = "Change name",
                ),
            category = CommandCenterCategory.Vehicle,
            type = CommandType.Input,
            glyph = CommandGlyph.Pencil,
            input =
                InputConfigDef(
                    promptKey = "commands.vehicle.enterName",
                    promptFallback = "Enter new vehicle name:",
                    paramName = "vehicle_name",
                    validation = InputValidation.Text,
                ),
        ),
        // ── Media — 7 entries ────────────────────────────────────────────────────────────────────────
        CommandCenterCommand(
            id = "media_toggle_playback",
            command = "media_toggle_playback",
            labels = CommandLabels(labelKey = "commands.media.playPause", labelFallback = "Play / Pause"),
            category = CommandCenterCategory.Media,
            type = CommandType.Action,
            glyph = CommandGlyph.PlayMedia,
        ),
        CommandCenterCommand(
            id = "media_prev_track",
            command = "media_prev_track",
            labels = CommandLabels(labelKey = "commands.media.prevTrack", labelFallback = "Prev Track"),
            category = CommandCenterCategory.Media,
            type = CommandType.Action,
            glyph = CommandGlyph.PlayMedia,
        ),
        CommandCenterCommand(
            id = "media_next_track",
            command = "media_next_track",
            labels = CommandLabels(labelKey = "commands.media.nextTrack", labelFallback = "Next Track"),
            category = CommandCenterCategory.Media,
            type = CommandType.Action,
            glyph = CommandGlyph.PlayMedia,
        ),
        CommandCenterCommand(
            id = "media_prev_fav",
            command = "media_prev_fav",
            labels = CommandLabels(labelKey = "commands.media.prevFav", labelFallback = "Prev Favorite"),
            category = CommandCenterCategory.Media,
            type = CommandType.Action,
            glyph = CommandGlyph.PlayMedia,
        ),
        CommandCenterCommand(
            id = "media_next_fav",
            command = "media_next_fav",
            labels = CommandLabels(labelKey = "commands.media.nextFav", labelFallback = "Next Favorite"),
            category = CommandCenterCategory.Media,
            type = CommandType.Action,
            glyph = CommandGlyph.PlayMedia,
        ),
        CommandCenterCommand(
            id = "adjust_volume",
            command = "adjust_volume",
            labels = CommandLabels(labelKey = "commands.media.volumeUp", labelFallback = "Volume Up"),
            category = CommandCenterCategory.Media,
            type = CommandType.Input,
            glyph = CommandGlyph.Volume,
            input =
                InputConfigDef(
                    promptKey = "commands.media.enterVolume",
                    promptFallback = "Enter volume level (0.0 – 11.0):",
                    paramName = "volume",
                    validation = InputValidation.Decimal,
                    defaultValue = "5",
                ),
        ),
        CommandCenterCommand(
            id = "media_volume_down",
            command = "media_volume_down",
            labels = CommandLabels(labelKey = "commands.media.volumeDown", labelFallback = "Volume Down"),
            category = CommandCenterCategory.Media,
            type = CommandType.Action,
            glyph = CommandGlyph.Volume,
        ),
    )
