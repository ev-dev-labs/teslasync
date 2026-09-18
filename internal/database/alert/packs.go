package alert

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/alertpacks"
	"github.com/jackc/pgx/v5"
)

func (r *AlertRuleRepo) packReady() error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return errors.New("alert packs: database unavailable")
	}
	return nil
}

func (r *AlertRuleRepo) ListPackInstallations(ctx context.Context, limit, offset int) ([]alertpacks.Installation, error) {
	if err := r.packReady(); err != nil {
		return nil, err
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT i.id, i.pack_id, i.name, i.version, i.scope_key, i.created_at,
		m.template_id, m.rule_id, COALESCE(r.name, m.name), m.owned, COALESCE(r.enabled, false),
		EXISTS(SELECT 1 FROM alert_pack_members other WHERE other.rule_id=m.rule_id AND other.installation_id<>i.id)
		FROM (SELECT id, pack_id, name, version, scope_key, created_at FROM alert_pack_installations
			ORDER BY id DESC LIMIT $1 OFFSET $2) i
		JOIN alert_pack_members m ON m.installation_id=i.id
		LEFT JOIN alert_rules r ON r.id=m.rule_id ORDER BY i.id DESC, m.template_id`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list alert packs: %w", err)
	}
	defer rows.Close()
	out := []alertpacks.Installation{}
	for rows.Next() {
		var i alertpacks.Installation
		var m alertpacks.Member
		if err := rows.Scan(&i.ID, &i.PackID, &i.Name, &i.Version, &i.ScopeKey, &i.CreatedAt,
			&m.TemplateID, &m.RuleID, &m.Name, &m.Owned, &m.Enabled, &m.Shared); err != nil {
			return nil, fmt.Errorf("scan alert pack: %w", err)
		}
		if len(out) == 0 || out[len(out)-1].ID != i.ID {
			i.Members = []alertpacks.Member{}
			out = append(out, i)
		}
		out[len(out)-1].Members = append(out[len(out)-1].Members, m)
	}
	return out, rows.Err()
}

// A table lock serializes pack installs with ordinary rule creation/updates.
// This makes matching existing conditions and inserting new rules one atomic
// operation even when another tab installs a different overlapping pack.
func (r *AlertRuleRepo) InstallPack(ctx context.Context, pack alertpacks.Pack, scope string, templates []alertpacks.Template) (*alertpacks.Installation, error) {
	if err := r.packReady(); err != nil {
		return nil, err
	}
	if len(templates) == 0 {
		return nil, errors.New("alert pack must include rules")
	}
	out := &alertpacks.Installation{PackID: pack.ID, Name: pack.Name, Version: pack.Version, ScopeKey: scope, Members: []alertpacks.Member{}}
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `LOCK TABLE alert_rules IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `INSERT INTO alert_pack_installations(pack_id,version,scope_key,name)
			VALUES ($1,$2,$3,$4) ON CONFLICT (pack_id,scope_key) DO NOTHING RETURNING id,created_at`,
			pack.ID, pack.Version, scope, pack.Name).Scan(&out.ID, &out.CreatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return alertpacks.ErrInstalled
		}
		if err != nil {
			return err
		}
		for _, t := range templates {
			rule := t.Rule
			// Reuse matching trigger/scope regardless of message, severity, or
			// enabled state. Never overwrite the user's existing configuration.
			var id int64
			var name string
			var enabled bool
			err := tx.QueryRow(ctx, `SELECT r.id,r.name,r.enabled FROM alert_rules r
				WHERE r.kind='signal' AND r.signal_name=$1 AND r.op=$2
				AND r.value_num IS NOT DISTINCT FROM $3::double precision
				AND r.value_text IS NOT DISTINCT FROM $4::text
				AND r.value_bool IS NOT DISTINCT FROM $5::boolean
				AND r.value_min IS NOT DISTINCT FROM $6::double precision
				AND r.value_max IS NOT DISTINCT FROM $7::double precision
				AND r.all_vehicles=$8
				AND ($8 OR ARRAY(SELECT vehicle_id FROM alert_rule_vehicles WHERE rule_id=r.id ORDER BY vehicle_id)=$9::bigint[])
				ORDER BY r.id LIMIT 1`,
				rule.SignalName, rule.Op, rule.ValueNum, rule.ValueText, rule.ValueBool,
				rule.ValueMin, rule.ValueMax, rule.AllVehicles, rule.VehicleIDs).Scan(&id, &name, &enabled)
			owned := errors.Is(err, pgx.ErrNoRows)
			if owned {
				if err := createRuleTx(ctx, tx, &rule); err != nil {
					return fmt.Errorf("create pack rule %s: %w", t.ID, err)
				}
				id, name, enabled = rule.ID, rule.Name, rule.Enabled
			} else if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO alert_pack_members(installation_id,template_id,rule_id,name,owned)
				VALUES ($1,$2,$3,$4,$5)`, out.ID, t.ID, id, name, owned); err != nil {
				return err
			}
			out.Members = append(out.Members, alertpacks.Member{TemplateID: t.ID, RuleID: &id, Name: name, Owned: owned, Enabled: enabled})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("install alert pack: %w", err)
	}
	return out, nil
}

// RemovePack deletes only explicitly selected, owned, unshared rules. Empty
// deleteIDs detaches the pack and preserves every rule, including user edits.
func (r *AlertRuleRepo) RemovePack(ctx context.Context, id int64, deleteIDs []int64) error {
	if err := r.packReady(); err != nil {
		return err
	}
	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `LOCK TABLE alert_rules IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		var found int64
		if err := tx.QueryRow(ctx, `SELECT id FROM alert_pack_installations WHERE id=$1 FOR UPDATE`, id).Scan(&found); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return alertpacks.ErrNotFound
			}
			return err
		}
		for _, ruleID := range dedupAndSortVehicleIDs(deleteIDs) {
			var allowed bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(
				SELECT 1 FROM alert_pack_members m WHERE m.installation_id=$1 AND m.rule_id=$2 AND m.owned
				AND NOT EXISTS(SELECT 1 FROM alert_pack_members other WHERE other.rule_id=$2 AND other.installation_id<>$1))`,
				id, ruleID).Scan(&allowed); err != nil {
				return err
			}
			if !allowed {
				return alertpacks.ErrSelection
			}
			if _, err := tx.Exec(ctx, `DELETE FROM alert_rules WHERE id=$1`, ruleID); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `DELETE FROM alert_pack_installations WHERE id=$1`, id)
		return err
	})
}
