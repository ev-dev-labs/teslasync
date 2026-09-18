# Alert Packs

Open **Notifications → Studio → Alert Packs** to install a group of ordinary alert
rules. The existing templates, rule editor, notification delivery and evaluation
engine are unchanged.

The initial catalog contains six curated packs built from 13 validated signal
templates. Manual custom groups and Helix use this supported subset; the existing
254 individual templates remain available separately in Studio.

## Preview and install

Choose a curated pack or **Custom pack**. Select the rules you want, choose all
current and future vehicles or a specific subset, and review each trigger,
severity, message and cooldown. Numeric operands use canonical units; temperature
inputs are explicitly Celsius and the preview also displays your preferred unit.

New rules are **disabled by default**. Enable them during installation only if
you are ready to receive notifications. They use your existing channel
preferences and quiet hours; packs do not create a separate delivery system.
These telemetry alerts are not safety monitors and do not send vehicle commands.

Installation is atomic. A matching signal condition with the same vehicle scope
reuses the existing rule without changing its message, severity or enabled state.
The result identifies created and reused rules. Different thresholds or
overlapping scopes can still generate similar alerts.

The same pack cannot be installed twice for the same scope. Custom group identity
uses its name and selected template IDs. Catalog upgrades never automatically
change installed rules.

## Manage installed packs

Installed packs retain their version and membership. **Edit rule** opens the
ordinary Studio editor; rules can be edited, enabled, disabled or deleted there.
Deleted rules appear as deleted members instead of being recreated silently.

**Remove pack** keeps all rules unless you explicitly select owned rules for
deletion. Reused rules and rules shared with another pack cannot be deleted by
this operation. To change an installation's membership, remove its tracking
while keeping rules, then install the desired selection; matching rules will
be reused.

## Helix custom groups

Enable **Helix custom Alert Packs** in AI settings to describe a goal in Studio.
Helix proposes two to six rules from the same supported catalog as the manual
composer. It cannot invent new conditions, install rules or execute commands.
Review the proposed group, adjust its name and settings, and explicitly install.
Manual packs remain available when AI is disabled or the provider fails.

## Deployment

Migration `000245_alert_packs` adds installation and membership tables, without
altering the existing alert-rule schema. Leave it applied when rolling back the
application. Its down migration removes pack tracking only, not alert rules.

The pack installation request accepts `cooldown_s` (60 to 604800 seconds, in
whole-minute increments). The preview displays minutes; the existing ordinary
rule persistence contract is unchanged.

`TestPacksPostgres` requires `TESLASYNC_TEST_DB` pointing to a migrated test
database. It clones the alert-rule schema without rows into a temporary schema,
uses its own ID sequence, and removes that schema after the test.
