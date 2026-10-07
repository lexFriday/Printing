DROP POLICY IF EXISTS "item templates active read" ON public.item_templates;
CREATE POLICY "item templates active read" ON public.item_templates
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND is_active = true);
