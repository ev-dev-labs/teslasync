// Package nlq carves the NL-to-query/composer tool family out of the parent
// internal/ai/tools/ flat package per ADR-011 §3 + ADR-015-amend (AI
// subsystem in scope for Phase R, file-move-only).
//
// All three tools share the NL "two-step" pattern with sibling nl/ but
// specifically deal with COMPOSITIONAL OUTPUTS — the LLM drafts a
// structured layout/panel/SQL document, a Go validator hardens it
// against the scoped catalog before persistence:
//
//	dashboard.go — RegisterNLDashboardComposerTools (DashboardLayoutDraft +
//	               DashboardEnvelope + DashboardSlot{,Grid}; the dashboard-
//	               composer-scope context injection narrows which panels
//	               the LLM is allowed to compose)
//	grafana.go   — RegisterNLGrafanaPanelTools (GrafanaPanelDraft +
//	               GrafanaPanelEnvelope + DatasourceRef + Target + GridPos;
//	               WithGrafanaPanelScope narrows panel types, datasource
//	               types, and tables the LLM can target; SQL-target
//	               validation enforces read-only against the scoped tables)
//	sql.go       — RegisterNLSqlPlaygroundTools (ReadonlySQLDraft +
//	               ForbiddenReadonlySQLKeywords + WithScopedSchemaCatalog;
//	               read-only enforcement is the AI-Off-Contract surface)
//
// None of the three tools have their own _test.go files — they are
// indirectly covered by the strategy-package tests under
// internal/ai/strategies/nl-{dashboard-composer,grafana-panel,sql-playground}/.
//
// Alias convention (ADR-011 §3): callsites importing this alongside other
// clusters MAY alias as `nlqaitools`. The composition root in
// internal/api/router.go imports without alias.
//
// Layer: domain
package nlq
