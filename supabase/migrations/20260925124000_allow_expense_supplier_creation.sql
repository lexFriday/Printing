DROP POLICY IF EXISTS suppliers_authenticated_insert ON public.suppliers;
DROP POLICY IF EXISTS suppliers_authenticated_update ON public.suppliers;

CREATE POLICY suppliers_authenticated_insert ON public.suppliers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY suppliers_authenticated_update ON public.suppliers
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
