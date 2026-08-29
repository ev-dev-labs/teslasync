package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
)

// commandDef defines how a frontend command name maps to the Tesla API.
type commandDef struct {
	endpoint string                 // Tesla API endpoint name
	params   map[string]interface{} // default params to merge with user-provided params
	noProxy  bool                   // true = send directly to Fleet API (e.g. wake_up)
}

// commands maps frontend command names to Tesla Fleet API endpoints with default params.
// Reference: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands
var commands = map[string]commandDef{
	// Wake — does NOT require signing, goes direct to Fleet API
	"wake":    {endpoint: "wake_up", noProxy: true},
	"wake_up": {endpoint: "wake_up", noProxy: true},

	// Security & Access
	"lock":                        {endpoint: "door_lock"},
	"unlock":                      {endpoint: "door_unlock"},
	"set_sentry_mode":             {endpoint: "set_sentry_mode", params: map[string]interface{}{"on": true}},
	"sentry_on":                   {endpoint: "set_sentry_mode", params: map[string]interface{}{"on": true}},
	"sentry_off":                  {endpoint: "set_sentry_mode", params: map[string]interface{}{"on": false}},
	"speed_limit_on":              {endpoint: "speed_limit_activate"},
	"speed_limit_off":             {endpoint: "speed_limit_deactivate"},
	"speed_limit_set_limit":       {endpoint: "speed_limit_set_limit"},
	"speed_limit_clear_pin":       {endpoint: "speed_limit_clear_pin"},
	"speed_limit_clear_pin_admin": {endpoint: "speed_limit_clear_pin_admin"},
	"guest_mode_on":               {endpoint: "guest_mode", params: map[string]interface{}{"enable": true}},
	"guest_mode_off":              {endpoint: "guest_mode", params: map[string]interface{}{"enable": false}},
	"erase_user_data":             {endpoint: "erase_user_data"},

	// Valet Mode
	"valet_on":        {endpoint: "set_valet_mode", params: map[string]interface{}{"on": true}},
	"valet_off":       {endpoint: "set_valet_mode", params: map[string]interface{}{"on": false}},
	"set_valet_mode":  {endpoint: "set_valet_mode"},
	"reset_valet_pin": {endpoint: "reset_valet_pin"},

	// PIN to Drive
	"set_pin_to_drive":         {endpoint: "set_pin_to_drive"},
	"reset_pin_to_drive_pin":   {endpoint: "reset_pin_to_drive_pin"},
	"clear_pin_to_drive_admin": {endpoint: "clear_pin_to_drive_admin"},

	// Climate
	"climate_on":  {endpoint: "auto_conditioning_start"},
	"climate_off": {endpoint: "auto_conditioning_stop"},
	"set_temps":   {endpoint: "set_temps"},

	// Seat & Steering Wheel Climate
	"seat_heater":          {endpoint: "remote_seat_heater_request"},
	"seat_cooler":          {endpoint: "remote_seat_cooler_request"},
	"auto_seat_climate":    {endpoint: "remote_auto_seat_climate_request"},
	"steering_wheel_heat":  {endpoint: "remote_steering_wheel_heater_request"},
	"steering_wheel_level": {endpoint: "remote_steering_wheel_heat_level_request"},
	"auto_steering_heat":   {endpoint: "remote_auto_steering_wheel_heat_climate_request"},

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

	// Charging
	"open_charge_port":  {endpoint: "charge_port_door_open"},
	"close_charge_port": {endpoint: "charge_port_door_close"},
	"charge_port_open":  {endpoint: "charge_port_door_open"},
	"charge_port_close": {endpoint: "charge_port_door_close"},
	"charge_start":      {endpoint: "charge_start"},
	"charge_stop":       {endpoint: "charge_stop"},
	"set_charge_limit":  {endpoint: "set_charge_limit"},
	"set_charging_amps": {endpoint: "set_charging_amps"},
	"charge_max_range":  {endpoint: "charge_max_range"},
	"charge_standard":   {endpoint: "charge_standard"},

	// Doors & Trunk
	"actuate_frunk": {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "front"}},
	"actuate_trunk": {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "rear"}},
	"frunk":         {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "front"}},
	"frunk_open":    {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "front"}},
	"trunk_open":    {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "rear"}},

	// Alerts
	"honk_horn":    {endpoint: "honk_horn"},
	"honk":         {endpoint: "honk_horn"},
	"flash_lights": {endpoint: "flash_lights"},
	"flash":        {endpoint: "flash_lights"},

	// Boombox
	"boombox_fart":   {endpoint: "remote_boombox", params: map[string]interface{}{"sound": 0}},
	"boombox_ping":   {endpoint: "remote_boombox", params: map[string]interface{}{"sound": 2000}},
	"remote_boombox": {endpoint: "remote_boombox"},

	// Windows
	"vent_windows":  {endpoint: "window_control", params: map[string]interface{}{"command": "vent"}},
	"close_windows": {endpoint: "window_control", params: map[string]interface{}{"command": "close"}},

	// Sunroof
	"sunroof_vent":  {endpoint: "sun_roof_control", params: map[string]interface{}{"state": "vent"}},
	"sunroof_close": {endpoint: "sun_roof_control", params: map[string]interface{}{"state": "close"}},
	"sunroof_stop":  {endpoint: "sun_roof_control", params: map[string]interface{}{"state": "stop"}},

	// HomeLink
	"trigger_homelink": {endpoint: "trigger_homelink"},

	// Drive
	"remote_start_drive": {endpoint: "remote_start_drive"},

	// Media
	"media_toggle_playback": {endpoint: "media_toggle_playback"},
	"media_next_track":      {endpoint: "media_next_track"},
	"media_prev_track":      {endpoint: "media_prev_track"},
	"media_next_fav":        {endpoint: "media_next_fav"},
	"media_prev_fav":        {endpoint: "media_prev_fav"},
	"media_volume_down":     {endpoint: "media_volume_down"},
	"adjust_volume":         {endpoint: "adjust_volume"},

	// Scheduling (legacy)
	"set_scheduled_departure": {endpoint: "set_scheduled_departure"},
	"set_scheduled_charging":  {endpoint: "set_scheduled_charging"},

	// Schedules (firmware 2024.26+)
	"add_charge_schedule":          {endpoint: "add_charge_schedule"},
	"remove_charge_schedule":       {endpoint: "remove_charge_schedule"},
	"add_precondition_schedule":    {endpoint: "add_precondition_schedule"},
	"remove_precondition_schedule": {endpoint: "remove_precondition_schedule"},

	// Navigation
	"navigation_request":     {endpoint: "navigation_request"},
	"navigation_gps_request": {endpoint: "navigation_gps_request"},
	"navigation_sc_request":  {endpoint: "navigation_sc_request"},

	// Software Updates
	"schedule_software_update": {endpoint: "schedule_software_update"},
	"cancel_software_update":   {endpoint: "cancel_software_update"},

	// Vehicle
	"set_vehicle_name": {endpoint: "set_vehicle_name"},
}

// IsKnownCommand reports whether the given name is a supported Tesla command.
// Used by the automation action executor for parse-time validation.
func IsKnownCommand(name string) bool {
	_, ok := commands[name]
	return ok
}

// SendCommand sends a named command to a vehicle via the Fleet API or the
// Vehicle Command Proxy (if configured). Commands that require signing are
// routed through the proxy; wake_up goes directly to Fleet API.
func (c *Client) SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) (err error) {
	ctx, span := startSpan(ctx, "tesla.SendCommand",
		attribute.String("tesla.vehicle.vin", vin),
		attribute.String("tesla.command", command),
	)
	defer endSpan(span, &err)

	def, ok := commands[command]
	if !ok {
		return fmt.Errorf("unknown command: %s", command)
	}

	merged := make(map[string]interface{})
	for k, v := range def.params {
		merged[k] = v
	}
	for k, v := range params {
		merged[k] = v
	}

	var bodyReader io.Reader
	if len(merged) > 0 {
		bodyBytes, err := json.Marshal(merged)
		if err != nil {
			return fmt.Errorf("marshal params: %w", err)
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	path := fmt.Sprintf("/api/1/vehicles/%s/command/%s", vin, def.endpoint)

	// Route through Vehicle Command Proxy for signed commands
	if !def.noProxy && c.commandProxyURL != "" {
		return c.doProxyRequest(ctx, path, bodyReader)
	}

	_, status, err := c.doRequest(ctx, http.MethodPost, path, bodyReader)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("command %s: status %d", command, status)
	}
	return nil
}

// doProxyRequest sends a command through the Vehicle Command Proxy for signing.
func (c *Client) doProxyRequest(ctx context.Context, path string, body io.Reader) (err error) {
	ctx, span := startSpan(ctx, "tesla.proxy POST "+path,
		attribute.String("http.request.method", http.MethodPost),
		attribute.String("tesla.proxy.path", path),
	)
	defer endSpan(span, &err)

	if waitErr := c.limiter.Wait(ctx); waitErr != nil {
		return fmt.Errorf("rate limiter: %w", waitErr)
	}
	if budgetErr := c.reserveBudget(ctx, http.MethodPost, path); budgetErr != nil {
		return budgetErr
	}

	reqURL := c.commandProxyURL + path

	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, _ = io.ReadAll(body)
		body = bytes.NewReader(reqBodyBytes)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, body)
	if err != nil {
		return fmt.Errorf("create proxy request: %w", err)
	}

	c.mu.RLock()
	token := c.accessToken
	c.mu.RUnlock()

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.proxyClient.Do(req)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		log.Error().Err(err).Str("url", reqURL).Msg("proxy request failed")
		return fmt.Errorf("proxy request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	log.Debug().
		Str("url", reqURL).
		Int("status", resp.StatusCode).
		Int64("duration_ms", duration).
		Msg("proxy command sent")

	if c.logCallback != nil {
		c.logCallback(http.MethodPost, reqURL, resp.StatusCode, reqBodyBytes, respBody, int(duration), nil)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("proxy command failed: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Response struct {
			Result bool   `json:"result"`
			Reason string `json:"reason"`
		} `json:"response"`
	}
	if err := json.Unmarshal(respBody, &result); err == nil && !result.Response.Result && result.Response.Reason != "" {
		return fmt.Errorf("command rejected: %s", result.Response.Reason)
	}

	return nil
}

// doProxyRequestWithResponse sends a request through the Vehicle Command Proxy
// and returns the raw response body and status code (for endpoints like fleet_telemetry_config).
func (c *Client) doProxyRequestWithResponse(ctx context.Context, method, path string, body io.Reader) (respBody []byte, statusCode int, err error) {
	ctx, span := startSpan(ctx, "tesla.proxy "+method+" "+path,
		attribute.String("http.request.method", method),
		attribute.String("tesla.proxy.path", path),
	)
	defer func() {
		recordHTTPStatus(span, method, c.commandProxyURL+path, statusCode)
		endSpan(span, &err)
	}()

	if waitErr := c.limiter.Wait(ctx); waitErr != nil {
		return nil, 0, fmt.Errorf("rate limiter: %w", waitErr)
	}
	if budgetErr := c.reserveBudget(ctx, method, path); budgetErr != nil {
		return nil, budgetHTTPStatus(budgetErr), budgetErr
	}

	reqURL := c.commandProxyURL + path

	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, _ = io.ReadAll(body)
		body = bytes.NewReader(reqBodyBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, body)
	if err != nil {
		return nil, 0, fmt.Errorf("create proxy request: %w", err)
	}

	c.mu.RLock()
	token := c.accessToken
	c.mu.RUnlock()

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.proxyClient.Do(req)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		log.Error().Err(err).Str("url", reqURL).Msg("proxy request failed")
		return nil, 0, fmt.Errorf("proxy request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ = io.ReadAll(resp.Body)

	log.Debug().
		Str("url", reqURL).
		Int("status", resp.StatusCode).
		Int64("duration_ms", duration).
		Msg("proxy request sent")

	if c.logCallback != nil {
		c.logCallback(method, reqURL, resp.StatusCode, reqBodyBytes, respBody, int(duration), nil)
	}

	statusCode = resp.StatusCode
	return respBody, statusCode, nil
}
