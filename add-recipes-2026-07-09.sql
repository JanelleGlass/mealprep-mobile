-- Adds 5 recipes: Iron-Forward Meatballs, Arugula-Basil-Pistachio Pesto Orzo,
-- Overnight Chia Oats, Iced Matchacano (adapted from yasmeen.murrietta),
-- and Sweet Potato Protein Pancakes.
-- Paste the whole file into the Supabase SQL Editor and Run.
-- Safe to re-run: existing ingredients are reused by name, recipes are
-- skipped if a recipe with the same name already exists.

-- Helper: find an ingredient by name, or create it linked to a USDA
-- nutrition row (matched by description). Lives in pg_temp, so it
-- disappears when this editor session ends.
create or replace function pg_temp.mp_ing(p_name text, p_unit text, p_nutr_desc text)
returns int language plpgsql as $fn$
declare v_id int;
begin
  select id into v_id from ingredients where lower(name) = lower(p_name) order by id limit 1;
  if v_id is null then
    insert into ingredients (name, unit, nutrition_id)
    values (p_name, p_unit,
      case when p_nutr_desc is null then null
           else (select id from nutritions where description = p_nutr_desc order by id limit 1) end)
    returning id into v_id;
  end if;
  return v_id;
end $fn$;

do $body$
declare v_r int;
begin

  ----------------------------------------------------------------------
  -- 1. Iron-Forward Meatballs
  ----------------------------------------------------------------------
  if exists (select 1 from recipes where name = 'Iron-Forward Meatballs') then
    raise notice 'Iron-Forward Meatballs already exists — skipped';
  else
    insert into recipes (name, description, servings) values
    ('Iron-Forward Meatballs', 'lentil + mushroom + TVP + pumpkin seed — bakes like the original. Adapted from yasmeen.murrietta, iron & protein forward, preconception-friendly. Makes ~20 balls (4 servings). ~30 min hands-on + 25 min bake.

40 g dry TVP, rehydrated in 80 ml hot broth ~5 min, then squeezed dry
1 cup cooked great northern white beans (or 1 can, drained very well and patted dry)
150 g mushrooms (cremini or shiitake), finely chopped, sautéed dry until no moisture remains
40 g pumpkin seeds, ground
1 egg
40 g parmesan, grated (vegetarian-labeled if avoiding animal rennet)
40 g breadcrumbs
2 tbsp (~15 g) vital wheat gluten (add more only if the mix feels loose)
½ red onion, grated and squeezed dry
to taste garlic, parsley, salt, pepper

1. Rehydrate TVP in hot broth ~5 min; squeeze out excess liquid.
2. Sauté mushrooms dry until all moisture cooks off — this keeps the balls from turning mushy.
3. Mash the beans, then fold everything together with the vital wheat gluten until it just comes together and holds — don''t overwork it or the balls turn springy-tough.
4. Roll into ~20 balls. Bake at 400 °F / 200 °C for 22–25 min.
5. Plate over the pesto orzo; top with parmesan and chopped pistachio. The lemon in the pesto helps non-heme iron absorption.

Note: Mash the beans rather than pulsing to a paste, so you don''t work extra moisture back in. If the mix feels wet, add a little more breadcrumb. Not strict veg — for a closer match to the original''s iron punch, swap in a little actual grass-fed / organ grind for part of the beans. As written, the white bean + TVP + pumpkin-seed base lands ~5–7 mg iron across the batch; the lemon in the pesto matters here since beans bring calcium that competes with iron absorption.', 4)
    returning id into v_r;

    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('TVP granules', 'oz', 'SOY FLOUR,DEFATTED'), 1.41),                                 -- 40 g dry
    (v_r, pg_temp.mp_ing('Vegetable Boullion', 'oz', 'SOUP,BOUILLON CUBES&GRANULES,LO NA,DRY'), 0.06),       -- for 80 ml broth
    (v_r, pg_temp.mp_ing('Great Northern Beans (canned)', 'cup', 'BEANS,GREAT NORTHERN,MATURE SEEDS,CND'), 1),
    (v_r, pg_temp.mp_ing('Mushrooms', 'oz', 'MUSHROOMS,WHITE,RAW'), 5.29),                                   -- 150 g
    (v_r, pg_temp.mp_ing('Pumpkin Seeds', 'g', 'PUMPKIN&SQUASH SD KRNLS,RSTD,WO/SALT'), 40),
    (v_r, pg_temp.mp_ing('Eggs', 'whole', 'EGG,WHL,RAW,FRSH'), 1),
    (v_r, pg_temp.mp_ing('Parmesan', 'g', 'CHEESE,PARMESAN,GRATED'), 40),
    (v_r, pg_temp.mp_ing('Breadcrumbs', 'g', 'BREAD CRUMBS,DRY,GRATED,PLN'), 40),
    (v_r, pg_temp.mp_ing('Vital Wheat Gluten', 'g', 'VITAL WHEAT GLUTEN'), 15),
    (v_r, pg_temp.mp_ing('Onions', 'whole', 'ONIONS,RAW'), 0.5),
    (v_r, pg_temp.mp_ing('Garlic', 'clove', 'GARLIC,RAW'), 2),
    (v_r, pg_temp.mp_ing('Parsley', 'g', 'PARSLEY,FRSH'), 5),
    (v_r, pg_temp.mp_ing('Salt', 'tsp', 'SALT,TABLE'), 1),
    (v_r, pg_temp.mp_ing('Pepper', 'oz', 'PEPPER,BLACK'), 0.02);
    raise notice 'Added Iron-Forward Meatballs (id %)', v_r;
  end if;

  ----------------------------------------------------------------------
  -- 2. Arugula-Basil-Pistachio Pesto Orzo
  ----------------------------------------------------------------------
  if exists (select 1 from recipes where name = 'Arugula-Basil-Pistachio Pesto Orzo') then
    raise notice 'Arugula-Basil-Pistachio Pesto Orzo already exists — skipped';
  else
    insert into recipes (name, description, servings) values
    ('Arugula-Basil-Pistachio Pesto Orzo', 'the blanch-and-shock is what keeps it electric green. ~4 servings, 20 min.

200 g orzo
60 g arugula + 20 g parsley — blanch 30 sec, ice-bath, squeeze dry
20 g basil
50 g shelled pistachios
40 g parmesan, grated
1 small garlic clove
60–80 ml olive oil, juice of ½ lemon, salt

1. Cook orzo to al dente; reserve a little pasta water.
2. Blanch arugula + parsley 30 sec, shock in ice water, squeeze dry (this locks in the color).
3. Blend greens, basil, pistachios, parmesan, garlic, oil, lemon, salt into a pesto.
4. Toss with orzo off the heat, loosening with a splash of pasta water so it''s creamy, not oily.', 4)
    returning id into v_r;

    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('Orzo', 'g', 'PASTA,DRY,ENR'), 200),
    (v_r, pg_temp.mp_ing('Arugula', 'g', 'ARUGULA,RAW'), 60),
    (v_r, pg_temp.mp_ing('Parsley', 'g', 'PARSLEY,FRSH'), 20),
    (v_r, pg_temp.mp_ing('Basil', 'g', 'BASIL,FRESH'), 20),
    (v_r, pg_temp.mp_ing('Pistachios', 'g', 'PISTACHIO NUTS,RAW'), 50),
    (v_r, pg_temp.mp_ing('Parmesan', 'g', 'CHEESE,PARMESAN,GRATED'), 40),
    (v_r, pg_temp.mp_ing('Garlic', 'clove', 'GARLIC,RAW'), 1),
    (v_r, pg_temp.mp_ing('Olive Oil', 'fl oz', 'OIL,OLIVE,SALAD OR COOKING'), 2.37),                          -- ~70 ml
    (v_r, pg_temp.mp_ing('Lemon Juice', 'tbsp', 'LEMON JUICE,RAW'), 1.5),                                    -- juice of ½ lemon
    (v_r, pg_temp.mp_ing('Salt', 'tsp', 'SALT,TABLE'), 0.5);
    raise notice 'Added Arugula-Basil-Pistachio Pesto Orzo (id %)', v_r;
  end if;

  ----------------------------------------------------------------------
  -- 3. Overnight Chia Oats
  ----------------------------------------------------------------------
  if exists (select 1 from recipes where name = 'Overnight Chia Oats') then
    raise notice 'Overnight Chia Oats already exists — skipped';
  else
    insert into recipes (name, description, servings) values
    ('Overnight Chia Oats', 'front-loaded fiber + preconception selenium. Makes 1 generous serving, 5 min + overnight.

40 g rolled oats
20 g chia seeds
120 g whole milk
100 g full-fat Greek yogurt
vanilla + drizzle of honey
Toppings: mango, strawberries, blueberries, bee pollen
1 tbsp sunflower seeds (selenium — swap for Brazil nuts)

1. Stir oats, chia, milk, yogurt, vanilla, honey together.
2. Refrigerate overnight.
3. Top with fruit, bee pollen, and sunflower seeds before eating.

Note: Selenium: oats + a tbsp of sunflower seeds cover a good chunk of your ~55 mcg/day (60 in pregnancy) without Brazil nuts. If you''d rather use Brazil nuts, 1–2 a couple times a week is plenty — daily can overshoot. Eggs, mushrooms, and cottage cheese elsewhere in the day stack it up easily; canned tuna or sardines are the densest if you want a hit (sardines also give omega-3/DHA + iron).', 1)
    returning id into v_r;

    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('Oats (Rolled)', 'oz', 'CEREALS,OATS,REG & QUICK,NOT FORT,DRY'), 1.41),             -- 40 g
    (v_r, pg_temp.mp_ing('Chia Seeds', 'g', 'CHIA SEEDS,DRIED'), 20),
    (v_r, pg_temp.mp_ing('Milk', 'fl oz', 'MILK,RED FAT,FLUID,2% MILKFAT,W/ ADDED VIT A & VITAMIN D'), 3.9), -- 120 g
    (v_r, pg_temp.mp_ing('Greek Yogurt (whole milk)', 'g', 'YOGURT,GREEK,PLN,WHL MILK'), 100),
    (v_r, pg_temp.mp_ing('Vanilla', 'fl oz', 'VANILLA EXTRACT'), 0.05),
    (v_r, pg_temp.mp_ing('Honey', 'fl oz', 'HONEY'), 0.17),                                                  -- drizzle ~1 tsp
    (v_r, pg_temp.mp_ing('Mango', 'g', 'MANGOS,RAW'), 50),
    (v_r, pg_temp.mp_ing('Strawberries', 'g', 'STRAWBERRIES,RAW'), 50),
    (v_r, pg_temp.mp_ing('Blueberries', 'g', 'BLUEBERRIES,RAW'), 30),
    (v_r, pg_temp.mp_ing('Bee Pollen', 'tsp', null), 1),
    (v_r, pg_temp.mp_ing('Sunflower Seeds', 'oz', 'SUNFLOWER SD KRNLS,DRIED'), 0.3);                         -- 1 tbsp
    raise notice 'Added Overnight Chia Oats (id %)', v_r;
  end if;

  ----------------------------------------------------------------------
  -- 4. Iced Matchacano + Vanilla Cold Foam
  ----------------------------------------------------------------------
  if exists (select 1 from recipes where name = 'Iced Matchacano + Vanilla Cold Foam') then
    raise notice 'Iced Matchacano + Vanilla Cold Foam already exists — skipped';
  else
    insert into recipes (name, description, servings) values
    ('Iced Matchacano + Vanilla Cold Foam', 'matcha + espresso, with creatine worked into the foam. Makes 1, 5 min.

1–2 g matcha, whisked with a little water + ice
1 shot espresso (the "-cano")
milk + splash vanilla, frothed, for cold foam
1 scoop creatine (into the foam)

1. Whisk matcha with a splash of water until smooth; pour over ice.
2. Add the espresso shot.
3. Froth milk + vanilla + creatine into a cold foam; pour on top.

Note: Original adds collagen too — not vegetarian, and optional. Skip it or use a scoop of unflavored protein in the foam instead.', 1)
    returning id into v_r;

    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('Matcha', 'g', null), 1.5),
    (v_r, pg_temp.mp_ing('Espresso', 'fl oz', 'BEVERAGES,COFFEE,BREWED,ESPRESSO,REST-PREP'), 1),
    (v_r, pg_temp.mp_ing('Milk', 'fl oz', 'MILK,RED FAT,FLUID,2% MILKFAT,W/ ADDED VIT A & VITAMIN D'), 4),
    (v_r, pg_temp.mp_ing('Vanilla', 'fl oz', 'VANILLA EXTRACT'), 0.05),
    (v_r, pg_temp.mp_ing('Creatine', 'g', null), 5);
    raise notice 'Added Iced Matchacano + Vanilla Cold Foam (id %)', v_r;
  end if;

  ----------------------------------------------------------------------
  -- 5. Sweet Potato Protein Pancakes
  ----------------------------------------------------------------------
  -- Your existing Sweet Potato ingredient has no nutrition link; give it one
  -- so the pancakes' macros count (1 large baked ≈ 180 g flesh).
  update ingredients
  set nutrition_id = (select id from nutritions
                      where description = 'SWEET POTATO,CKD,BKD IN SKN,FLESH,WO/ SALT'
                      order by id limit 1)
  where lower(name) = 'sweet potato' and nutrition_id is null;

  if exists (select 1 from recipes where name = 'Sweet Potato Protein Pancakes') then
    raise notice 'Sweet Potato Protein Pancakes already exists — skipped';
  else
    insert into recipes (name, description, servings) values
    ('Sweet Potato Protein Pancakes', 'High-protein pancakes built on sweet potato, cottage cheese, and white beans. Blended smooth so the beans and cottage cheese vanish into the batter — the texture stays fluffy and pancake-like while delivering ~67g protein and ~10g fiber for the whole batch.

0.5 cooked sweet potato (about half a large one, skin on)
0.5 cups cottage cheese
3 large eggs
0.5 cups great northern beans, drained and rinsed
1 scoop whey protein powder (vanilla or unflavored, ~30 g)
0.3 cups all-purpose flour
0.1 teaspoons baking powder
0.1 teaspoons baking soda
0.3 teaspoons salt
0.5 teaspoons ground cinnamon (optional)
1 tablespoon butter, for the pan

1. Blend the wet base: sweet potato, cottage cheese, eggs, beans, and whey in the NutriBullet or blender. Blend until completely smooth — no bean or curd texture should remain.
2. Add the dry ingredients: flour, baking powder, baking soda, salt, cinnamon. Pulse just until combined — don''t over-blend once the flour is in, or the pancakes turn tough.
3. Rest the batter 5 minutes. The flour hydrates and the leaveners activate, which is the difference between fluffy pancakes and dense ones.
4. Melt the butter in a nonstick pan over medium. Pour scant 1/4-cup rounds. Cook until bubbles form on the surface and the edges look set, about 2-3 minutes.
5. Flip and cook another 1-2 minutes until golden and cooked through. The batter is denser than standard pancake batter, so keep the heat at medium — too hot and the outside browns before the center sets.

Macros, whole batch: ~890 cal · 67g protein · 9.5g fiber · 6.8mg iron. Half batch: ~445 cal · 33.5g protein.

Why blend the beans? They disappear completely into the batter but add ~6g fiber and ~2mg iron — the single best upgrade to a standard protein pancake. Nobody will taste them.

Iron note: the beans bring non-heme iron, which absorbs better alongside vitamin C. Topping with berries, peach, or citrus helps; the calcium in the cottage cheese and whey competes with iron absorption, so this isn''t your strongest iron vehicle — but it''s still a net gain.

Topping math: maple syrup runs ~55 cal/tbsp and is the easiest place for calories to creep. Fruit and a spoon of nut butter add fiber and protein for similar calories.

Make ahead: the batch keeps in the fridge 3 days; reheat in a dry pan or toaster. Cooked pancakes also freeze well with parchment between them.', 2)
    returning id into v_r;

    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('Sweet Potato', 'whole', 'SWEET POTATO,CKD,BKD IN SKN,FLESH,WO/ SALT'), 0.5),
    (v_r, pg_temp.mp_ing('Cottage Cheese', 'can', 'CHEESE,COTTAGE,CRMD,LRG OR SML CURD'), 1),               -- counts as 113 g = 0.5 cup
    (v_r, pg_temp.mp_ing('Eggs', 'whole', 'EGG,WHL,RAW,FRSH'), 3),
    (v_r, pg_temp.mp_ing('Great Northern Beans (canned)', 'cup', 'BEANS,GREAT NORTHERN,MATURE SEEDS,CND'), 0.5),
    (v_r, pg_temp.mp_ing('Whey Protein Powder', 'g', 'BEVERAGES,WHEY PROT PDR ISOLATE'), 30),               -- 1 scoop
    (v_r, pg_temp.mp_ing('Flour', 'oz', null), 1.32),                                                       -- 0.3 cup AP
    (v_r, pg_temp.mp_ing('Baking Powder', 'tsp', 'LEAVENING AGENTS,BAKING PDR,DOUBLE-ACTING,STRAIGHT PO4'), 0.1),
    (v_r, pg_temp.mp_ing('Baking Soda', 'tsp', 'LEAVENING AGENTS,BAKING SODA'), 0.1),
    (v_r, pg_temp.mp_ing('Salt', 'tsp', 'SALT,TABLE'), 0.3),
    (v_r, pg_temp.mp_ing('Cinnamon', 'tsp', 'CINNAMON,GROUND'), 0.5),
    (v_r, pg_temp.mp_ing('butter', 'oz', 'BUTTER,WITH SALT'), 0.5);                                         -- 1 tbsp
    raise notice 'Added Sweet Potato Protein Pancakes (id %)', v_r;
  end if;

end $body$;

-- What got added
select r.name, r.servings, count(ri.id) as ingredients
from recipes r left join recipe_ingredients ri on ri.recipe_id = r.id
where r.name in ('Iron-Forward Meatballs', 'Arugula-Basil-Pistachio Pesto Orzo',
                 'Overnight Chia Oats', 'Iced Matchacano + Vanilla Cold Foam',
                 'Sweet Potato Protein Pancakes')
group by r.id order by r.name;
