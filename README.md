# Workflows in Worker Previews

Worker Previews don't create their own Workflows yet. If a Preview binds to your production Workflow, the Workflow runs **production** code with **production** bindings. In this demo, the production Workflow then fails because the production Durable Object has never heard of the job the Preview created.

This repo works around that in CI until Cloudflare provisions Workflows per Preview automatically.

## Durable Objects vs. Workflows in Previews

**Durable Objects are provisioned per Preview automatically.** Use them the way the [Previews docs](https://developers.cloudflare.com/workers/previews/resources/#durable-objects) describe, through `ctx.exports` or an `env` binding under `previews.durable_objects`. Each Preview gets its own namespace and storage, and you don't need CI for that.

**Workflows are not provisioned per Preview yet.** A Workflow binding under `previews.workflows` only points at a Workflow that already exists. So CI has to create a Workflow for each pull request, and the only way to create a Workflow is to deploy a Worker that owns it. This repo calls that the **companion Worker**.

**Heads up: this means CI deploys an extra Worker for every open pull request.** It is named `<worker>-pr-<n>`, has no URL, routes or crons, and is reached only through the Preview's bindings. It counts toward your account's Workers limit while the pull request is open. When the pull request closes, CI deletes the Preview, the Workflow (with its instances) and the companion Worker. If a cleanup run fails, run `npm run preview:delete -- --name pr-<n>` to remove what's left.

### Why the demo's Durable Object lives in the companion Worker

The Workflow runs in the companion Worker, not in the Preview. Its `env` and `ctx.exports` refer to the companion's Durable Objects, and it has no way to reach the Preview's automatically provisioned namespace.

In this demo the Preview creates a job in the `JobStore` Durable Object and the Workflow marks it done, so both have to use the same namespace. That's why the script points the Preview's `JOBS` binding at the companion's `JobStore` (`script_name`) instead of using the Preview's own namespace.

| Your Workflow… | Durable Objects |
|---|---|
| doesn't touch Durable Objects | Use them exactly as the docs say. CI only provisions the Workflow. |
| calls a Durable Object | That Durable Object has to live in the companion Worker, reached from the Preview through an `env` binding with `script_name`. This is what the demo does. |

## How it works

For every pull request, [`scripts/preview.mjs`](scripts/preview.mjs) deploys two things from the branch:

1. **The companion Worker**, `<worker>-pr-<n>`. It owns the Workflow `<workflow>-pr-<n>` and its own Durable Object namespace.
2. **The Preview**, `pr-<n>`. Its Workflow and Durable Object bindings point at the companion (`script_name`).

```
Preview pr-12 fetch()  ─┬─▶ Workflow workflows-previews-demo-pr-12 ─▶ ProcessJob.run() (branch code)
                        │                                                   │
                        └─▶ JobStore (companion's namespace) ◀──────────────┘
```

The Preview and its Workflow share the same per-PR state and both run the branch's code. Production is never touched.

You don't edit `wrangler.jsonc` per PR. The script reads it and writes two configs you don't commit (`wrangler.ci-*.jsonc`).

## Use it in your repo

1. Copy `scripts/preview.mjs` and `.github/workflows/preview.yml`, and run `npm i -D jsonc-parser`.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets. The token needs **Workers Scripts: Edit** and **Account Settings: Read**.
3. Deploy production once (`npx wrangler deploy`). A Preview needs the main Worker to exist.
4. Open a pull request.

If your `workers.dev` URLs are behind Cloudflare Access, create an Access service token and add a **Service Auth** policy for it to that Access application. Then add `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as repository secrets so the smoke test can reach the Preview.

Locally: `npm run preview:deploy -- --name my-branch` and `npm run preview:delete -- --name my-branch`.

## Things to know

- **Use `env` bindings for Durable Objects the Workflow touches, not `ctx.exports`.** `ctx.exports` in the Preview resolves to the Preview's own namespace, which the companion's Workflow can't see.
- **The script moves every `env` Durable Object binding to the companion,** including ones the Workflow never touches. To keep a Durable Object on the Preview's own namespace, use `ctx.exports` for it.
- **Secrets:** the companion is a normal Worker. If your Workflow needs secrets, upload them to it too: `wrangler secret bulk -c wrangler.ci-workflows.jsonc`.
- **Names:** `<worker>-pr-<n>` and `<workflow>-pr-<n>` must stay within 63 characters.
- **Fork PRs** don't get repository secrets, so they can't deploy Previews.
- **Workflow cron schedules** are removed from per-PR Workflows so they don't fire for every open PR.
- Only Workflows defined in this Worker are handled. Workflows bound with `script_name` to another Worker are rejected.

## The demo app

- `POST /jobs` creates a job in a `JobStore` Durable Object and starts the `ProcessJob` Workflow, which marks the job done.
- `GET /jobs/:id` shows the job and the Workflow's status, including where each ran.

`npm run smoke -- <url> <label>` runs that check end to end. For example, `preview:pr-12` for a Preview or `production` for production. CI runs it after every Preview deploy.
