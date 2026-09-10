#!/usr/bin/env node

import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createConnection } from "node:net";

const ENDPOINT = join(homedir(), ".codex", "ipc", "ipc.sock");
const CONNECT_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const startedAt = performance.now();

let endpointExists = false;
let endpointIsSocket = false;
let endpointIsSymlink = false;
let endpointOwnerMatches = false;
let endpointMode = "unknown";
let endpointOwnerOnly = false;
let initializeSuccess = false;
let clientIdPresent = false;
let exitCode = 1;

function modeString(mode) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function printResult() {
  const elapsedMs = Math.round(performance.now() - startedAt);
  process.stdout.write(
    [
      `endpoint=${ENDPOINT}`,
      `endpoint_exists=${endpointExists}`,
      `endpoint_type_socket=${endpointIsSocket}`,
      `endpoint_symlink=${endpointIsSymlink}`,
      `endpoint_owner_match=${endpointOwnerMatches}`,
      `endpoint_mode=${endpointMode}`,
      `endpoint_owner_only=${endpointOwnerOnly}`,
      `initialize_success=${initializeSuccess}`,
      `client_id_present=${clientIdPresent}`,
      `elapsed_ms=${elapsedMs}`,
      `exit_code=${exitCode}`,
      "",
    ].join("\n"),
  );
}

function finish(code) {
  exitCode = code;
  printResult();
  process.exitCode = code;
}

let endpointStat;
try {
  endpointStat = lstatSync(ENDPOINT);
  endpointExists = true;
  endpointIsSocket = endpointStat.isSocket();
  endpointIsSymlink = endpointStat.isSymbolicLink();
  endpointOwnerMatches =
    typeof process.getuid === "function" && endpointStat.uid === process.getuid();
  endpointMode = modeString(endpointStat.mode);
  endpointOwnerOnly = (endpointStat.mode & 0o077) === 0;
} catch {
  finish(2);
  process.exit(2);
}

if (!endpointExists || !endpointIsSocket || endpointIsSymlink || !endpointOwnerMatches || !endpointOwnerOnly) {
  finish(2);
  process.exit(2);
}

const requestId = randomUUID();
const request = {
  type: "request",
  requestId,
  sourceClientId: "initializing-client",
  version: 0,
  method: "initialize",
  params: { clientType: "stream-deck-research-probe" },
};
const requestJson = Buffer.from(JSON.stringify(request), "utf8");
const frame = Buffer.allocUnsafe(4 + requestJson.length);
frame.writeUInt32LE(requestJson.length, 0);
requestJson.copy(frame, 4);

const socket = createConnection({ path: ENDPOINT });
let responseBytes = Buffer.alloc(0);
let frameLength = null;
let settled = false;

function closeAndFinish(code) {
  if (settled) return;
  settled = true;
  socket.destroy();
  finish(code);
}

function consumeResponse() {
  if (frameLength === null) {
    if (responseBytes.length < 4) return;
    frameLength = responseBytes.readUInt32LE(0);
    if (frameLength === 0 || frameLength > MAX_RESPONSE_BYTES) {
      closeAndFinish(3);
      return;
    }
  }

  if (responseBytes.length < 4 + frameLength) return;
  const payload = responseBytes.subarray(4, 4 + frameLength);
  let message;
  try {
    message = JSON.parse(payload.toString("utf8"));
  } catch {
    closeAndFinish(3);
    return;
  }

  if (message?.type !== "response" || message?.requestId !== requestId) {
    closeAndFinish(3);
    return;
  }

  initializeSuccess =
    message.method === "initialize" && message.resultType === "success";
  clientIdPresent = typeof message.result?.clientId === "string" && message.result.clientId.length > 0;
  closeAndFinish(initializeSuccess && clientIdPresent ? 0 : 4);
}

socket.setTimeout(CONNECT_TIMEOUT_MS);
socket.once("connect", () => {
  socket.write(frame);
});
socket.on("data", (chunk) => {
  if (settled) return;
  responseBytes = Buffer.concat([responseBytes, chunk]);
  if (responseBytes.length > 4 + MAX_RESPONSE_BYTES) {
    closeAndFinish(3);
    return;
  }
  consumeResponse();
});
socket.once("timeout", () => closeAndFinish(3));
socket.once("error", () => closeAndFinish(3));
socket.once("close", () => {
  if (!settled) closeAndFinish(3);
});
