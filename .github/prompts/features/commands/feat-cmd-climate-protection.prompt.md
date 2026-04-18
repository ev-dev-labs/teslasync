---
description: "Add bioweapon defense mode, cabin overheat protection, climate keeper (Dog/Camp mode), and max preconditioning"
---

# Feature: Climate Protection Commands

## Overview

Add advanced climate protection commands: Bioweapon Defense Mode, Cabin Overheat Protection (COP),
Climate Keeper (Off/Keep/Dog/Camp modes), and Max Preconditioning. These extend the
Climate & Comfort group on the Commands page.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `set_bioweapon_mode` | `set_bioweapon_mode` | `on: bool`, `manual_override: bool` | Toggle Bioweapon Defense Mode |
| `set_cabin_overheat_protection` | `set_cabin_overheat_protection` | `on: bool`, `fan_only: bool` | Toggle COP (fan_only=true for no AC) |
| `set_cop_temp` | `set_cop_temp` | `cop_temp: 0\|1\|2` | COP temperature: 0=Low(90°F), 1=Medium(95°F), 2=High(100°F) |
| `set_climate_keeper_mode` | `set_climate_keeper_mode` | `climate_keeper_mode: 0\|1\|2\|3` | 0=Off, 1=Keep, 2=Dog, 3=Camp |
| `set_preconditioning_max` | `set_preconditioning_max` | `on: bool` | Override preconditioning to max |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Climate Protection
"bioweapon_on":          {endpoint: "set_bioweapon_mode", params: map[string]interface{}{"on": true, "manual_override": true}},
"bioweapon_off":         {endpoint: "set_bioweapon_mode", params: map[string]interface{}{"on": false, "manual_override": false}},
"cop_on":                {endpoint: "set_cabin_overheat_protection", params: map[string]interface{}{"on": true, "fan_only": false}},
"cop_fan_only":          {endpoint: "set_cabin_overheat_protection", params: map[string]interface{}{"on": true, "fan_only": true}},
"cop_off":               {endpoint: "set_cabin_overheat_protection", params: map[string]interface{}{"on": false, "fan_only": false}},
"set_cop_temp":          {endpoint: "set_cop_temp"},
"climate_keeper_off":    {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 0}},
"climate_keeper_on":     {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 1}},
"dog_mode":              {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 2}},
"camp_mode":             {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 3}},
"preconditioning_max":   {endpoint: "set_preconditioning_max", params: map[string]interface{}{"on": true}},
"preconditioning_reset": {endpoint: "set_preconditioning_max", params: map[string]interface{}{"on": false}},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"bioweapon_on":          true,
"bioweapon_off":         true,
"cop_on":                true,
"cop_fan_only":          true,
"cop_off":               true,
"set_cop_temp":          true,
"climate_keeper_off":    true,
"climate_keeper_on":     true,
"dog_mode":              true,
"camp_mode":             true,
"preconditioning_max":   true,
"preconditioning_reset": true,
```

## Step 3 — Frontend: Add Climate Protection group

Add a new `CommandGroup` titled "Climate Protection" in `CommandsPage.tsx`:

```tsx
<CommandGroup title="Climate Protection" t={t}>
  <CommandButton
    icon={<ShieldAlert className="h-5 w-5" />}
    label={t('commands.climate.bioweapon', 'Bioweapon')}
    sublabel={t('commands.climate.defenseMode', 'Defense Mode')}
    onClick={() => sendCmd('bioweapon_on')}
    loading={cmd.isPending}
    variant="danger"
  />
  <CommandButton
    icon={<Thermometer className="h-5 w-5" />}
    label={t('commands.climate.cop', 'Overheat Protect')}
    sublabel={t('commands.climate.copOn', 'On (AC)')}
    onClick={() => sendCmd('cop_on')}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<Dog className="h-5 w-5" />}
    label={t('commands.climate.dogMode', 'Dog Mode')}
    onClick={() => sendCmd('dog_mode')}
    loading={cmd.isPending}
    variant="success"
  />
  <CommandButton
    icon={<Tent className="h-5 w-5" />}
    label={t('commands.climate.campMode', 'Camp Mode')}
    onClick={() => sendCmd('camp_mode')}
    loading={cmd.isPending}
    variant="success"
  />
  <CommandButton
    icon={<Flame className="h-5 w-5" />}
    label={t('commands.climate.maxPrecondition', 'Max Precondition')}
    sublabel={t('commands.climate.override', 'Override')}
    onClick={() => sendCmd('preconditioning_max')}
    loading={cmd.isPending}
    variant="danger"
  />
</CommandGroup>
```

Add lucide-react imports: `ShieldAlert, Dog, Tent, Flame`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "bioweapon\|cop_\|climate_keeper\|dog_mode\|camp_mode\|preconditioning" internal/api/command_handler.go  # ≥ 10
```
