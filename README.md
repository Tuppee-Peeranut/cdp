# dP

dP - Native AI Customer Data Platform.

ChatGPT-style web app for **Customers** and **Products** with Excel/CSV upload, local validation rules, chat-based Q&A, and a simulated submit.

> ⚠️ This MVP calls OpenAI from the browser using your key (BYOK). For production, proxy all OpenAI requests via your server to avoid exposing secrets.

## Quick Start
```bash
npm install
npm run dev
# open the printed localhost URL
# super admin dashboard available at /super-admin
# super admin login available at /super-admin/login
```
In the profile menu's **Feature Preview**, paste your OpenAI API Key to enable the **Ask** feature.

## Supabase Setup

1. Sign up at [Supabase](https://supabase.com/) and create a project.
2. From the project dashboard copy the **Project URL** and **anon public key**.
3. Create a `.env` file in the project root containing:

   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Restart the dev server after adding these variables.

## Environment Variables

The server expects the following variables to be set before it starts:

- `ACCESS_TOKEN_SECRET` – secret used to sign JSON Web Tokens.
- `SESSION_SECRET` – secret for Express session encryption.

For Supabase authentication, set the following variables in your `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_REDIRECT_URL` – URL Supabase uses after email confirmation. Make sure this URL is whitelisted in your Supabase project settings for each environment.
- `SUPABASE_JWT_SECRET` – secret used to verify Supabase JWTs. Tokens must be signed with the `HS256` algorithm.

See the **OIDC Configuration** section for additional variables when using an identity provider.

To seed the initial super admin account, also configure:

- `SUPERADMIN_SEED_EMAIL` – email for the seeded super admin user.
- `SUPERADMIN_SEED_PASSWORD` – password for the seeded super admin user.
- `SUPERADMIN_INVITATION_CODE` – invitation code required to sign up for a super admin account.

## Features
- Chat-first workflow with **Import**, **Ask**, and **Task (transfer)**.
- Excel/CSV parsing using `xlsx`.
- Editable validation rules (required columns, account pattern, limits, duplicates, business hours).
- Task Monitoring with API endpoint selection and status tracking.
- Template CSV download.

## OIDC Configuration

This project supports OpenID Connect authentication. Configure the following environment variables to match your identity provider:

- `OIDC_ISSUER`
- `OIDC_AUTHORIZATION_URL`
- `OIDC_TOKEN_URL`
- `OIDC_USERINFO_URL`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_CALLBACK_URL`
- `OIDC_LOGOUT_URL`
- `OIDC_POST_LOGOUT_REDIRECT_URI`

These values define the client ID, redirect URIs, and scopes used during the authorization code flow.

## Files
- `src/App.jsx` – Single-file app UI/logic.
- Tailwind configured via `postcss` + `tailwind.config.js`.
# cdp
