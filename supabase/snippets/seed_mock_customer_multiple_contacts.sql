-- Local QA seed: one company with several contacts for quote contact selection.
-- Run in the local Supabase SQL editor. Safe to run more than once.
DO $$
DECLARE
  mock_customer_id uuid;
BEGIN
  SELECT id INTO mock_customer_id
  FROM public.customers
  WHERE customer_name = 'QA Multiple Contacts Co.'
  LIMIT 1;

  IF mock_customer_id IS NULL THEN
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
      'QA Multiple Contacts Co.',
      'Maya Santos',
      '0917-100-0001',
      'maya.santos@qa-contacts.test',
      '999-888-777-000',
      'QA address for contact-selection testing',
      'LOCAL QA DATA - safe to remove after testing'
    )
    RETURNING id INTO mock_customer_id;
  END IF;

  INSERT INTO public.customer_contacts (
    customer_id,
    contact_name,
    department,
    phone,
    email,
    notes
  )
  SELECT mock_customer_id, contact_name, department, phone, email, notes
  FROM (VALUES
    ('Maya Santos', 'Purchasing', '0917-100-0001', 'maya.santos@qa-contacts.test', 'Primary QA contact'),
    ('Carlo Reyes', 'Marketing', '0917-100-0002', 'carlo.reyes@qa-contacts.test', 'Second QA contact'),
    ('Nina Cruz', 'Operations', '0917-100-0003', 'nina.cruz@qa-contacts.test', 'Third QA contact')
  ) AS contacts(contact_name, department, phone, email, notes)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_contacts existing
    WHERE existing.customer_id = mock_customer_id
      AND lower(existing.contact_name) = lower(contacts.contact_name)
  );
END $$;

SELECT c.customer_code, c.customer_name, cc.contact_name, cc.department, cc.phone, cc.email
FROM public.customers c
JOIN public.customer_contacts cc ON cc.customer_id = c.id
WHERE c.customer_name = 'QA Multiple Contacts Co.'
ORDER BY cc.contact_name;
