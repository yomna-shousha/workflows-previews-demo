# Workflows in Worker Previews

Worker Previews don't create their own Workflows yet. If a Preview binds to your production Workflow, the Workflow runs **production** code with **production** bindings. In this demo, the production Workflow then fails because the production Durable Object has never heard of the job the Preview created.

This repo works around that in CI until Cloudflare provisions Workflows per Preview automatically.

## How it works

For every pull request, [`scripts/preview.mjs`](scripts/preview.mjs) deploys two things from the branch:

1. **A companion Worker**, `<worker>-pr-<n>`. It owns `<workflow>-pr-<n>` and its own Durable Object namespace. It has no URL and no routes or crons.
2. **The Preview**, `pr-<n>`. Its Workflow and Durable Object bindings point at the companion (`script_name`).

```
Preview pr-12 fetch()  ─┬─▶ Workflow workflows-previews-demo-pr-12 ─▶ ProcessJob.run() (branch code)
                        │                                                   │
                        └─▶ JobStore (companion's namespace) ◀──────────────┘
```

The Preview and its Workflow share the same per-PR state and both run the branch's code. Production is never touched. When the PR closes, the Preview, the Workflow (with its instances) and the companion Worker are deleted.

You don't edit `wrangler.jsonc` per PR. The script reads it and writes two configs you don't commit (`wrangler.ci-*.jsonc`).

## Use it in your repo

1. Copy `scripts/preview.mjs` and `.github/workflows/preview.yml`, and run `npm i -D jsonc-parser`.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. The token needs **Workers Scripts: Edit** and **Workflows: Edit**.
3. Deploy production once (`npx wrangler deploy`). A Preview needs the main Worker to exist.
4. Open a pull request.

Locally: `npm run preview:deploy -- --name my-branch` and `npm run preview:delete -- --name my-branch`.

## Things to know

- **Use `env` bindings for Durable Objects the Workflow touches, not `ctx.exports`.** `ctx.exports` in the Preview resolves to the Preview's own namespace, which the companion's Workflow can't see.
- **Secrets:** the companion is a normal Worker. If your Workflow needs secrets, upload them to it too: `wrangler secret bulk -c wrangler.ci-workflows.jsonc`.
- **Names:** `<worker>-pr-<n>` and `<workflow>-pr-<n>` must stay within 63 characters.
- **Fork PRs** don't get repository secrets, so they can't deploy Previews.
- **Workflow cron schedules** are removed from per-PR Workflows so they don't fire for every open PR.
- Only Workflows defined in this Worker are handled. Workflows bound with `script_name` to another Worker are rejected.

## The demo app

- `POST /jobs` creates a job in a `JobStore` Durable Object and starts the `ProcessJob` Workflow, which marks the job done.
- `GET /jobs/:id` shows the job and the Workflow's status, including where each ran.

`npm run smoke -- <url> <label>` runs that check end to end. For example, `preview:pr-12` for a Preview or `production` for production. CI runs it after every Preview deploy.
