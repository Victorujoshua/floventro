# Floventro — Deploy Guide

> Production stack: Vercel (hosting) · Supabase (Postgres) · Loops (transactional email)

---

## Prerequisites

- GitHub account (repo will live here)
- Vercel account at vercel.com (free Hobby tier is enough)
- Supabase project created at supabase.com
- Loops account at loops.so with a verified sending domain

---

## 1. Push code to GitHub

From the project root:

```bash
git add .
git commit -m "initial commit"
```

Then create a new **private** repo on GitHub named `floventro` (no README, no .gitignore) and push:

```bash
git remote add origin https://github.com/<your-username>/floventro.git
git push -u origin main
```

---

## 2. Import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
2. Select the `floventro` repo
3. Vercel auto-detects Next.js. Leave all build settings as defaults:
   - **Framework:** Next.js
   - **Build command:** `pnpm build`
   - **Output directory:** `.next`
   - **Install command:** `pnpm install`
   - **Node version:** 20.x
4. **Do not deploy yet** — set environment variables first (step 3).

---

## 3. Set environment variables in Vercel

In the Vercel project → **Settings → Environment Variables**, add all of the following for **Production**, **Preview**, and **Development**:

| Variable | Where to find it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → `service_role` key (**keep secret**) |
| `LOOPS_API_KEY` | Loops dashboard → Settings → API Keys |
| `LOOPS_INVITE_TRANSACTIONAL_ID` | ID of the "Team Invite" transactional email in Loops (see `docs/loops-setup.md`) |
| `LOOPS_WAITLIST_TRANSACTIONAL_ID` | ID of the waitlist confirmation transactional email in Loops |
| `NEXT_PUBLIC_SITE_URL` | `https://floventro.com` |

> **Security:** `SUPABASE_SERVICE_ROLE_KEY` and `LOOPS_API_KEY` are server-only secrets.
> Never set them as `NEXT_PUBLIC_*`.

---

## 4. Run the Supabase migration

Before the first deploy, run the waitlist schema migration against your Supabase project:

**Option A — Supabase CLI:**
```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <your-project-id>
pnpm dlx supabase db push
```

**Option B — Supabase dashboard SQL editor:**
1. Open Supabase dashboard → SQL Editor
2. Paste the contents of `supabase/migrations/0001_waitlist.sql`
3. Run

Then regenerate the TypeScript types (optional but recommended):
```bash
pnpm dlx supabase gen types typescript --project-id <your-project-id> > types/supabase.ts
git add types/supabase.ts && git commit -m "regenerate supabase types"
git push
```

---

## 5. First deploy

Back in Vercel, click **Deploy**. The build takes ~30–60 seconds.

Verify:
- `https://<your-vercel-preview-url>/` loads the landing page
- `https://<your-vercel-preview-url>/robots.txt` returns correct content
- `https://<your-vercel-preview-url>/sitemap.xml` returns the sitemap
- POST to `/api/waitlist` with a real email returns `{"ok":true}`

---

## 6. Custom domain

In Vercel project → **Settings → Domains**, add both:

```
floventro.com
www.floventro.com
```

Vercel will show you the DNS records to add. In your domain registrar (wherever `floventro.com` is registered):

| Type | Name | Value |
|------|------|-------|
| `A` | `@` | `76.76.21.21` *(Vercel's IP — confirm in Vercel UI)* |
| `CNAME` | `www` | `cname.vercel-dns.com` |

DNS propagation takes 5–30 minutes. Vercel provisions the SSL certificate automatically once DNS resolves.

---

## 7. Loops — domain verification + email templates

See `docs/loops-setup.md` for the full setup: DNS records (SPF/DKIM), invite template creation, and env vars.

---

## 9. Post-deploy checklist

- [ ] Landing page loads at `https://floventro.com`
- [ ] Nav logo renders, scroll shadow appears past 24px
- [ ] "Join Waitlist →" opens the modal
- [ ] Submitting a real email returns success and sends a confirmation email
- [ ] Submitting the same email again returns the "already on list" state (no second email)
- [ ] `/robots.txt` and `/sitemap.xml` return correct content
- [ ] Vercel Analytics dashboard shows the first `waitlist_signup` event after a test signup
- [ ] Page title and OG description are correct when pasted into Slack/Twitter
- [ ] Mobile viewport (375px) has no horizontal scroll
- [ ] Replace `public/asset/og-image.png.placeholder.txt` with the real OG image

---

## 10. Ongoing

| Task | Command |
|------|---------|
| New deploy | `git push origin main` — Vercel auto-deploys |
| Preview branch | Push any branch — Vercel creates a preview URL |
| Check logs | Vercel dashboard → Functions → `/api/waitlist` |
| Download waitlist | Supabase dashboard → Table Editor → `waitlist` → Export CSV |
| Regen Supabase types | `pnpm dlx supabase gen types typescript --project-id <id> > types/supabase.ts` |
