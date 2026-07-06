# Moving MealPrep's data to Supabase

One-time setup, about 20 minutes. You'll create a free database, load your data
into it, and create your login. Claude generates the SQL files; you run them.

## 1. Create the Supabase project (~5 min)

1. Go to **supabase.com** → Start your project → sign in with GitHub (free, no card).
2. **New project** → name it `mealprep` → set a strong **database password**
   (save it in your password manager; you rarely need it again) → pick the
   region closest to you → Create.
3. Wait ~2 minutes for provisioning.

## 2. Load your data (~10 min)

Ask Claude to regenerate fresh migration files first if any time has passed
(`python tools/generate_migration.py`) — they snapshot your database at
generation time. The files land in `migration-out/`.

In the Supabase dashboard, open **SQL Editor** and run each file **in order**:

1. `001_schema.sql` — creates the tables (run once; errors if run twice)
2. `002_nutritions_01.sql` … `002_nutritions_09.sql` — the USDA food data, one at a time
3. `003_core.sql` — ingredients, recipes, meals, pantry, quick-add items
4. `004_log.sql` — your food log and body history
5. `005_finish.sql` — finishes up and prints a **row-count table**

For each: open the file on your PC, copy all, paste into the editor, **Run**.
Compare the counts printed by `005_finish.sql` against the list the generator
printed — they must match exactly.

## 3. Create your login and lock the door (~3 min)

1. Dashboard → **Authentication → Users → Add user** → your email + a password
   (this is what you'll sign in with on your phone — different from the database
   password in step 1). Check "Auto confirm user".
2. **Authentication → Sign In / Providers** → turn **OFF** "Allow new users to
   sign up" → Save. Now yours is the only account that can ever exist.

## 4. Connect the app (~2 min)

1. Dashboard → **Project Settings → Data API**: copy the **Project URL** and the
   **anon public** key.
2. Open the MealPrep app → gear ⚙︎ → paste both → sign in with the email +
   password from step 3. Once per device (phone, PC browser) — it stays signed in.

## Troubleshooting

- **"project paused"** after a long break: supabase.com → your project → Restore
  (~30 seconds). Data is never lost.
- A SQL file fails partway: each file is one statement batch; fix = ask Claude,
  don't re-run 001.
