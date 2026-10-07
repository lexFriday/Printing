CREATE OR REPLACE FUNCTION public.can_write_operations(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.is_active_user(_user_id)
    AND (
      public.has_role(_user_id, 'owner')
      OR public.has_role(_user_id, 'admin')
      OR public.has_role(_user_id, 'staff')
    )
$$;
