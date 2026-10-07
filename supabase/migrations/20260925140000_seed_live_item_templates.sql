-- Seed the live item-template catalog for local development.
-- Deliberately uses only the canonical item_templates columns; sheet pricing is not used.
INSERT INTO public.item_templates
  (name, description, pricing_mode, default_unit, default_rate_per_sqft,
   default_unit_price, default_width, default_height)
VALUES
  ('A4 Detailer', 'A4 Detailer', 'fixed', NULL, NULL, 250, 8.27, 11.69),
  ('A4 Menu Board', 'A4 Menu Board', 'fixed', NULL, NULL, 250, 8.27, 11.69),
  ('Backdrop', 'Backdrop', 'sqft', 'feet', 180, NULL, NULL, NULL),
  ('BACKLIT STICKER', 'BACKLIT STICKER', 'sqft', 'feet', 250, NULL, NULL, NULL),
  ('C2S 100 BACK TO BACK 12 x 18 inches', 'DIGITAL PRINT C2S 100 BACK TO BACK 12 x 18 inches', 'fixed', NULL, NULL, 160, 1, 1.5),
  ('C2S 100 ONE SIDE PRINT 12 x 18 inches', 'DIGITAL PRINT C2S 100 ONE SIDE', 'fixed', NULL, NULL, 80, 1, 1.5),
  ('C2S 160', 'C2S 160 - ROLLED TYPE', 'sqft', 'feet', 140, NULL, NULL, NULL),
  ('C2S 220 BACK TO BACK 12 x 18 inches', 'DIGITAL PRINT ON C2S 220 12 x 18 inches', 'fixed', NULL, NULL, 220, 1, 1.5),
  ('C2S 220 ONE SIDE PRINT 12 X 18 inches', 'DIGITAL PRINT ON C2S 220 ONE SIDE 12 x 18 inches', 'fixed', NULL, NULL, 140, 1, 1.5),
  ('FOLDCOTE 18', 'STICKER on FOLDCOTE 18', 'sqft', 'feet', 140, NULL, NULL, NULL),
  ('GRAYBACK STICKER', 'PRINT ON GRAYSTICKER', 'sqft', 'feet', 190, NULL, NULL, NULL),
  ('MECHANICAL FULL UP BANNER', 'MECHANICAL FULL UP BANNER PRINT 13oz TARP', 'fixed', NULL, NULL, 2700, 33, 79),
  ('ORAJET STICKER', 'ORAJET STICKER', 'sqft', 'feet', 190, NULL, NULL, NULL),
  ('SATIN STICKER D 12 x 18 inches', 'DIGITAL PRINT SATIN STICKER 12 x 18 INCHES PER SHEET', 'fixed', NULL, NULL, 200, 1, 1.5),
  ('Sintra Board', 'Sintra Board', 'sqft', 'feet', 250, NULL, NULL, NULL),
  ('Sticker', 'Sticker', 'sqft', 'feet', 130, NULL, NULL, NULL),
  ('STICKER ON 3 MM SINTRA', 'STICKER ON 3 MM SINTRA', 'sqft', 'feet', 190, NULL, NULL, NULL),
  ('STICKER ON 5 MM SINTRA', 'STICKER ON 5 MM SINTRA', 'sqft', 'feet', 220, NULL, NULL, NULL),
  ('STICKER ON STICKER 1.5 MM', 'STICKER ON 1.5 MM SINTRA', 'sqft', 'feet', 160, NULL, NULL, NULL),
  ('TARP 13 OZ', 'PRINT on TARP 13 OZ', 'sqft', 'feet', 25, NULL, NULL, NULL),
  ('Tarpaulin Banner', 'Tarpaulin Banner', 'sqft', 'feet', 180, NULL, NULL, NULL),
  ('UV DFT', 'UV DFT PRINT', 'sqft', 'inches', 170, NULL, NULL, NULL),
  ('UV PRINT FOLDCOTE 18', 'UV PRINT ON FOLDCOTE 18', 'sqft', 'feet', 250, NULL, NULL, NULL),
  ('UV PRINT STICKER', 'UV PRINT ON STICKER', 'sqft', 'feet', 250, NULL, NULL, NULL)
ON CONFLICT (lower(name)) DO NOTHING;
