-- Adds 1 recipe: Tall, Crisp-Edged Whole-Grain Pancakes.
-- Paste the whole file into the Supabase SQL Editor and Run.
-- Safe to re-run: existing ingredients are reused by name, the recipe is
-- skipped if one with the same name already exists.

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
  -- Tall, Crisp-Edged Whole-Grain Pancakes
  ----------------------------------------------------------------------
  if exists (select 1 from recipes where name = 'Tall, Crisp-Edged Whole-Grain Pancakes') then
    raise notice 'Tall, Crisp-Edged Whole-Grain Pancakes already exists — skipped';
  else
    insert into recipes (name, description, servings) values
    ('Tall, Crisp-Edged Whole-Grain Pancakes', 'Soufflé-light interior, lacy fried edges. Built around soured milk and blended cottage cheese, with a stabilized meringue folded in at the last moment. ~4 servings.

INGREDIENTS
300 ml whole milk
1.5 tbsp lemon juice
120 g cottage cheese
120 g all-purpose flour
60 g whole wheat pastry flour
40 g oat flour (or rolled oats blitzed fine)
2 tbsp ground flaxseed
2 tbsp cornstarch
2 tsp baking powder
0.8 tsp baking soda
0.8 tsp fine salt
2 tbsp sugar
0.3 tsp cream of tartar (or 1/2 tsp more lemon juice)
3 large eggs, separated
3 tbsp unsalted butter, melted
1 tsp vanilla extract
4 tbsp unsalted butter, for the pan

STEPS
1. Sour the milk, separate the eggs: Stir 1.5 tbsp lemon juice into 300 ml whole milk and leave it until slightly curdled and thickened. This acid activates the baking soda later, so don''t rush it. While it sits, separate the 3 eggs — the whites need to come to room temperature, which makes them whip far more stably.
2. Blend the cottage cheese: Blend 120 g cottage cheese with about 250 ml of the soured milk until completely smooth, with no visible curds. Reserve the remaining 50 ml for adjusting the batter later.
3. Whisk the dry mix: Whisk the all-purpose flour, whole wheat pastry flour, oat flour, ground flaxseed, cornstarch, baking powder, baking soda, and salt in a large bowl. Keep the 2 tbsp sugar aside — it goes into the egg whites, not the dry mix.
4. Finish the wet mix: Whisk the egg yolks into the blended cottage cheese mixture along with the 3 tbsp melted butter and the vanilla.
5. Combine, barely: Pour wet into dry and fold about ten strokes. Stop while it''s lumpy — dry streaks are fine. Overmixing is the biggest killer of height. Don''t add the reserved milk yet.
6. Rest, then check thickness: Cover and rest 15 minutes so the whole wheat and oat flour soften. Then check: a spoonful should mound rather than run. Only if it''s too stiff to fold, work in the reserved milk a splash at a time.
7. Heat the pan first: Set a cast iron skillet or heavy nonstick over medium heat before you touch the whites. Medium, not medium-high. Everything else should be ready to go — the whites are whipped last on purpose.
8. Whip the whites with acid and sugar: Beat the room-temperature whites until foamy and opaque but still loose, then beat in the cream of tartar. Once it holds a soft shape, rain the 2 tbsp sugar in slowly with the mixer running. Stop at soft peaks — the tip should bend over, not stand straight.
9. Fold immediately: Fold into the batter in two additions, stopping while a few white streaks remain. Do this within a minute of stopping the mixer — standing time is what caused liquid to drain out of the foam. Go straight to the pan.
10. Cook the first side: Melt about 1 tbsp of the pan butter per pancake and swirl into a shallow pool. Drop 1/3 cup of batter in and don''t spread it. The edges will fry and go lacy. Cook until the rim looks matte and bubbles hold their shape.
11. Flip and finish: Flip once and cook until deep golden. Never press down. Transfer to a wire rack rather than a plate — stacking traps steam and softens the edges. Fresh butter in the pan for each batch.

NOTES
Whipped whites start draining within minutes of the mixer stopping — the bubble walls thin and gravity pulls the water out, which is why they''re whipped dead last, after the pan is already hot. Three things buy you stability: the acid, sugar added gradually once a foam has formed, and room-temperature whites.

Take the whites only to soft peaks. Fully stiff whites go clumpy and tear the batter when folded. Some deflation during folding is normal and not a mistake — you''re trading a little volume for even distribution.

The cottage cheese must be fully blended; surviving curds turn into rubbery pockets. If your blender leaves texture, push it through a sieve.

Cottage cheese runs saltier than Greek yogurt. If yours is a salty brand, cut the added salt to 1/2 tsp.', 4)
    returning id into v_r;

    insert into recipe_ingredients (recipe_id, ingredient_id, quantity) values
    (v_r, pg_temp.mp_ing('Whole Milk', 'g', 'MILK,WHL,3.25% MILKFAT,W/ ADDED VITAMIN D'), 300),
    (v_r, pg_temp.mp_ing('Lemon Juice', 'tbsp', 'LEMON JUICE,RAW'), 1.5),
    (v_r, pg_temp.mp_ing('Cottage Cheese', 'can', 'CHEESE,COTTAGE,CRMD,LRG OR SML CURD'), 1),   -- ~120 g = 0.5 cup
    (v_r, pg_temp.mp_ing('All-Purpose Flour', 'g', 'WHEAT FLR,WHITE,ALL-PURPOSE,ENR,BLEACHED'), 120),
    (v_r, pg_temp.mp_ing('Whole Wheat Pastry Flour', 'g', 'WHEAT FLR,WHOLE-GRAIN,SOFT WHEAT'), 60),
    (v_r, pg_temp.mp_ing('Oat Flour', 'g', 'OAT FLR,PART DEBRANNED'), 40),
    (v_r, pg_temp.mp_ing('Ground Flaxseed', 'g', 'SEEDS,FLAXSEED'), 14),                        -- 2 tbsp
    (v_r, pg_temp.mp_ing('Cornstarch', 'g', 'CORNSTARCH'), 16),                                 -- 2 tbsp
    (v_r, pg_temp.mp_ing('Baking Powder', 'tsp', 'LEAVENING AGENTS,BAKING PDR,DOUBLE-ACTING,STRAIGHT PO4'), 2),
    (v_r, pg_temp.mp_ing('Baking Soda', 'tsp', 'LEAVENING AGENTS,BAKING SODA'), 0.8),
    (v_r, pg_temp.mp_ing('Salt', 'tsp', 'SALT,TABLE'), 0.8),
    (v_r, pg_temp.mp_ing('Sugar', 'g', 'SUGARS,GRANULATED'), 25),                               -- 2 tbsp
    (v_r, pg_temp.mp_ing('Cream of Tartar', 'tsp', 'LEAVENING AGENTS,CRM OF TARTAR'), 0.3),
    (v_r, pg_temp.mp_ing('Eggs', 'whole', 'EGG,WHL,RAW,FRSH'), 3),
    (v_r, pg_temp.mp_ing('butter', 'oz', 'BUTTER,WITHOUT SALT'), 2),                            -- 3 tbsp melted + a little from the pan
    (v_r, pg_temp.mp_ing('Vanilla', 'fl oz', 'VANILLA EXTRACT'), 0.17);                         -- 1 tsp
    raise notice 'Added Tall, Crisp-Edged Whole-Grain Pancakes (id %)', v_r;
  end if;

end $body$;

-- What got added
select r.name, r.servings, count(ri.id) as ingredients
from recipes r left join recipe_ingredients ri on ri.recipe_id = r.id
where r.name = 'Tall, Crisp-Edged Whole-Grain Pancakes'
group by r.id order by r.name;
