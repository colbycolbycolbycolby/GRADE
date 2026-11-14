import {
  AnalysisSchema,
  ApiErrorSchema,
  IngestResponseSchema,
  JobStatusSchema,
  TrackSchema,
  type Analysis,
  type IngestResponse,
  type JobStatus,
  type Track,
} from '@grade/schema';

/** The part of a zod schema that we use, so the web app need not depend on zod. */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** An error from the server (`code` is one of ERROR_CODES) or from the network (`network_error`). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: FetchFn;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });
}

export class ApiClient {
  private readonly base: string;
  private readonly doFetch: FetchFn;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: ApiClientOptions = {}) {
    this.base = options.baseUrl ?? '';
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
  }

  audioUrl(trackId: string): string {
    return `${this.base}/api/tracks/${encodeURIComponent(trackId)}/audio`;
  }

  ingestYoutube(url: string): Promise<IngestResponse> {
    return this.request('/api/ingest/youtube', IngestResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  }

  ingestFile(file: File): Promise<IngestResponse> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.request('/api/ingest/file', IngestResponseSchema, { method: 'POST', body });
  }

  getJob(jobId: string): Promise<JobStatus> {
    return this.request(`/api/jobs/${encodeURIComponent(jobId)}`, JobStatusSchema);
  }

  getTrack(trackId: string): Promise<Track> {
    return this.request(`/api/tracks/${encodeURIComponent(trackId)}`, TrackSchema);
  }

  getAnalysis(trackId: string): Promise<Analysis> {
    return this.request(`/api/tracks/${encodeURIComponent(trackId)}/analysis`, AnalysisSchema);
  }

  /**
   * Polls a job until it ends. Resolves on `done`. Throws `ApiError` when the job fails, or an
   * `AbortError` when `signal` aborts.
   */
  async waitForJob(
    jobId: string,
    onProgress: (progress: number) => void = () => undefined,
    options: { signal?: AbortSignal; intervalMs?: number } = {},
  ): Promise<JobStatus> {
    const interval = options.intervalMs ?? 700;
    for (;;) {
      const job = await this.getJob(jobId);
      onProgress(job.progress);
      if (job.status === 'done') return job;
      if (job.status === 'error') {
        throw new ApiError(job.error?.code ?? 'analysis_failed', job.error?.message ?? 'Failed.');
      }
      await this.sleep(interval, options.signal);
    }
  }

  private async request<T>(path: string, schema: Schema<T>, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.doFetch(this.base + path, init);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiError('network_error', 'Cannot reach the server.');
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError('bad_response', 'The server sent an unreadable answer.', res.status);
    }
    if (!res.ok) {
      const err = ApiErrorSchema.safeParse(body);
      if (err.success) throw new ApiError(err.data.code, err.data.message, res.status);
      throw new ApiError('bad_response', `The server answered ${res.status}.`, res.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        'bad_response',
        'The server answer does not match the schema.',
        res.status,
      );
    }
    return parsed.data;
  }
}
