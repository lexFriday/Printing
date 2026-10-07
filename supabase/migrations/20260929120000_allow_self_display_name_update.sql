BEGIN;

CREATE OR REPLACE FUNCTION public.update_own_display_name(p_display_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Active account required';
  END IF;
  IF NULLIF(trim(p_display_name), '') IS NULL OR length(trim(p_display_name)) > 120 THEN
    RAISE EXCEPTION 'Name is required and must be 120 characters or fewer';
  END IF;
  UPDATE public.profiles SET display_name = trim(p_display_name) WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_own_display_name(text) TO authenticated;
COMMIT;
