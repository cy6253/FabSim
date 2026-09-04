/**
 * 빌드 결과를 정적으로 서빙한다 — 배포 전 검증용.
 *
 * `base: "./"` 로 빌드하므로 하위 경로에서도 돌아야 한다. 그걸 확인하려면
 * 실제로 하위 경로에 올려 봐야 한다:
 *
 *   node scripts/serve-dist.mjs dist 5200               # http://localhost:5200/
 *   node scripts/serve-dist.mjs dist 5200 FabSim        # http://localhost:5200/FabSim/
 *
 * Worker가 상대 경로로 로드되기 때문에 이 검증이 의미가 있다 — 하위 경로에서
 * 깨지는 문제는 개발 서버에서는 절대 안 보인다.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? "dist");
const PORT = Number(process.argv[3] ?? 5200);
/**
 * 하위 경로 흉내. "FabSim" 또는 "/FabSim" 둘 다 받는다.
 *
 * 앞 슬래시를 선택으로 둔 이유: Windows의 Git Bash가 인자로 준 "/FabSim"을
 * "C:/Program Files/Git/FabSim"으로 바꿔 버린다(MSYS 경로 변환). 슬래시 없이
 * 넘길 수 있으면 그 함정을 피한다.
 */
const PREFIX = (() => {
  const raw = (process.argv[4] ?? "").trim();
  if (!raw) return "";
  // MSYS가 절대 경로로 바꿔 놓은 경우 마지막 조각만 쓴다.
  const last = raw.split(/[\\/]+/).filter(Boolean).pop() ?? "";
  return last ? `/${last}` : "";
})();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (PREFIX) {
    if (!path.startsWith(PREFIX)) {
      res.writeHead(404).end("prefix 밖 경로");
      return;
    }
    path = path.slice(PREFIX.length) || "/";
  }
  if (path.endsWith("/")) path += "index.html";
  // 상위 디렉터리로 빠져나가는 경로는 막는다.
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("경로 밖");
    return;
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("없음");
  }
}).listen(PORT, () => {
  console.log(`${ROOT} → http://localhost:${PORT}${PREFIX}/`);
});
