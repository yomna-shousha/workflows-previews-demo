#!/usr/bin/env node
// End-to-end check: start a job on a deployment and confirm the Workflow that completes it
// ran in that same deployment, against the same Durable Object.
//
//   node scripts/smoke.mjs <url> <expected-deployment-label>
//
// e.g. node scripts/smoke.mjs https://pr-12-workflows-previews-demo.example.workers.dev preview:pr-12

const [url, expected] = process.argv.slice(2);
if (!url || !expected) {
  console.error("Usage: smoke.mjs <url> <expected-deployment-label>");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional, for URLs behind Cloudflare Access: `cloudflared access token -app=<url>`.
const headers = process.env.CF_ACCESS_TOKEN ? { "cf-access-token": process.env.CF_ACCESS_TOKEN } : {};

async function request(path, init) {
  // A new Preview can take a few seconds to start serving.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(new URL(path, url), { ...init, headers, redirect: "manual" });
    if (res.ok) return res.json();
    if (attempt >= 10) throw new Error(`${init?.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
    await sleep(3000);
  }
}

const { jobId, caller } = await request("/jobs", { method: "POST" });
console.log(`started job ${jobId} from ${caller}`);
if (caller !== expected) throw new Error(`caller is ${caller}, expected ${expected}`);

const deadline = Date.now() + 90_000;
let last;
while (Date.now() < deadline) {
  last = await request(`/jobs/${jobId}`);
  const status = last.workflow?.status;
  if (status === "complete" || status === "errored" || status === "terminated") break;
  await sleep(2000);
}
console.log(JSON.stringify(last, null, 2));

const checks = [
  ["workflow completed", last?.workflow?.status === "complete"],
  ["workflow ran in this deployment", last?.workflow?.output?.ranBy === expected],
  ["job is done in this deployment's Durable Object", last?.job?.status === "done"],
  ["job completed by this deployment", last?.job?.completedBy === expected],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
