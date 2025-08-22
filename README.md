# dP

dP - Native AI Customer Data Platform.

ChatGPT-style web app for **Customers** and **Products** with Excel/CSV upload, local validation rules, chat-based Q&A, and a simulated submit.

> ⚠️ This MVP calls OpenAI from the browser using your key (BYOK). For production, proxy all OpenAI requests via your server to avoid exposing secrets.

## Quick Start
```bash
npm install
npm run dev
# open the printed localhost URL
```
In **Settings**, paste your OpenAI API Key to enable the **Ask** feature.

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
