package alert

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/alertpacks"
)

type packProposalInput struct {
	Name        string   `json:"name" validate:"required,max=100" desc:"Distinctive short group name without personal data."`
	TemplateIDs []string `json:"template_ids" validate:"required,min=2,max=500,dive,required" desc:"Unique template IDs from the supplied supported catalog. Include every relevant rule for comprehensive requests; there is no six-rule limit."`
	Rationale   string   `json:"rationale" validate:"required,max=1000" desc:"Explain why the group fits the goal and any limitations."`
}

type packProposal struct {
	Status      string   `json:"status"`
	Name        string   `json:"name"`
	TemplateIDs []string `json:"template_ids"`
	Rationale   string   `json:"rationale"`
}

type proposeAlertPack struct{}

func (*proposeAlertPack) Name() string { return "propose_alert_pack" }
func (*proposeAlertPack) Description() string {
	return "Validate and propose a custom Alert Pack from supported template IDs. Read-only: never installs or enables rules."
}
func (*proposeAlertPack) InputSchema() json.RawMessage {
	return tools.CachedSchema(packProposalInput{})
}
func (*proposeAlertPack) OutputSchema() json.RawMessage { return nil }
func (*proposeAlertPack) Mutates() bool                 { return false }
func (*proposeAlertPack) RequiredScope() string         { return "" }
func (*proposeAlertPack) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[packProposalInput](raw)
}
func (*proposeAlertPack) Execute(_ context.Context, input any) (any, error) {
	in, ok := input.(packProposalInput)
	if !ok {
		return nil, fmt.Errorf("propose_alert_pack: unexpected input %T", input)
	}
	catalog := alertpacks.CustomCatalog()
	request := alertpacks.InstallRequest{Version: catalog.Version, AllVehicles: true}
	for _, id := range in.TemplateIDs {
		request.Rules = append(request.Rules, alertpacks.Selection{TemplateID: id})
	}
	templates, _, err := alertpacks.Prepare(catalog, request)
	if err != nil {
		return nil, fmt.Errorf("propose_alert_pack: %w", err)
	}
	pack, err := alertpacks.NameCustom(catalog, in.Name, templates)
	if err != nil {
		return nil, err
	}
	return packProposal{Status: "ok", Name: pack.Name, TemplateIDs: in.TemplateIDs, Rationale: in.Rationale}, nil
}

func RegisterAlertPackTools(registry *tools.Registry) {
	registry.Register(&proposeAlertPack{})
}
