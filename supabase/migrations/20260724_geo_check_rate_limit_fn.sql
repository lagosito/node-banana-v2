-- Atomic rate limit increment function
-- Run AFTER the main migration

CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_ip TEXT,
  p_day DATE,
  p_max INT
) RETURNS INT AS $$
DECLARE
  new_count INT;
BEGIN
  INSERT INTO geo_check_rate_limits (ip, day, count)
  VALUES (p_ip, p_day, 1)
  ON CONFLICT (ip, day) DO UPDATE
    SET count = geo_check_rate_limits.count + 1
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
