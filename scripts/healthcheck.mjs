import http from 'node:http';

// 監視対象のアドレスは server と同じ config から導出する（ポートをハードコードして config と二重管理しない）。
// config パスは Dockerfile の CMD と同じ /config/config.mjs を既定にし、env で上書きできる。
// port / socket のどちらの待ち受けにも対応する（socket は HTTP over Unix domain socket で叩く）。
const configPath = process.env.SENSITIVE_DETECTOR_CONFIG ?? '/config/config.mjs';
const config = (await import(configPath)).default ?? {};

// bind host を config から導出する。0.0.0.0（全 IF）や未指定なら 127.0.0.1 で到達できるが、
// 特定 IP に bind している場合は 127.0.0.1 では届かないのでその IP へ繋ぐ。
const connectHost = config.host && config.host !== '0.0.0.0' ? config.host : '127.0.0.1';
const base = { path: '/health', timeout: 3000 };
const options = config.socket
  ? { ...base, socketPath: config.socket }
  : { ...base, host: connectHost, port: config.port ?? 3009 };

const req = http.get(options, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
