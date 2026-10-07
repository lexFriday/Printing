DROP POLICY IF EXISTS suppliers_write ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update ON public.suppliers;

CREATE POLICY suppliers_write ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'accounting')
  );

CREATE POLICY suppliers_update ON public.suppliers
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'accounting')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'accounting')
  );

-- Supplier creation is also available from the General Expense form. The UI
-- limits who can manage the directory; authenticated expense users need the
-- same insert/update capability for that workflow.
CREATE POLICY suppliers_authenticated_insert ON public.suppliers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY suppliers_authenticated_update ON public.suppliers
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
