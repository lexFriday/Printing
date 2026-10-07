-- Local QA seed for long customer fields and contact snapshot testing.
-- Run in the local Supabase SQL editor. Safe to run more than once.
DO $$
DECLARE
  mock_customer_id uuid;
BEGIN
  SELECT id INTO mock_customer_id
  FROM public.customers
  WHERE customer_name = 'QA Long Name and Contact Snapshot Corporation'
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
      'QA Long Name and Contact Snapshot Corporation',
      'Alexandra Villanueva',
      '0917-900-0001',
      'alexandra@qa-long-fields.test',
      '999-777-555-111',
      'Unit 1204, Tower 3, Northpoint Business Center, 1234 Long Avenue, Barangay San Isidro, Quezon City, Metro Manila, Philippines',
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
    ('Alexandra Villanueva', 'Purchasing', '0917-900-0001', 'alexandra@qa-long-fields.test', 'Contact A: use first for snapshot test'),
    ('Benjamin dela Cruz-Santos', 'Operations', '0917-900-0002', 'benjamin@qa-long-fields.test', 'Contact B: use second for snapshot test')
  ) AS contacts(contact_name, department, phone, email, notes)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.customer_contacts existing
    WHERE existing.customer_id = mock_customer_id
      AND lower(existing.contact_name) = lower(contacts.contact_name)
  );
END $$;

SELECT
  c.customer_code,
  c.customer_name,
  c.address,
  cc.contact_name,
  cc.department,
  cc.phone,
  cc.email
FROM public.customers c
JOIN public.customer_contacts cc ON cc.customer_id = c.id
WHERE c.customer_name = 'QA Long Name and Contact Snapshot Corporation'
ORDER BY cc.contact_name;
