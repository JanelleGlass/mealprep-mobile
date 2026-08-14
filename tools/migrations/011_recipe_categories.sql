-- Recipe sections: adds a category column so the Recipes tab can group into
-- collapsible sections (Breakfast, Soup, Dessert, …) instead of one flat list.
-- Run in the Supabase SQL Editor after 010. Safe to re-run: the seed below only
-- fills recipes that are still unfiled, so it never overwrites a section you
-- have since changed in the app.
--
-- The app tolerates this column not existing yet — an unfiled recipe simply
-- shows under "Other" — but until it is added, choosing a section in the recipe
-- editor has nothing to save into.

alter table recipes add column if not exists category text not null default '';

-- The sections the app offers. Anything else (or blank) renders under "Other",
-- so a hand-typed value here is not a hazard, just an invisible one.
--   Breakfast · Soup · Salad · Main · Side · Bread · Dessert
--   Sauce & Dressing · Drink · Snack · Other

with map(name, category) as (values
  ('Egg Bites', 'Breakfast'),
  ('Vegan Breakfast Burritos', 'Breakfast'),
  ('Breakfast Sandwiches', 'Breakfast'),
  ('Oat Waffles - Lynette''s Recipe', 'Breakfast'),
  ('Shakshuka', 'Breakfast'),
  ('Easy Vegan Breakfast Sausage Patties (TVP)', 'Breakfast'),
  ('Overnight Chia Oats', 'Breakfast'),
  ('Sweet Potato Protein Pancakes', 'Breakfast'),
  ('Tall, Crisp-Edged Whole-Grain Pancakes', 'Breakfast'),
  ('Soup', 'Soup'),
  ('Crock Pot Tomato Basil Bisque', 'Soup'),
  ('Biba''s Eggplant Parmesan', 'Main'),
  ('Rice & Chai Pow Yu', 'Main'),
  ('Iron-Forward Meatballs', 'Main'),
  ('Arugula-Basil-Pistachio Pesto Orzo', 'Main'),
  ('Roasted Broccoli & Quinoa/Rice', 'Side'),
  ('bread', 'Bread'),
  ('English Muffins', 'Bread'),
  ('Pineapple Cookies', 'Dessert'),
  ('Lemon Pie Delux', 'Dessert'),
  ('Blueberry Lemon Pie', 'Dessert'),
  ('Iced Matchacano + Vanilla Cold Foam', 'Drink')
)
update recipes r
set category = m.category
from map m
where lower(m.name) = lower(r.name)
  and r.category = '';

-- A variation inherits its base's section: the list groups a variation under
-- whatever its base is filed as, so leaving one blank would only show up if the
-- base were later deleted and the variation promoted.
update recipes v
set category = b.category
from recipes b
where v.parent_recipe_id = b.id
  and v.category = ''
  and b.category <> '';

select coalesce(nullif(category, ''), '(unfiled -> Other)') as section, count(*)
from recipes group by 1 order by 2 desc;
