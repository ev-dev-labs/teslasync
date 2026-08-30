package app

import (
	"net"
	"strconv"
	"time"
)

const mqttBrokerProbeTimeout = 500 * time.Millisecond

// mqttPipelineLivenessError fails only when the dedicated Fleet Telemetry
// consumer is unhealthy while the auxiliary MQTT client or a bounded TCP
// probe proves the broker is reachable. A broker-wide outage stays live to
// avoid a Kubernetes restart storm; paho's reconnect loop handles that case.
func (a *App) mqttPipelineLivenessError() error {
	if a.pipelineSubscriber == nil {
		return nil
	}
	if a.pipelineSubscriber.IsHealthy() {
		return a.pipelineSubscriber.LivenessError(false)
	}

	brokerReachable := a.MQTT != nil && a.MQTT.IsConnected()
	if !brokerReachable && a.Cfg != nil {
		brokerReachable = mqttBrokerReachable(a.Cfg.MQTT.Host, a.Cfg.MQTT.Port)
	}
	return a.pipelineSubscriber.LivenessError(brokerReachable)
}

func mqttBrokerReachable(host string, port int) bool {
	if host == "" || port <= 0 {
		return false
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), mqttBrokerProbeTimeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
