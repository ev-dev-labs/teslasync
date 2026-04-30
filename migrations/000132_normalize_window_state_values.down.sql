-- Down migration: restore prefixed window state values.
-- This is a best-effort reversal — only applies canonical → prefixed mapping.

UPDATE vehicle_live_state SET fd_window = 'WindowState' || fd_window
WHERE fd_window IN ('Closed', 'Partial', 'Open');

UPDATE vehicle_live_state SET fp_window = 'WindowState' || fp_window
WHERE fp_window IN ('Closed', 'Partial', 'Open');

UPDATE vehicle_live_state SET rd_window = 'WindowState' || rd_window
WHERE rd_window IN ('Closed', 'Partial', 'Open');

UPDATE vehicle_live_state SET rp_window = 'WindowState' || rp_window
WHERE rp_window IN ('Closed', 'Partial', 'Open');

UPDATE security_events SET fd_window = 'WindowState' || fd_window
WHERE fd_window IN ('Closed', 'Partial', 'Open');

UPDATE security_events SET fp_window = 'WindowState' || fp_window
WHERE fp_window IN ('Closed', 'Partial', 'Open');

UPDATE security_events SET rd_window = 'WindowState' || rd_window
WHERE rd_window IN ('Closed', 'Partial', 'Open');

UPDATE security_events SET rp_window = 'WindowState' || rp_window
WHERE rp_window IN ('Closed', 'Partial', 'Open');

UPDATE signal_history SET value_str = 'WindowState' || value_str
WHERE signal IN ('FdWindow', 'FpWindow', 'RdWindow', 'RpWindow')
  AND value_str IN ('Closed', 'Partial', 'Open');
