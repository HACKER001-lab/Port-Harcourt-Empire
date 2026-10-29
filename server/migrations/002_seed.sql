-- Shared world seed: one Port Harcourt city, its districts, venue definitions,
-- the business catalogue and the tunable game rules.

INSERT INTO world_state (id, epoch_started_at, game_hour_seconds)
VALUES (1, now(), 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO game_config (key, value) VALUES
  ('starting_money',        '5000'::jsonb),
  ('max_import_money',      '2000000'::jsonb),
  ('transfer_fee_pct',      '2'::jsonb),
  ('transfer_min_fee',      '50'::jsonb),
  ('transfer_daily_cap',    '5000000'::jsonb),
  ('travel_base_fare',      '120'::jsonb),
  ('travel_fare_per_unit',  '12'::jsonb),
  ('travel_energy_cost',    '3'::jsonb),
  ('energy_regen_seconds',  '30'::jsonb),
  ('health_regen_seconds',  '60'::jsonb),
  ('happiness_regen_seconds', '120'::jsonb),
  ('settle_max_offline_hours', '72'::jsonb),
  ('business_revenue_cap_hours', '24'::jsonb),
  ('duel_cooldown_seconds', '600'::jsonb),
  ('duel_daily_cap',        '10'::jsonb),
  ('duel_energy_cost',      '15'::jsonb),
  ('duel_win_reward',       '1500'::jsonb),
  ('duel_loss_cost',        '500'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO cities (slug, name, region, is_active, ordinal)
VALUES ('port-harcourt', 'Port Harcourt', 'Rivers State', true, 0)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO districts (city_id, slug, name, description, map_x, map_y, safe_zone, ordinal)
SELECT c.id, v.slug, v.name, v.description, v.map_x, v.map_y, v.safe_zone, v.ordinal
FROM cities c
CROSS JOIN (VALUES
  ('mile3-market',  'Mile 3 Market',      'Trading, clothing and cheap food.',            12,  26, false, 0),
  ('rumuola',       'Rumuola',            'Residential estates and neighbourhood gyms.',  130, 26, false, 1),
  ('choba-uni',     'Choba / University', 'Campus, student union and studios.',           248, 26, true,  2),
  ('diobu',         'Diobu / Mile 1',     'Family homes and street corners.',             12,  136, false, 3),
  ('old-gra',       'Old GRA & Centre',   'City hall, business towers and hotels.',       130, 136, true,  4),
  ('trans-amadi',   'Trans-Amadi',        'Industrial park and logistics yard.',          248, 136, false, 5),
  ('borokiri',      'Borokiri Waterfront','Piers, fish market and the chapel.',            12,  250, true,  6),
  ('entertainment', 'Entertainment Strip','Film studio, arena and nightlife.',            130, 250, false, 7),
  ('airport-road',  'Airport Road',       'Airport, casino lounge and hotel lounge.',     248, 250, false, 8)
) AS v(slug, name, description, map_x, map_y, safe_zone, ordinal)
WHERE c.slug = 'port-harcourt'
ON CONFLICT (city_id, slug) DO NOTHING;

INSERT INTO locations (district_id, slug, name, kind)
SELECT d.id, v.slug, v.name, v.kind
FROM districts d
JOIN cities c ON c.id = d.city_id AND c.slug = 'port-harcourt'
JOIN (VALUES
  ('mile3-market',  'main-market',    'Mile 3 Market',        'market'),
  ('mile3-market',  'transport-hub',  'Transport hub',        'transport'),
  ('mile3-market',  'food-row',       'Street food row',      'food'),
  ('rumuola',       'estates',        'Residential estates',  'housing'),
  ('rumuola',       'gym',            'Neighbourhood gym',    'training'),
  ('rumuola',       'pharmacy',       'Pharmacy',             'health'),
  ('choba-uni',     'campus',         'University campus',    'education'),
  ('choba-uni',     'student-union',  'Student union',        'social'),
  ('choba-uni',     'campus-studio',  'Campus studio',        'studio'),
  ('diobu',         'family-home',    'Family home',          'family'),
  ('diobu',         'street-corner',  'Street corner',        'social'),
  ('diobu',         'mechanic',       'Mechanic workshop',    'workshop'),
  ('old-gra',       'city-hall',      'City hall',            'civic'),
  ('old-gra',       'business-tower', 'Business tower',       'work'),
  ('old-gra',       'grand-hotel',    'Grand hotel',          'hotel'),
  ('trans-amadi',   'industrial-park','Industrial park',      'work'),
  ('trans-amadi',   'logistics-yard', 'Logistics yard',       'transport'),
  ('trans-amadi',   'canteen',        'Works canteen',        'food'),
  ('borokiri',      'pier',           'Waterfront pier',      'transport'),
  ('borokiri',      'fish-market',    'Fish market',          'market'),
  ('borokiri',      'chapel',         'Waterfront chapel',    'worship'),
  ('entertainment', 'film-studio',    'Film studio',          'studio'),
  ('entertainment', 'arena',          'Arena & gym',          'arena'),
  ('entertainment', 'nightclub',      'Nightclub',            'nightlife'),
  ('airport-road',  'airport',        'Airport',              'transport'),
  ('airport-road',  'casino',         'Casino lounge',        'gambling'),
  ('airport-road',  'hotel-lounge',   'Hotel lounge',         'social')
) AS v(district_slug, slug, name, kind) ON d.slug = v.district_slug
ON CONFLICT (district_id, slug) DO NOTHING;

INSERT INTO business_types (code, name, description, icon, cost, base_revenue, upgrade_cost, upkeep_per_day, max_level) VALUES
  ('food_stand', 'Food stand',  'A corner kitchen selling jollof and pepper soup.', '🍲', 25000,  1200, 20000,  60, 5),
  ('laundry',    'Laundry',     'Wash-and-fold for the estates nearby.',            '🧺', 40000,  1800, 32000,  90, 5),
  ('barbershop', 'Barbershop',  'Cuts, fades and a queue on Saturdays.',           '💈', 60000,  2600, 48000, 120, 5),
  ('cyber_cafe', 'Cyber café',  'Printing, browsing and exam registrations.',      '💻', 90000,  3800, 70000, 160, 5),
  ('boutique',   'Boutique',    'Ready-to-wear and tailoring on the strip.',       '👗',150000,  6000,120000, 240, 5)
ON CONFLICT (code) DO NOTHING;
