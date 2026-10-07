-- Keep company and all initial contacts in one transaction.
CREATE OR REPLACE FUNCTION public.create_customer_with_contacts(
  customer_data jsonb,
  contacts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, pg_temp
AS $$
DECLARE
  actor_id uuid := auth.uid();
  customer_row public.customers%ROWTYPE;
  contact_row public.customer_contacts%ROWTYPE;
  contact_data jsonb;
  contact_ids jsonb := '[]'::jsonb;
  customer_name_value text := trim(coalesce(customer_data ->> 'customer_name', ''));
  contact_name_value text := trim(coalesce(customer_data ->> 'contact_person', ''));
  contact_number_value text := trim(coalesce(customer_data ->> 'contact_number', ''));
BEGIN
  IF actor_id IS NULL OR NOT app_private.can_sales_work(actor_id) THEN
    RAISE EXCEPTION 'You do not have permission to create customers';
  END IF;

  IF customer_name_value = '' OR contact_name_value = '' OR contact_number_value = '' THEN
    RAISE EXCEPTION 'Company name, contact name, and contact number are required';
  END IF;

  IF jsonb_typeof(contacts) <> 'array' THEN
    RAISE EXCEPTION 'Additional contacts must be an array';
  END IF;

  INSERT INTO public.customers (
    customer_name,
    contact_person,
    contact_number,
    email,
    tin_number,
    address,
    notes
  )
  VALUES (
    customer_name_value,
    contact_name_value,
    contact_number_value,
    NULLIF(trim(customer_data ->> 'email'), ''),
    NULLIF(trim(customer_data ->> 'tin_number'), ''),
    NULLIF(trim(customer_data ->> 'address'), ''),
    NULLIF(trim(customer_data ->> 'notes'), '')
  )
  RETURNING * INTO customer_row;

  INSERT INTO public.customer_contacts (
    customer_id,
    contact_name,
    phone,
    email,
    created_by
  )
  VALUES (
    customer_row.id,
    contact_name_value,
    contact_number_value,
    NULLIF(trim(customer_data ->> 'email'), ''),
    actor_id
  )
  RETURNING * INTO contact_row;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_values)
  VALUES (
    actor_id,
    'create',
    'customer_contact',
    contact_row.id,
    to_jsonb(contact_row)
  );

  contact_ids := contact_ids || to_jsonb(contact_row.id);

  FOR contact_data IN SELECT value FROM jsonb_array_elements(contacts)
  LOOP
    IF trim(coalesce(contact_data ->> 'contact_name', '')) = ''
       OR (
         trim(coalesce(contact_data ->> 'phone', '')) = ''
         AND trim(coalesce(contact_data ->> 'email', '')) = ''
       ) THEN
      RAISE EXCEPTION 'Each additional contact needs a name and a phone number or email';
    END IF;

    INSERT INTO public.customer_contacts (
      customer_id,
      contact_name,
      phone,
      email,
      created_by
    )
    VALUES (
      customer_row.id,
      trim(contact_data ->> 'contact_name'),
      NULLIF(trim(contact_data ->> 'phone'), ''),
      NULLIF(trim(contact_data ->> 'email'), ''),
      actor_id
    )
    RETURNING * INTO contact_row;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_values)
    VALUES (
      actor_id,
      'create',
      'customer_contact',
      contact_row.id,
      to_jsonb(contact_row)
    );

    contact_ids := contact_ids || to_jsonb(contact_row.id);
  END LOOP;

  RETURN jsonb_build_object(
    'customer', to_jsonb(customer_row),
    'contact_ids', contact_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_with_contacts(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_with_contacts(jsonb, jsonb) TO authenticated;
