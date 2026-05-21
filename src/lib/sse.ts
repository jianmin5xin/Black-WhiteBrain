// SSE 流式请求工具库（基于 ky + eventsource-parser）
import ky, {
  type KyResponse,
  type AfterResponseHook,
  type NormalizedOptions,
} from 'ky';
import { createParser, type EventSourceParser } from 'eventsource-parser';

export interface SSEOptions {
  onData: (data: string) => void;
  onEvent?: (event: unknown) => void;
  onCompleted?: (error?: Error) => void;
  onAborted?: () => void;
}

export function createSSEHook(options: SSEOptions): AfterResponseHook {
  const hook: AfterResponseHook = async (
    request: Request,
    _options: NormalizedOptions,
    response: KyResponse
  ) => {
    if (!response.ok || !response.body) return;

    let completed = false;
    const finish = (error?: Error): void => {
      if (completed) return;
      completed = true;
      options.onCompleted?.(error);
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf8');
    const parser: EventSourceParser = createParser({
      onEvent: (event) => {
        if (!event.data) return;
        options.onEvent?.(event);
        for (const chunk of event.data.split('\\ ')) {
          options.onData(chunk);
        }
      },
    });

    const read = (): void => {
      reader
        .read()
        .then((result) => {
          if (result.done) {
            finish();
            return;
          }
          parser.feed(decoder.decode(result.value, { stream: true }));
          read();
        })
        .catch((error) => {
          if (request.signal.aborted) {
            options.onAborted?.();
            return;
          }
          finish(error as Error);
        });
    };

    read();
    return response;
  };

  return hook;
}

export interface StreamRequestOptions {
  functionUrl: string;
  requestBody: unknown;
  /** 用户会话 JWT（access_token），用于 Authorization 头 */
  authToken: string;
  /** Supabase anon key，用于 apikey 头 */
  supabaseAnonKey: string;
  onData: (data: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export async function sendStreamRequest(options: StreamRequestOptions): Promise<void> {
  const {
    functionUrl,
    requestBody,
    authToken,
    supabaseAnonKey,
    onData,
    onComplete,
    onError,
    signal,
  } = options;

  const sseHook = createSSEHook({
    onData,
    onCompleted: (error?: Error) => {
      if (error) onError(error);
      else onComplete();
    },
    onAborted: () => console.log('白质层推理请求已中断'),
  });

  try {
    await ky.post(functionUrl, {
      json: requestBody,
      headers: {
        // 必须用用户 JWT 而非 anon key，Edge Function 用此验证身份
        Authorization: `Bearer ${authToken}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      signal,
      timeout: 60000,
      hooks: { afterResponse: [sseHook] },
    });
  } catch (error) {
    if (!signal?.aborted) onError(error as Error);
  }
}
