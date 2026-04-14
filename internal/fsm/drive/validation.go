package drive

// Validate checks the completed drive session for impossible or suspicious values.
// Returns a list of issues found. An empty list means the data looks valid.
// Validation WARNS but never blocks persistence — data is always saved.
func Validate(ctx *Context) []string {
	var issues []string

	distance := ctx.Distance()
	duration := ctx.Duration()
	netEnergy := ctx.NetEnergy()

	// Distance sanity
	if distance <= 0 {
		issues = append(issues, "distance <= 0")
	}
	if distance > 500 {
		issues = append(issues, "distance > 500 miles — suspicious")
	}

	// Duration sanity
	if duration.Seconds() < 30 {
		issues = append(issues, "duration < 30s — micro-drive")
	}

	// Energy sanity
	if netEnergy < 0 {
		issues = append(issues, "net energy negative — regen > consumed")
	}

	// Efficiency sanity (Tesla typical: 200-400 Wh/mi)
	if distance > 0 {
		eff := ctx.Efficiency()
		if eff < 100 || eff > 600 {
			issues = append(issues, "efficiency outside 100-600 Wh/mi range")
		}
	}

	// Battery sanity
	if ctx.EndBattery > ctx.StartBattery+2 {
		issues = append(issues, "end battery > start battery (allow 2% regen margin)")
	}

	// Odometer sanity
	if ctx.EndOdometer > 0 && ctx.StartOdometer > 0 && ctx.EndOdometer < ctx.StartOdometer {
		issues = append(issues, "end odometer < start odometer")
	}

	return issues
}
