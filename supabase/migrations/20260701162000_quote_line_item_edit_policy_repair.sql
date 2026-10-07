DROP POLICY IF EXISTS "qli draft sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli draft sales delete" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales insert" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales update" ON public.quote_line_items;
DROP POLICY IF EXISTS "qli editable sales delete" ON public.quote_line_items;

CREATE POLICY "qli editable sales insert" ON public.quote_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );

CREATE POLICY "qli editable sales update" ON public.quote_line_items
  FOR UPDATE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  )
  WITH CHECK (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );

CREATE POLICY "qli editable sales delete" ON public.quote_line_items
  FOR DELETE TO authenticated
  USING (
    app_private.can_sales_work(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = quote_line_items.quotation_id
        AND q.status IN ('draft', 'pending_manager_approval')
    )
  );
