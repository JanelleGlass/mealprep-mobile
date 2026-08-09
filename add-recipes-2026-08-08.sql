-- Adds 1 recipe as a variation of Lemon Pie Delux: Blueberry Lemon Pie.
-- Paste the whole file into the Supabase SQL Editor and Run.
-- Safe to re-run: existing ingredients are reused by name, the recipe is
-- skipped if one with the same name already exists.
--
-- Needs 008_recipe_variations.sql (parent_recipe_id) — already applied.
-- Aborts if no recipe named 'Lemon Pie Delux' is found, rather than quietly
-- adding a loose top-level recipe.

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
declare v_r int; v_parent int;
begin

  select id into v_parent from recipes where lower(name) = lower('Lemon Pie Delux') order by id limit 1;
  if v_parent is null then
    raise exception 'No recipe named "Lemon Pie Delux" found — check the exact spelling in your Recipes tab and edit this file';
  end if;

  ----------------------------------------------------------------------
  -- Blueberry Lemon Pie  (variation of Lemon Pie Delux)
  ----------------------------------------------------------------------
  if exists (select 1 from recipes where name = 'Blueberry Lemon Pie') then
    raise notice 'Blueberry Lemon Pie already exists — skipped';
  else
    insert into recipes (name, description, servings, parent_recipe_id) values
    ('Blueberry Lemon Pie', 'Graham crust, a thick blueberry layer, tart pineapple-lemon filling, and a tangy cream cheese topping marbled through the top.

INGREDIENTS
1.5 cups graham cracker crumbs (about 11 full sheets)
3 tablespoons sugar, for the crust
0.3 teaspoons salt, for the crust
5 tablespoons butter, melted
2 cups blueberries, fresh or frozen
0.3 cups sugar, for the blueberries
1 tablespoons cornstarch, for the blueberries
1 tablespoons lemon juice, for the blueberries
1.3 cups unsweetened pineapple juice, divided
0.3 cups cornstarch, for the filling
0.3 cups sugar, for the filling
2 tablespoons lemon zest, finely grated
0.3 cups lemon juice, fresh
0.3 teaspoons salt, for the filling
1 tablespoons butter, for the filling
4 ounces cream cheese, at room temperature
3 tablespoons powdered sugar
0.3 cups sour cream
1 cups heavy cream, cold

STEPS
1. Press the crust: Heat oven to 350°F. Stir 1.5 cups graham cracker crumbs (about 11 full sheets), 3 tablespoons sugar, for the crust, and 0.3 teaspoons salt, for the crust together, then mix in 5 tablespoons butter, melted until every crumb is damp. Press firmly up the sides of a deep-dish 9-inch pie plate first, then across the bottom — doing the sides first is what keeps them from slumping. Use a flat-bottomed glass to pack it tight.
2. Bake and cool the crust: Bake until fragrant and slightly darkened at the edges, then cool completely before anything goes in it. A warm crust turns soggy under the blueberry layer.
3. Cook the blueberry layer: Put 1 1/2 cups of 2 cups blueberries, fresh or frozen in a saucepan with 0.3 cups sugar, for the blueberries over medium heat, crushing lightly with a spoon, until the berries burst and release their juice. Whisk 1 tablespoons cornstarch, for the blueberries into 1 tablespoons lemon juice, for the blueberries and stir it in. Cook until thick and glossy, then take it off the heat and fold in the remaining 1/2 cup of berries whole.
4. Cool and spread: Cool the blueberry mixture to room temperature, then spread it evenly over the cooled crust and refrigerate while you make the filling.
5. Perfume the sugar, mix the slurry: Set aside 1 teaspoon of the 2 tablespoons lemon zest, finely grated for the pot. Rub the rest into 0.3 cups sugar, for the filling with your fingertips until the sugar is damp and smells strongly of lemon. Separately, whisk 0.3 cups cornstarch, for the filling into 1/4 cup of the cold 1.3 cups unsweetened pineapple juice, divided until completely smooth. Keep the remaining 1 cup of juice apart.
6. Cook and finish the lemon filling: Bring the remaining 1 cup pineapple juice to a boil with the reserved teaspoon of zest. Whisk in the slurry and cook, whisking constantly, until thick and glossy. Pull the pan off the burner and stir in the lemon sugar, 0.3 cups lemon juice, fresh, 0.3 teaspoons salt, for the filling, and 1 tablespoons butter, for the filling until smooth — the residual heat dissolves the sugar without cooking the acid or the fresh zest.
7. Chill the filling: Press plastic wrap directly onto the surface and refrigerate until cold to the touch, not merely cool. Warm filling will slacken the topping and melt into the blueberries. Set the cream cheese on the counter now to soften.
8. Make the topping: Beat 4 ounces cream cheese, at room temperature with 3 tablespoons powdered sugar until there is not a single lump — this step makes or breaks the texture. Beat in 0.3 cups sour cream until smooth. Whip 1 cups heavy cream, cold separately to medium peaks, then fold it into the cream cheese base in three additions. Stop at medium peaks, not stiff. You''ll have about 2 cups.
9. Assemble: Spread half the chilled lemon filling over the blueberry layer in an even sheet. Fold 1 cup of the topping into the other half with just a few strokes — stop while streaks are still visible — and spoon it lightly over the top. Reserve the rest of the topping for serving.
10. Set: Refrigerate until firm enough to slice cleanly. A thin knife wiped between cuts gives the sharpest layer lines.

NOTES
Use a deep-dish or 9.5-inch pie plate. With the blueberry layer added, this makes roughly 4.5 cups of filling — a standard 9-inch plate holds about 4 and will overflow.

Blueberry layer: cook it until a spoon dragged across the pan leaves a track that holds for a second. Anything looser will bleed purple into the lemon layer overnight. It should mound, not pour.

Taste the lemon filling at the end of step 6, before it chills — that''s your one chance to adjust the sugar-to-lemon balance, and pineapple juice varies between brands.

Cut the sour cream to 2 tablespoons if you''d rather the tang stay in the background. Cream cheese is already faintly tangy, so the two stack.

If a filling comes out looser than you like, add a tablespoon more cornstarch next time rather than cooking it longer — extra simmering with acid in the pot thins starch instead of thickening it.', 8, v_parent)
    returning id into v_r;

    -- Quantities are in each ingredient's own stored unit, so anything the
    -- recipe uses in more than one place is summed here. The written list
    -- above keeps the per-component breakdown.
    -- NOTE: mp_ing matches on name and ignores the unit passed when the
    -- ingredient already exists, so the unit below is only used for ones it
    -- has to create. The second report at the bottom prints what each row
    -- actually landed on — check it before trusting the totals.
    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('Graham Cracker Crumbs', 'cup', 'COOKIES,GRAHAM CRACKERS,PLN OR HONEY (INCLUDING CINNAMON)'), 1.5),
    (v_r, pg_temp.mp_ing('Sugar', 'g', 'SUGARS,GRANULATED'), 157.5),        -- 3 tbsp crust + 0.3 cup berries + 0.3 cup filling
    (v_r, pg_temp.mp_ing('Salt', 'tsp', 'SALT,TABLE'), 0.6),                -- 0.3 crust + 0.3 filling
    (v_r, pg_temp.mp_ing('Butter', 'tbsp', 'BUTTER,WITH SALT'), 6),         -- 5 crust + 1 filling
    (v_r, pg_temp.mp_ing('Blueberries', 'cup', 'BLUEBERRIES,RAW'), 2),
    (v_r, pg_temp.mp_ing('Cornstarch', 'g', 'CORNSTARCH'), 46.4),           -- 1 tbsp berries (8 g) + 0.3 cup filling (38.4 g)
    (v_r, pg_temp.mp_ing('Lemon Juice', 'cup', 'LEMON JUICE,RAW'), 0.36),   -- 1 tbsp berries + 0.3 cup filling
    (v_r, pg_temp.mp_ing('Pineapple Juice', 'cup', 'PINEAPPLE JUC,CND,NOT FROM CONC,UNSWTND,W/ ADDED ASCORBIC ACID'), 1.3),
    (v_r, pg_temp.mp_ing('Lemon Zest', 'tbsp', 'LEMON PEEL,RAW'), 2),
    (v_r, pg_temp.mp_ing('Cream Cheese', 'oz', 'CHEESE,CREAM'), 4),
    (v_r, pg_temp.mp_ing('Powdered Sugar', 'tbsp', 'SUGARS,POWDERED'), 3),
    (v_r, pg_temp.mp_ing('Sour Cream', 'cup', 'CREAM,SOUR,CULTURED'), 0.3),
    (v_r, pg_temp.mp_ing('Heavy Cream', 'cup', 'CREAM,FLUID,HVY WHIPPING'), 1);

    raise notice 'Added Blueberry Lemon Pie (id %) as a variation of Lemon Pie Delux (id %)', v_r, v_parent;
  end if;

end $body$;

-- What got added, and where it sits
select r.name, p.name as variation_of, r.servings, count(ri.id) as ingredients
from recipes r
left join recipes p on p.id = r.parent_recipe_id
left join recipe_ingredients ri on ri.recipe_id = r.id
where r.name = 'Blueberry Lemon Pie'
group by r.id, p.name;

-- Every row with the unit it actually landed on. An ingredient that already
-- existed keeps its own unit, which may not be the one assumed above — e.g. a
-- 'Heavy Cream' already stored in fl oz would make a quantity of 1 mean 1 fl oz,
-- not 1 cup. Scan this list; anything whose unit looks wrong needs its quantity
-- adjusted in the Recipes tab.
select i.name, ri.quantity, i.unit
from recipe_ingredients ri
join ingredients i on i.id = ri.ingredient_id
join recipes r on r.id = ri.recipe_id
where r.name = 'Blueberry Lemon Pie'
order by i.name;

-- Any ingredient this file touched that ended up without a nutrition link.
-- These are the ones the Ingredients list will count as "not linked" — a USDA
-- description below that does not exist verbatim in your nutritions table
-- lands here. Link them in the app; the recipe totals are wrong until you do.
select i.name, i.unit
from ingredients i
join recipe_ingredients ri on ri.ingredient_id = i.id
join recipes r on r.id = ri.recipe_id
where r.name = 'Blueberry Lemon Pie' and i.nutrition_id is null
order by i.name;
