/**
 * One local stand-in for every outside service Article Studio calls during the
 * launch capture, so the capture spends no Claude or Fal.ai credit and plays
 * out the same way every run.
 *
 *   /v1/*        the Anthropic Messages API (ANTHROPIC_BASE_URL points here)
 *   /fal/*       fal.run, reached through preload.mjs
 *   /files/*     the "generated" cover the mock Fal returns
 *   /control/*   gates the capture script opens and closes (below)
 *
 * GATES. Every answer waits at a gate named after its kind (`plan`, `draft`,
 * `visual_brief`, `generate`, `hub`, …). Gates are open unless the capture
 * closes them, so the app also works by hand. The capture holds a gate while
 * it films the progress card, then releases it, which is what decides how
 * long each step label is on screen. The `draft` gate counts: each release
 * lets that many pieces of the stream through, so the draft arrives at a pace
 * the capture sets frame by frame.
 *
 *   node launch/mock/server.mjs        # listens on MOCK_PORT, default 4010
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerFor, falAnswer } from "../story.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.MOCK_PORT || 4010);
const logFile = path.resolve(here, "../.work/mock-requests.jsonl");
fs.mkdirSync(path.dirname(logFile), { recursive: true });

function log(entry) {
  fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

/* ---- gates ---------------------------------------------------------------- */

/** name → credits. Missing or Infinity is open; 0 is held. */
const gates = new Map();
/** name → number of answers currently waiting at it. */
const waiting = new Map();
const wakers = new Set();

function wake() {
  for (const waker of [...wakers]) waker();
}

async function pass(name) {
  waiting.set(name, (waiting.get(name) ?? 0) + 1);
  while ((gates.get(name) ?? Infinity) <= 0) {
    await new Promise((resolve) => {
      const done = () => {
        wakers.delete(done);
        resolve();
      };
      wakers.add(done);
    });
  }
  const credits = gates.get(name) ?? Infinity;
  if (credits !== Infinity) gates.set(name, credits - 1);
  waiting.set(name, waiting.get(name) - 1);
}

function control(res, url) {
  const name = url.searchParams.get("name") ?? "";
  if (url.pathname === "/control/hold") {
    for (const each of name.split(",").filter(Boolean)) gates.set(each, 0);
  } else if (url.pathname === "/control/release") {
    const count = url.searchParams.get("count");
    gates.set(name, count === null ? Infinity : (gates.get(name) ?? 0) + Number(count));
    wake();
  } else if (url.pathname === "/control/open-all") {
    gates.clear();
    wake();
  } else if (url.pathname === "/control/wait") {
    // For preload.mjs: answers once the named gate lets one request through.
    return pass(name).then(() => json(res, 200, { ok: true }));
  }
  json(res, 200, { gates: Object.fromEntries(gates), waiting: Object.fromEntries(waiting) });
}

/* ---- helpers -------------------------------------------------------------- */

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** The text of the user turn: the task the app wrote for this call. */
function taskText(body) {
  const content = body.messages?.at(-1)?.content;
  if (typeof content === "string") return content;
  return (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function message(model, text) {
  return {
    id: `msg_mock_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: Math.ceil(text.length / 4), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

async function streamMessage(res, model, text, gate) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const start = message(model, "");
  start.content = [];
  start.stop_reason = null;
  start.usage.output_tokens = 1;
  send("message_start", { type: "message_start", message: start });
  send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  // Three words a piece, the way a real stream arrives; each piece passes the gate.
  const words = text.match(/\S+\s*|\s+/g) ?? [];
  for (let i = 0; i < words.length; i += 3) {
    await pass(gate);
    send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: words.slice(i, i + 3).join("") } });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  send("content_block_stop", { type: "content_block_stop", index: 0 });
  send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: Math.ceil(text.length / 4) } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

/* ---- services ------------------------------------------------------------- */

async function anthropic(req, res, url) {
  if (req.method === "GET" && url.pathname.startsWith("/v1/models")) {
    return json(res, 200, { data: [], has_more: false, first_id: null, last_id: null });
  }
  if (req.method !== "POST" || url.pathname !== "/v1/messages") return json(res, 404, { error: { type: "not_found" } });
  const body = JSON.parse(await readBody(req));
  const schema = body.output_config?.format?.schema;
  const task = taskText(body);
  const answer = answerFor({ schema, task, stream: Boolean(body.stream) });
  log({ service: "anthropic", kind: answer.kind, stream: Boolean(body.stream), schemaKeys: Object.keys(schema?.properties ?? {}), task: task.slice(0, 300) });
  const text = typeof answer.text === "string" ? answer.text : JSON.stringify(answer.data);
  if (body.stream) return streamMessage(res, body.model, text, answer.kind);
  await pass(answer.kind);
  return json(res, 200, message(body.model, text));
}

async function fal(req, res, url) {
  const raw = await readBody(req);
  const answer = falAnswer({ path: url.pathname.replace(/^\/fal/, ""), body: raw ? JSON.parse(raw) : null });
  log({ service: "fal", path: url.pathname, kind: answer.kind });
  await pass(answer.kind);
  return json(res, answer.status ?? 200, answer.body);
}

function file(res, url) {
  const name = path.basename(url.pathname);
  // Until launch/assets/cover.png exists, the plain placeholder stands in.
  const candidates = [name, name === "cover.png" ? "cover-placeholder.png" : null].filter(Boolean);
  const full = candidates.map((each) => path.resolve(here, "../assets", each)).find((p) => fs.existsSync(p));
  if (!full) return json(res, 404, { error: "not found" });
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  res.writeHead(200, { "content-type": type, "content-length": fs.statSync(full).size });
  fs.createReadStream(full).pipe(res);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith("/control/")) return await control(res, url);
      if (url.pathname.startsWith("/v1/")) return await anthropic(req, res, url);
      if (url.pathname.startsWith("/fal/")) return await fal(req, res, url);
      if (url.pathname.startsWith("/files/")) return file(res, url);
      log({ service: "unknown", method: req.method, path: url.pathname });
      json(res, 404, { error: "not mocked" });
    } catch (error) {
      log({ service: "error", path: url.pathname, message: String(error?.stack || error) });
      json(res, 500, { error: { type: "api_error", message: String(error) } });
    }
  })
  .listen(port, "127.0.0.1", () => console.log(`mock services on http://127.0.0.1:${port}`));
