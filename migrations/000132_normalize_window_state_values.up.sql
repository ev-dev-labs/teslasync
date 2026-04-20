-- Normalize window state enum values to canonical forms.
-- Tesla sends "WindowStateClosed", "WindowStatePartiallyOpen", "WindowStateOpened"
-- but downstream (rule engine, alert presets) expects "Closed", "Partial", "Open".

-- vehicle_live_state
UPDATE vehicle_live_state SET fd_window = CASE
    WHEN fd_window ILIKE '%closed%' THEN 'Closed'
    WHEN fd_window ILIKE '%partial%' THEN 'Partial'
    WHEN fd_window ILIKE '%open%' THEN 'Open'
    ELSE fd_window
END WHERE fd_window LIKE 'WindowState%';

UPDATE vehicle_live_state SET fp_window = CASE
    WHEN fp_window ILIKE '%closed%' THEN 'Closed'
    WHEN fp_window ILIKE '%partial%' THEN 'Partial'
    WHEN fp_window ILIKE '%open%' THEN 'Open'
    ELSE fp_window
END WHERE fp_window LIKE 'WindowState%';

UPDATE vehicle_live_state SET rd_window = CASE
    WHEN rd_window ILIKE '%closed%' THEN 'Closed'
    WHEN rd_window ILIKE '%partial%' THEN 'Partial'
    WHEN rd_window ILIKE '%open%' THEN 'Open'
    ELSE rd_window
END WHERE rd_window LIKE 'WindowState%';

UPDATE vehicle_live_state SET rp_window = CASE
    WHEN rp_window ILIKE '%closed%' THEN 'Closed'
    WHEN rp_window ILIKE '%partial%' THEN 'Partial'
    WHEN rp_window ILIKE '%open%' THEN 'Open'
    ELSE rp_window
END WHERE rp_window LIKE 'WindowState%';

-- security_events
UPDATE security_events SET fd_window = CASE
    WHEN fd_window ILIKE '%closed%' THEN 'Closed'
    WHEN fd_window ILIKE '%partial%' THEN 'Partial'
    WHEN fd_window ILIKE '%open%' THEN 'Open'
    ELSE fd_window
END WHERE fd_window LIKE 'WindowState%';

UPDATE security_events SET fp_window = CASE
    WHEN fp_window ILIKE '%closed%' THEN 'Closed'
    WHEN fp_window ILIKE '%partial%' THEN 'Partial'
    WHEN fp_window ILIKE '%open%' THEN 'Open'
    ELSE fp_window
END WHERE fp_window LIKE 'WindowState%';

UPDATE security_events SET rd_window = CASE
    WHEN rd_window ILIKE '%closed%' THEN 'Closed'
    WHEN rd_window ILIKE '%partial%' THEN 'Partial'
    WHEN rd_window ILIKE '%open%' THEN 'Open'
    ELSE rd_window
END WHERE rd_window LIKE 'WindowState%';

UPDATE security_events SET rp_window = CASE
    WHEN rp_window ILIKE '%closed%' THEN 'Closed'
    WHEN rp_window ILIKE '%partial%' THEN 'Partial'
    WHEN rp_window ILIKE '%open%' THEN 'Open'
    ELSE rp_window
END WHERE rp_window LIKE 'WindowState%';

-- signal_history
UPDATE signal_history SET value_str = CASE
    WHEN value_str ILIKE '%closed%' THEN 'Closed'
    WHEN value_str ILIKE '%partial%' THEN 'Partial'
    WHEN value_str ILIKE '%open%' THEN 'Open'
    ELSE value_str
END WHERE signal IN ('FdWindow', 'FpWindow', 'RdWindow', 'RpWindow')
  AND value_str LIKE 'WindowState%';
