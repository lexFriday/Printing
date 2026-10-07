UPDATE public.suppliers
SET
  tin_number = COALESCE(tin_number, '123-456-789-000'),
  address = COALESCE(address, '123 Maginhawa St., Quezon City'),
  payment_terms = COALESCE(payment_terms, '30 days')
WHERE name = 'Metro Print Supply';

UPDATE public.suppliers
SET
  tin_number = COALESCE(tin_number, '987-654-321-000'),
  address = COALESCE(address, '45 Ortigas Avenue, Pasig City'),
  payment_terms = COALESCE(payment_terms, 'COD')
WHERE name = 'ColorHouse Trading';
