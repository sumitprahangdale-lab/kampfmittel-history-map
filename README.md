# Kampfmittel History Map

A website that turns WWII chronologies, diaries and reports into events on a map, and writes a
*historisch-genetische Rekonstruktion* for any area: sequence of events, ordnance likely used, possible finds.

- **Owner (you):** sign in, upload documents. Files are kept in private Supabase storage, map points in the Supabase database. You also get the AI assistant.
- **Visitors:** can use the map and add **their own** documents. Those are read in their browser and stay in their browser. They can't change your data.
- **Built-in data:** THOR air raids (11,534 attacks), Carter chronology points, 2,109 ground actions by unit (U.S. Army Chronology), 58,000 German towns and villages, 12th Army Group situation maps.

## How it works

| Part | Where | What |
|---|---|---|
| Website | Vercel (free) | `index.html`, `backend.js`, data files |
| Database + file storage + login | Supabase (free) | table `docs`, bucket `files` |
| AI assistant | Vercel function `api/ai.js` | calls Claude with your API key, **owner only** |
| Address search | OpenStreetMap Nominatim | free, no key |

Security: the rules in `supabase/schema.sql` let everyone *read* the map points, but only the user listed in `app_owner` can write, upload or open files. The AI function checks your login too, so nobody else can spend your API credit.

---

## Setup (about 20 minutes)

### 1. Supabase: database and login
1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub.
2. **New project** → Name `kampfmittel-map` → choose a database password (save it) → Region **Central EU (Frankfurt)** → **Create new project**. Wait about 2 minutes.
3. Left menu **SQL Editor** → **New query** → open `supabase/schema.sql` from this folder, copy everything, paste → **Run**. It should say "Success".
4. Left menu **Authentication** → **Users** → **Add user** → **Create new user** → your e-mail + a strong password → tick **Auto Confirm User** → **Create user**.
5. Back in **SQL Editor** → New query → paste this, with your e-mail → **Run**:
   ```sql
   insert into public.app_owner (user_id) select id from auth.users where email = 'your@email.de';
   ```
6. **Authentication** → **Sign In / Providers** (or **Settings**) → turn **off** "Allow new users to sign up" → Save. Now nobody else can even create an account.
7. **Project Settings** (gear icon) → **API** (or **Data API**). Copy the **Project URL** and the **anon public** key.

### 2. Put your values into `config.js`
Open `config.js` and replace the three values:
```js
supabaseUrl: "https://abcd1234.supabase.co",
supabaseAnonKey: "eyJhbGciOi…",
ownerEmail: "your@email.de"
```
(The anon key is meant to be public; the database rules protect your data.)

### 3. GitHub
Put this folder into a GitHub repository (for example `kampfmittel-history-map`, can be **private**).

### 4. Vercel: put it online
1. Go to <https://vercel.com> → **Sign up** with GitHub.
2. **Add New…** → **Project** → pick the `kampfmittel-history-map` repository → **Import**.
3. Framework Preset: **Other**. Leave the build settings empty.
4. Open **Environment Variables** and add:
   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key from <https://console.anthropic.com> → API Keys |
   | `SUPABASE_URL` | same Project URL as in config.js |
   | `SUPABASE_ANON_KEY` | same anon key |
   | `OWNER_EMAIL` | your e-mail |
5. **Deploy**. After about a minute you get a link such as `kampfmittel-history-map.vercel.app`.

### 5. First use
1. Open your link → **Owner sign-in** (top right) → e-mail + password.
2. **Sources** tab → **Add documents** → choose your folder `sourcesfor munition`. Known documents are recognised by their fingerprint (SHA-256) and attached to their existing entries (Carter, Map Room files, …).
3. **Sources** tab → **Import page-text bundle** → choose `page-texts.json.gz` (the OCR text of your scanned PDFs, made earlier).
4. Use **Map dates & places** (free, no AI) or **Read with Claude** (more precise) on a chronology.

### AI for visitors (optional)
By default only you can use the AI. To let visitors use it too (reading their own documents into map points, the area chat), add in Vercel → Settings → Environment Variables, then Redeploy:

| Name | Value | Meaning |
|---|---|---|
| `PUBLIC_AI` | `true` | switch the AI on for visitors |
| `PUBLIC_AI_DAILY` | `40` | AI requests per visitor per day (reading one document takes about one request per 9,000 characters) |
| `PUBLIC_AI_TOTAL_DAILY` | `400` | AI requests for all visitors together per day |
| `AI_MODEL_PUBLIC` | `claude-haiku-5-5` | cheaper model for visitors (you keep the stronger one) |

Visitors pay nothing; the cost goes to your Anthropic account. **Set a monthly spend limit in the Anthropic Console (Settings → Limits)** so a busy day can't cost more than you want.

Optional: to make the whole map private, use the commented line in step 3 of `schema.sql`.

## Limits on the free plans
- Supabase free plan: 500 MB database, 1 GB file storage, max 50 MB per file. Large PDFs are split into parts under 20 MB automatically. The project pauses after 7 days without visits; one click in the Supabase dashboard wakes it.
- Vercel free plan (Hobby) is meant for personal, non-commercial use.
- Nominatim address search: fine for normal use (about one search per second).

## Sources and licences
THOR (US Air Force, public domain) · U.S. Army in World War II: Chronology 1941–1945 (public domain) · OpenGeoDB (public domain) · Natural Earth · deutschlandGeoJSON · OpenStreetMap / Nominatim (© OpenStreetMap contributors, ODbL) · Leaflet, pdf.js, pdf-lib, supabase-js.

This is a desk-study aid. It does not replace a historical investigation or clearance survey by a qualified Kampfmittel specialist.
