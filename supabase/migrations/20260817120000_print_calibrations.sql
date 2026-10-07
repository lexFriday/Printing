CREATE OR REPLACE FUNCTION public.validate_print_calibration_fields(_document_type text, _fields jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(_fields) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(_fields) AS entry(key, value)
      WHERE key <> ALL (CASE _document_type
        WHEN 'invoice' THEN ARRAY['invoiceNumber','date','customerName','tin','businessStyle','address','lineDescription','lineQuantity','lineUnitPrice','lineAmount','totalSales','vat','amountNetOfVat','addVat','withholdingTax','amountDue']
        WHEN 'delivery-receipt' THEN ARRAY['terms','date','customerName','tin','address','poNumber','lineQuantity','lineUnit','lineDescription','lineAmount','lineUnitPrice','subtotal','vat','total']
        WHEN 'check-voucher' THEN ARRAY['date','payee','particulars','amount','documentNo','checkNo','preparedBy','certifiedCorrectBy','receivedBy']
        WHEN 'check' THEN ARRAY['checkNo','payee','amount','amountWords','dateMonth','dateDay','dateYear']
        ELSE ARRAY[]::text[] END)
        OR jsonb_typeof(value) <> 'object'
        OR jsonb_typeof(value->'xMm') <> 'number'
        OR jsonb_typeof(value->'yMm') <> 'number'
        OR (value->>'xMm')::numeric NOT BETWEEN -30 AND 30
        OR (value->>'yMm')::numeric NOT BETWEEN -30 AND 30
    );
$$;

CREATE TABLE public.print_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('invoice','delivery-receipt','check-voucher','check')),
  page_offset_x_mm numeric NOT NULL DEFAULT 0 CHECK (page_offset_x_mm BETWEEN -30 AND 30),
  page_offset_y_mm numeric NOT NULL DEFAULT 0 CHECK (page_offset_y_mm BETWEEN -30 AND 30),
  field_offsets jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_type),
  CONSTRAINT print_calibration_fields_valid CHECK (public.validate_print_calibration_fields(document_type, field_offsets))
);
ALTER TABLE public.print_calibrations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.print_calibrations TO authenticated;
GRANT ALL ON public.print_calibrations TO service_role;
CREATE POLICY "print calibration read own" ON public.print_calibrations FOR SELECT TO authenticated USING (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));
CREATE POLICY "print calibration insert own" ON public.print_calibrations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));
CREATE POLICY "print calibration update own" ON public.print_calibrations FOR UPDATE TO authenticated USING (user_id = auth.uid() AND app_private.is_active_user(auth.uid())) WITH CHECK (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));
CREATE POLICY "print calibration delete own" ON public.print_calibrations FOR DELETE TO authenticated USING (user_id = auth.uid() AND app_private.is_active_user(auth.uid()));
CREATE TRIGGER trg_print_calibrations_touch BEFORE UPDATE ON public.print_calibrations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER capture_audit_log AFTER INSERT OR UPDATE OR DELETE ON public.print_calibrations FOR EACH ROW EXECUTE FUNCTION app_private.capture_audit_log();
