// Package teslausage connects worker-owned Tesla Fleet clients to the same
// outbound audit table read by the system status usage estimate.
package teslausage

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
)

// AuditService distinguishes direct Fleet responses from local command-proxy
// responses. A proxy-side 4xx does not prove Tesla received a billable call.
func AuditService(baseURL, requestURL string) string {
	base, baseErr := url.Parse(baseURL)
	request, requestErr := url.Parse(requestURL)
	if baseErr == nil && requestErr == nil && base.Host != "" && request.Host != "" &&
		!strings.EqualFold(base.Host, request.Host) {
		return "tesla-command-proxy"
	}
	return "tesla-api"
}

// BindClient logs one row per Tesla client callback, never per inbound API
// request or MQTT message. Audit write failures do not alter the command.
func BindClient(ctx context.Context, client *tesla.Client, db *database.DB) {
	repo := systemdb.NewAPICallLogRepo(db)
	client.SetLogCallback(func(method, url string, status int, _, _ []byte, duration int, callErr error) {
		entry := &teslamodel.APICallLog{
			HTTPMethod: method,
			Endpoint:   url,
			Service:    AuditService(client.BaseURL(), url),
			StatusCode: int16(status),
			DurationMs: int32(duration),
		}
		if callErr != nil {
			message := callErr.Error()
			entry.ErrorMessage = &message
		}
		auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := repo.Create(auditCtx, entry); err != nil {
			log.Ctx(auditCtx).Warn().Err(err).Msg("Tesla outbound audit unavailable; usage may undercount")
		}
	})
}
