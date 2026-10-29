import {
  DurableObject,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

export interface Env {
  JOBS: DurableObjectNamespace<JobStore>;
  PROCESS_JOB?: Workflow<JobParams>;
  DEPLOYMENT: string;
  PREVIEW_NAME?: string;
}

type JobParams = { jobId: string; createdBy: string };

type Job = {
  id: string;
  createdBy: string;
  status: "queued" | "done";
  completedBy?: string;
};

function whoAmI(env: Env): string {
  return env.PREVIEW_NAME ? `${env.DEPLOYMENT}:${env.PREVIEW_NAME}` : env.DEPLOYMENT;
}

// One object per job. The caller creates the job, the Workflow completes it. If the
// Workflow runs against a different namespace (for example production), it finds no job
// and fails — the bug this repo works around.
export class JobStore extends DurableObject<Env> {
  async create(id: string, createdBy: string): Promise<Job> {
    const job: Job = { id, createdBy, status: "queued" };
    await this.ctx.storage.put("job", job);
    return job;
  }

  async complete(id: string, completedBy: string): Promise<Job> {
    const job = await this.ctx.storage.get<Job>("job");
    if (!job || job.id !== id) {
      throw new Error(`JobStore has never heard of job ${id} (completedBy=${completedBy})`);
    }
    const done: Job = { ...job, status: "done", completedBy };
    await this.ctx.storage.put("job", done);
    return done;
  }

  async get(): Promise<Job | null> {
    return (await this.ctx.storage.get<Job>("job")) ?? null;
  }
}

export class ProcessJob extends WorkflowEntrypoint<Env, JobParams> {
  async run(event: WorkflowEvent<JobParams>, step: WorkflowStep) {
    const ranBy = whoAmI(this.env);
    await step.do("complete job", () =>
      this.env.JOBS.getByName(event.payload.jobId).complete(event.payload.jobId, ranBy),
    );
    return { jobId: event.payload.jobId, createdBy: event.payload.createdBy, ranBy, codeVersion: "test-branch-2" };
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const caller = whoAmI(env);

    if (url.pathname === "/") {
      return Response.json({ caller, routes: ["POST /jobs", "GET /jobs/:id"] });
    }

    if (!env.PROCESS_JOB) {
      return Response.json(
        { error: "PROCESS_JOB binding is missing. Deploy Previews with `npm run preview:deploy`." },
        { status: 500 },
      );
    }

    if (url.pathname === "/jobs" && request.method === "POST") {
      const jobId = crypto.randomUUID();
      await env.JOBS.getByName(jobId).create(jobId, caller);
      await env.PROCESS_JOB.create({ id: jobId, params: { jobId, createdBy: caller } });
      return Response.json({ jobId, caller }, { status: 202 });
    }

    const match = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (match && request.method === "GET") {
      const jobId = match[1];
      const job = await env.JOBS.getByName(jobId).get();
      let workflow: InstanceStatus | { status: "not_found" };
      try {
        workflow = await (await env.PROCESS_JOB.get(jobId)).status();
      } catch {
        workflow = { status: "not_found" };
      }
      return Response.json({ caller, job, workflow });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
