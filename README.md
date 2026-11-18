# Focus — a calm todo list

A beautiful, offline-friendly task manager built with plain HTML, CSS, and JavaScript.
Tasks are stored locally in your browser, work offline, and can optionally sync across
devices using a free Supabase project. No build step, no backend required to get started.

###Live DEMO: https://focus-do.netlify.app/

## Features

- Add, edit (double-click), complete, and delete tasks
- Priorities (low / medium / high) and due dates (today, tomorrow, in a week, or any day)
- Overdue highlighting and friendly due labels
- Filters: All / Active / Done, with live counts
- Drag-and-drop (and `Alt + ↑/↓`) reordering
- Undo for deletions and “clear completed”
- Light & dark themes, with system preference support
- Progress ring and celebratory confetti when everything is done
- Empty states, keyboard shortcuts (`/` to add), reduced-motion support
- Optional cross-device sync via Supabase (email magic link)
- Installable as a PWA and works offline

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy for free

### Netlify Drop (easiest)

1. Go to https://app.netlify.com/drop
2. Drag this folder onto the page
3. Sign in to claim the site (free)
4. You get a URL like `https://your-site.netlify.app`

Other free hosts work too: Cloudflare Pages, GitHub Pages, Vercel.

## Optional cloud sync

Sync uses a free Supabase project. Your tasks stay private via row-level security.

1. Create a free project at https://supabase.com
2. In the SQL editor, run the contents of `supabase/schema.sql`
3. In Authentication → URL Configuration, add your site URL (and `http://localhost:8000` for local testing)
4. Open the app → click the cloud icon → enter your **Project URL** and **anon public key**
5. Sign in with your email; a magic link signs you in on every device

> Use the **anon public** key, never the service role key.

## Project structure

```
index.html            App shell
styles.css            Styling (light + dark themes)
app.js                App logic (local-first data model)
sync.js               Optional Supabase sync
config.js             Optional sync credentials
sw.js                 Service worker (offline support)
manifest.webmanifest  PWA manifest
icons/                App icons
supabase/schema.sql   Database setup for sync
```

## Data & privacy

- Tasks are stored in your browser (`localStorage`). They are **not** uploaded anywhere unless you enable cloud sync.
- Clearing site data deletes your tasks — use cloud sync or export a backup for safety.
- The cloud sync anon key is safe to expose; access is protected by Supabase row-level security.

## License

MIT
