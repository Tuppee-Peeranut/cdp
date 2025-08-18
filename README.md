# dBulk

dBulk - Native AI Bulk Payment Platform.

ChatGPT-style web app for **Bulk Credit/Debit Transfers** with Excel/CSV upload, local validation rules, chat-based Q&A, and a simulated submit.

> ⚠️ This MVP calls OpenAI from the browser using your key (BYOK). For production, proxy all OpenAI requests via your server to avoid exposing secrets.

## Quick Start
```bash
npm install
npm run dev
# open the printed localhost URL
```
In **Settings**, paste your OpenAI API Key to enable the **Ask** feature.

## Features
- Chat-first workflow with **Import**, **Ask**, and **Task (transfer)**.
- Excel/CSV parsing using `xlsx`.
- Editable validation rules (required columns, account pattern, limits, duplicates, business hours).
- Task Monitoring with API endpoint selection and status tracking.
- Template CSV download.

## Files
- `src/App.jsx` – Single-file app UI/logic.
- Tailwind configured via `postcss` + `tailwind.config.js`.
# cdp
