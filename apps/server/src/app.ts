import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fail } from './lib/responses.js';
import { auth } from './middleware/auth.js';
import { requestContext } from './middleware/request-context.js';
import { detectImagesRoute } from './routes/detect-images.js';
import type { AppDeps, AppEnv } from './types.js';

/**
 * HTTP アプリを組み立てる。ミドルウェア順: requestContext → auth → bodyLimit → route。
 * bodyLimit は chunked transfer も含めてストリーム読み込み中にカウントして制限する。
 * リクエスト全体のエラー優先順位（先勝ち）: 認証 401 → bodyLimit 413 → 非 multipart 415 →
 * パース失敗/0 件 400 → パーツ数超過 413。bodyLimit が Content-Type 検査より手前にあるため、
 * 上限超過の非 multipart ボディは 415 ではなく 413 になる（これが正本契約）。
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', requestContext(deps));

  // ヘルスチェック。auth より前に登録して認証不要で公開する（漏れる情報は readiness のみ）。
  // 200 ok = 受付可能。503 unavailable = 受付不能で、reason に理由を載せる:
  //   - model_unavailable: 起動時にモデルロード失敗（CPU 非対応 / import・load 失敗）。
  //   - inference_saturated: 全スロットが推論タイムアウト後も解放されない（hung）＝容量ゼロ。
  //     orchestrator の liveness probe にこれを拾わせ、プロセス再起動で回復させる想定。
  // 推論経路には一切触れない読み取り専用エンドポイント。
  app.get('/health', (c) => {
    if (!deps.classifier.available) {
      return c.json({ status: 'unavailable' as const, reason: 'model_unavailable' as const }, 503);
    }
    if (deps.health.saturated) {
      return c.json({ status: 'unavailable' as const, reason: 'inference_saturated' as const }, 503);
    }
    return c.json({ status: 'ok' as const }, 200);
  });

  app.use('*', auth(deps));
  app.use(
    '/v1/detect-images',
    bodyLimit({
      maxSize: deps.config.maxBodySize,
      onError: (c) =>
        c.json(
          {
            success: false as const,
            error: { code: 'REQUEST_TOO_LARGE' as const, message: `body exceeds ${deps.config.maxBodySize} bytes` },
          },
          413,
        ),
    }),
  );

  app.post('/v1/detect-images', detectImagesRoute(deps));

  app.notFound((c) => fail(c, 'INVALID_REQUEST', `no route for ${c.req.method} ${c.req.path}`));

  app.onError((err, c) => {
    deps.logger.error({ err }, 'unhandled error in request pipeline');
    return fail(c, 'DETECTION_FAILED', 'internal server error');
  });

  return app;
}
