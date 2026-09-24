const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.resolve(process.argv[2] || ".");
const port = Number(process.argv[3] || 18991);
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"]
]);

http.createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname);
  const targetPath = path.resolve(root, `.${requestPath}`);
  if (!targetPath.startsWith(`${root}${path.sep}`) || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": contentTypes.get(path.extname(targetPath).toLowerCase()) || "application/octet-stream" });
  fs.createReadStream(targetPath).pipe(response);
}).listen(port, "127.0.0.1");
