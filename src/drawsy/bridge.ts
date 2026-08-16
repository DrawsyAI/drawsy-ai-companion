import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  CodexAppServer,
  isCodexThreadMissingError
} from "./codex-app-server.js";
import { OpenCodeAppServer } from "./opencode-app-server.js";
import {
  LocalConversationStore,
  type LocalConversationPreferences
} from "./local-conversation-store.js";
import { pickFolder } from "./folder-picker.js";
import { readLocalEngineStatus } from "./engine-status.js";
import {
  createCanvasImageAsset,
  createCanvasImageAssetFromBytes,
  createCanvasImageFileFromBytes,
  inspectCanvasImage
} from "./image-asset.js";
import {
  CANVAS_REQUEST_TIMEOUT_MS,
  MAX_CANVAS_ASSET_BYTES,
  MAX_BODY_BYTES,
  isRecord,
  parseCanvasContextReference,
  parseCanvasContextRequest,
  parseCanvasImageRequest,
  parseLivePreviewRequest,
  parseCanvasOperations,
  parseAgentConnectorTurn,
  parseAgentResourceTurn,
  isConnectorCapability,
  type AgentConnectorTurn,
  type AgentEngine,
  type AgentResourceTurn,
  type AgentSettingsPatch,
  type AgentPromptTag,
  type BridgeEvent,
  type CanvasContextReference,
  type CanvasContextRequest,
  type CanvasImageReplacement,
  type CanvasOperations,
  type LivePreviewRequest,
  type DrawsySurfaceKind,
} from "./protocol.js";

type FolderSelection = {
  id: string;
  path: string;
  name: string;
  expiresAt: number;
};

const MAX_DRAW_DOCUMENT_BYTES = 512 * 1024;

const readDrawDocument = async (folder: FolderSelection) => {
  const candidate = path.join(folder.path, "DRAW.md");
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false as const };
    }
    throw error;
  }

  const relative = path.relative(folder.path, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BridgeRequestError(
      400,
      "draw_document_outside_folder",
      "DRAW.md must be inside the selected folder."
    );
  }

  const file = await stat(resolved);
  if (!file.isFile()) {
    throw new BridgeRequestError(
      400,
      "draw_document_invalid",
      "DRAW.md must be a regular file."
    );
  }
  if (file.size > MAX_DRAW_DOCUMENT_BYTES) {
    throw new BridgeRequestError(
      413,
      "draw_document_too_large",
      "DRAW.md must be 512 KiB or smaller."
    );
  }

  const content = await readFile(resolved, "utf8");
  return {
    exists: true as const,
    name: "DRAW.md",
    content,
    hash: createHash("sha256").update(content).digest("hex"),
    sourceId: createHash("sha256")
      .update(folder.path)
      .digest("hex")
      .slice(0, 24)
  };
};

type CanvasPending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type StoredContextAsset = {
  id: string;
  path: string;
  mimeType: string;
};

type StoredContextCapture = {
  id: string;
  preview?: StoredContextAsset;
  sources: Map<string, StoredContextAsset>;
  createdAt: number;
};

type Session = {
  id: string;
  conversationId: string | null;
  clientId: string | null;
  token: string;
  internalSecret: string;
  canvasId: string | null;
  canvasName: string;
  surfaceKind: DrawsySurfaceKind;
  surfaceId: string | null;
  surfaceName: string;
  folder: FolderSelection;
  clients: Set<ServerResponse>;
  canvasPending: Map<string, CanvasPending>;
  generatedImages: Array<{
    id: string;
    savedPath?: string;
    result?: string;
    createdAt: number;
  }>;
  contextCaptures: Map<string, StoredContextCapture>;
  activeConnectorTurn: AgentConnectorTurn | null;
  activeResourceTurn: AgentResourceTurn | null;
  engine: AgentEngine;
  agent: CodexAppServer | OpenCodeAppServer;
  previewPort: number | null;
  touchedAt: number;
};

class BridgeRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
};

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const bearerToken = (request: IncomingMessage) => {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7) : "";
};

const readJson = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error(
        `Request body exceeds ${MAX_BODY_BYTES / (1024 * 1024)} MiB.`
      );
    }
    chunks.push(buffer);
  }
  if (!chunks.length) {
    return {};
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!isRecord(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return value;
};

const readBytes = async (
  request: IncomingMessage,
  maxBytes = MAX_CANVAS_ASSET_BYTES
) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error(
        `Canvas context asset exceeds ${maxBytes / 1024 / 1024} MiB.`
      );
    }
    chunks.push(buffer);
  }
  if (!size) {
    throw new Error("Canvas context asset is empty.");
  }
  return Buffer.concat(chunks);
};

const readFetchText = async (response: Response, maxBytes: number) => {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BridgeRequestError(
        502,
        "connector_response_too_large",
        "The connected source returned too much data. Narrow the request."
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const parsePromptTags = (value: unknown, label: string): AgentPromptTag[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error(`${label} must be an array of at most 20 tags.`);
  }
  const tags = value.map((tag) => {
    if (
      !isRecord(tag) ||
      typeof tag.name !== "string" ||
      !tag.name.trim() ||
      typeof tag.path !== "string" ||
      !tag.path.trim()
    ) {
      throw new Error(`${label} contains an invalid tag.`);
    }
    return { name: tag.name.trim(), path: tag.path };
  });
  return tags.filter(
    (tag, index) =>
      tags.findIndex(
        (candidate) =>
          candidate.name === tag.name && candidate.path === tag.path
      ) === index
  );
};

const parseLocalPreferences = (
  value: Record<string, unknown>
): Omit<LocalConversationPreferences, "updatedAt"> => {
  if (
    Object.keys(value).some(
      (key) => key !== "engine" && key !== "codex" && key !== "opencode"
    ) ||
    (value.engine !== "codex" && value.engine !== "opencode")
  ) {
    throw new BridgeRequestError(
      400,
      "preferences_invalid",
      "The local AI preferences are invalid."
    );
  }
  const parsePreference = (
    candidate: unknown
  ): LocalConversationPreferences["codex"] => {
    if (!isRecord(candidate)) {
      throw new BridgeRequestError(
        400,
        "preferences_invalid",
        "The local AI preferences are invalid."
      );
    }
    if (
      Object.keys(candidate).some(
        (key) =>
          ![
            "model",
            "modelProvider",
            "effort",
            "accessMode",
            "internetEnabled"
          ].includes(key)
      ) ||
      (candidate.model !== undefined &&
        candidate.model !== null &&
        typeof candidate.model !== "string") ||
      (candidate.modelProvider !== undefined &&
        candidate.modelProvider !== null &&
        typeof candidate.modelProvider !== "string") ||
      (candidate.effort !== undefined &&
        candidate.effort !== null &&
        typeof candidate.effort !== "string") ||
      (candidate.accessMode !== undefined &&
        candidate.accessMode !== "workspace" &&
        candidate.accessMode !== "readOnly" &&
        candidate.accessMode !== null) ||
      (candidate.internetEnabled !== undefined &&
        candidate.internetEnabled !== null &&
        typeof candidate.internetEnabled !== "boolean")
    ) {
      throw new BridgeRequestError(
        400,
        "preferences_invalid",
        "The local AI preferences are invalid."
      );
    }
    return {
      model: typeof candidate.model === "string" ? candidate.model : null,
      modelProvider:
        typeof candidate.modelProvider === "string"
          ? candidate.modelProvider
          : null,
      effort: typeof candidate.effort === "string" ? candidate.effort : null,
      accessMode:
        candidate.accessMode === "workspace" ||
        candidate.accessMode === "readOnly"
          ? (candidate.accessMode as "workspace" | "readOnly")
          : null,
      internetEnabled:
        typeof candidate.internetEnabled === "boolean"
          ? candidate.internetEnabled
          : null
    };
  };
  return {
    engine: value.engine,
    codex: parsePreference(value.codex),
    opencode: parsePreference(value.opencode)
  };
};

const parseContextReferences = (value: unknown): CanvasContextReference[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) {
    throw new Error("contexts must contain at most 3 canvas captures.");
  }
  const contexts = value.map(parseCanvasContextReference);
  if (new Set(contexts.map((context) => context.id)).size !== contexts.length) {
    throw new Error("contexts must be unique.");
  }
  return contexts;
};

export const createDrawsyBridge = (
  options: {
    port?: number;
    host?: string;
    allowedOrigins?: string[];
  } = {}
) => {
  const port = options.port ?? Number(process.env.PORT || 3031);
  const host = options.host ?? "127.0.0.1";
  const allowedOrigins = new Set(
    options.allowedOrigins ??
      (
        process.env.DRAWSY_ALLOWED_ORIGINS ||
        "http://localhost:3001,http://127.0.0.1:3001,https://beta.drawsyai.tech"
      )
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
  );
  const configuredCanvasRequestTimeout = Number(
    process.env.DRAWSY_CANVAS_REQUEST_TIMEOUT_MS || CANVAS_REQUEST_TIMEOUT_MS
  );
  if (
    !Number.isInteger(configuredCanvasRequestTimeout) ||
    configuredCanvasRequestTimeout < 5_000 ||
    configuredCanvasRequestTimeout > 120_000
  ) {
    throw new Error(
      "DRAWSY_CANVAS_REQUEST_TIMEOUT_MS must be between 5000 and 120000."
    );
  }
  const connectHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const bridgeUrl = `http://${connectHost}:${port}`;
  const connectorBackendUrl = (() => {
    const configured = process.env.DRAWSY_CONNECTOR_BACKEND_URL?.trim();
    if (!configured) return null;
    const value = new URL(configured);
    const isLoopback = ["127.0.0.1", "::1", "localhost"].includes(
      value.hostname
    );
    if (
      (value.protocol !== "https:" &&
        !(value.protocol === "http:" && isLoopback)) ||
      value.username ||
      value.password
    ) {
      throw new Error(
        "DRAWSY_CONNECTOR_BACKEND_URL must be HTTPS or a loopback HTTP URL."
      );
    }
    return value;
  })();
  const selections = new Map<string, FolderSelection>();
  const sessions = new Map<string, Session>();
  const conversationSessions = new Map<string, Session>();
  const conversationStartLocks = new Map<string, Promise<void>>();
  const localConversations = new LocalConversationStore();
  const emit = (session: Session, event: BridgeEvent) => {
    session.touchedAt = Date.now();
    if (
      event.type === "error" ||
      (event.type === "turn.status" && event.data.status !== "inProgress")
    ) {
      session.activeConnectorTurn = null;
      session.activeResourceTurn = null;
    }
    const line = `${JSON.stringify(event)}\n`;
    for (const client of session.clients) {
      client.write(line);
    }
  };

  const sessionContextPath = (session: Session) =>
    path.join(session.folder.path, ".drawsy", "context", session.id);

  const prepareContextStore = async (folderPath: string) => {
    const drawsyPath = path.join(folderPath, ".drawsy");
    const contextPath = path.join(drawsyPath, "context");
    await mkdir(contextPath, { recursive: true });
    try {
      await writeFile(path.join(drawsyPath, ".gitignore"), "*\n", {
        flag: "wx"
      });
    } catch (error) {
      if (!isRecord(error) || error.code !== "EEXIST") throw error;
    }
    const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of await readdir(contextPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(contextPath, entry.name);
      const details = await stat(candidate).catch(() => null);
      if (details && details.mtimeMs < staleBefore) {
        await rm(candidate, { recursive: true, force: true });
      }
    }
  };

  const closeSession = (session: Session) => {
    sessions.delete(session.id);
    if (
      session.conversationId &&
      conversationSessions.get(session.conversationId)?.id === session.id
    ) {
      conversationSessions.delete(session.conversationId);
    }
    session.agent.close();
    for (const pending of session.canvasPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Drawsy session closed."));
    }
    for (const client of session.clients) {
      client.end();
    }
    void rm(sessionContextPath(session), { recursive: true, force: true });
  };

  const requirePublicOrigin = (
    request: IncomingMessage,
    response: ServerResponse
  ) => {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      json(response, 403, {
        error: { code: "origin_denied", message: "Origin is not allowed." }
      });
      return false;
    }
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
    return true;
  };

  const publicSession = (
    request: IncomingMessage,
    response: ServerResponse,
    sessionId: string
  ) => {
    const session = sessions.get(sessionId);
    if (!session || !safeEqual(bearerToken(request), session.token)) {
      json(response, 401, {
        error: { code: "authentication_required", message: "Invalid session." }
      });
      return null;
    }
    session.touchedAt = Date.now();
    return session;
  };

  const internalSession = (
    request: IncomingMessage,
    response: ServerResponse,
    sessionId: string
  ) => {
    const session = sessions.get(sessionId);
    if (!session || !safeEqual(bearerToken(request), session.internalSecret)) {
      json(response, 401, {
        error: {
          code: "authentication_required",
          message: "Invalid MCP scope."
        }
      });
      return null;
    }
    session.touchedAt = Date.now();
    return session;
  };

  const connectorSource = (
    session: Session,
    capability: unknown,
    connectionId: unknown
  ) => {
    if (!session.activeConnectorTurn) {
      throw new BridgeRequestError(
        403,
        "connector_not_attached",
        "No connected source was attached to this turn."
      );
    }
    if (!isConnectorCapability(capability)) {
      throw new BridgeRequestError(
        400,
        "connector_capability_invalid",
        "The connected-source capability is invalid."
      );
    }
    if (
      connectionId !== undefined &&
      (typeof connectionId !== "string" || !connectionId.trim())
    ) {
      throw new BridgeRequestError(
        400,
        "connector_connection_invalid",
        "The connected-source connection is invalid."
      );
    }
    const matches = session.activeConnectorTurn.sources.filter(
      (source) =>
        source.capability === capability &&
        (connectionId === undefined || source.connectionId === connectionId)
    );
    if (!matches.length) {
      throw new BridgeRequestError(
        403,
        "connector_not_attached",
        "That connected source was not attached to this turn."
      );
    }
    if (matches.length > 1) {
      throw new BridgeRequestError(
        409,
        "connector_account_required",
        "More than one matching account is attached. List sources and pass connectionId."
      );
    }
    const source = matches[0]!;
    const grant = session.activeConnectorTurn.grants.find(
      (candidate) => candidate.connectionId === source.connectionId
    );
    if (!grant || grant.expiresAt <= Date.now()) {
      throw new BridgeRequestError(
        401,
        "connector_grant_expired",
        "Connected-source access expired. Send the message again."
      );
    }
    return { source, grant };
  };

  const executeConnectorRequest = async (
    session: Session,
    action: "search" | "read" | "query" | "mcp-tools" | "mcp-call",
    body: Record<string, unknown>
  ) => {
    if (!connectorBackendUrl) {
      throw new BridgeRequestError(
        503,
        "cloud_connectors_unavailable",
        "Connected sources are available only when cloud mode is configured."
      );
    }
    const allowedKeys =
      action === "search"
        ? new Set([
            "capability",
            "connectionId",
            "query",
            "region",
            "cursor",
            "limit"
          ])
        : action === "read"
        ? new Set(["capability", "connectionId", "resourceId"])
        : action === "mcp-tools"
        ? new Set(["capability", "connectionId"])
        : action === "mcp-call"
        ? new Set(["capability", "connectionId", "toolName", "arguments"])
        : new Set([
            "capability",
            "connectionId",
            "kind",
            "query",
            "after",
            "before",
            "from",
            "to",
            "subject",
            "label",
            "includeSpamTrash",
            "calendarId",
            "channelId",
            "startTime",
            "endTime",
            "timeZone",
            "mimeType",
            "orderBy",
            "object",
            "sortDirection",
            "owner",
            "visibility",
            "repository",
            "path",
            "ref",
            "state",
            "labels",
            "since",
            "sort",
            "direction",
            "region",
            "head",
            "base",
            "cursor",
            "limit"
          ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      throw new BridgeRequestError(
        400,
        "connector_request_invalid",
        "The connected-source request contains an unknown field."
      );
    }
    const { source, grant } = connectorSource(
      session,
      body.capability,
      body.connectionId
    );
    let operation:
      | {
          operation: "search";
          query: string;
          region?: string;
          cursor?: string;
          limit?: number;
        }
      | { operation: "read"; resourceId: string }
      | { operation: "mcp_tools" }
      | {
          operation: "mcp_call";
          toolName: string;
          arguments: Record<string, unknown>;
        }
      | ({ operation: "list" } & Record<string, unknown>);
    if (action === "search") {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      const awsSearch = source.capability === "aws";
      const maxQueryLength = awsSearch ? 1_280 : 2_000;
      const maxResults = awsSearch ? 100 : 20;
      if (
        (!awsSearch && !query) ||
        query.length > maxQueryLength ||
        (body.cursor !== undefined &&
          (typeof body.cursor !== "string" || body.cursor.length > 4_096)) ||
        (body.limit !== undefined &&
          (typeof body.limit !== "number" ||
            !Number.isInteger(body.limit) ||
            body.limit < 1 ||
            body.limit > maxResults))
      ) {
        throw new BridgeRequestError(
          400,
          "connector_request_invalid",
          "The connected-source search is invalid."
        );
      }
      operation = {
        operation: "search",
        query,
        ...(typeof body.region === "string" ? { region: body.region } : {}),
        ...(typeof body.cursor === "string" ? { cursor: body.cursor } : {}),
        ...(typeof body.limit === "number" ? { limit: body.limit } : {})
      };
    } else if (action === "read") {
      const resourceId =
        typeof body.resourceId === "string" ? body.resourceId.trim() : "";
      if (!resourceId || resourceId.length > 4_096) {
        throw new BridgeRequestError(
          400,
          "connector_request_invalid",
          "The connected item reference is invalid."
        );
      }
      operation = { operation: "read", resourceId };
    } else if (action === "mcp-tools") {
      operation = { operation: "mcp_tools" };
    } else if (action === "mcp-call") {
      const toolName =
        typeof body.toolName === "string" ? body.toolName.trim() : "";
      const args = body.arguments;
      if (
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(toolName) ||
        !isRecord(args) ||
        Buffer.byteLength(JSON.stringify(args), "utf8") > 64 * 1024
      ) {
        throw new BridgeRequestError(
          400,
          "connector_request_invalid",
          "The remote MCP tool request is invalid."
        );
      }
      operation = { operation: "mcp_call", toolName, arguments: args };
    } else {
      const {
        capability: _capability,
        connectionId: _connectionId,
        ...input
      } = body;
      operation = { operation: "list", ...input };
    }
    const response = await fetch(
      new URL("/v1/connectors/ai/execute", connectorBackendUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${grant.grant}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sessionId: session.id,
          turnId: session.activeConnectorTurn!.turnId,
          connectionId: source.connectionId,
          capability: source.capability,
          ...operation
        }),
        signal: AbortSignal.timeout(30_000)
      }
    );
    const text = await readFetchText(response, 512 * 1024);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new BridgeRequestError(
        502,
        "connector_response_invalid",
        "The connected source returned an invalid response."
      );
    }
    if (!response.ok) {
      const message =
        isRecord(payload) &&
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
          ? payload.error.message
          : `Connected-source request failed (${response.status}).`;
      throw new BridgeRequestError(
        response.status >= 400 && response.status < 500 ? response.status : 502,
        "connector_request_failed",
        message
      );
    }
    return payload;
  };

  const executeResourceRequest = async (
    session: Session,
    body: Record<string, unknown>
  ) => {
    if (!connectorBackendUrl) {
      throw new BridgeRequestError(
        503,
        "cloud_resources_unavailable",
        "Drawsy resources are available only when cloud mode is configured."
      );
    }
    const active = session.activeResourceTurn;
    if (!active) {
      throw new BridgeRequestError(
        403,
        "resource_not_attached",
        "No Drawsy resource was attached to this turn."
      );
    }
    if (active.expiresAt <= Date.now()) {
      throw new BridgeRequestError(
        401,
        "resource_grant_expired",
        "Drawsy resource access expired. Send the message again."
      );
    }
    const operation =
      typeof body.operation === "string" ? body.operation.trim() : "";
    const resource = operation.startsWith("kanban_")
      ? "kanban"
      : operation.startsWith("jira_")
      ? "jira"
      : null;
    if (!resource || !active.resources.includes(resource)) {
      throw new BridgeRequestError(
        403,
        "resource_not_attached",
        "That Drawsy resource was not attached to this turn."
      );
    }
    if (
      Object.keys(body).some((key) =>
        ["sessionId", "turnId", "grant"].includes(key)
      )
    ) {
      throw new BridgeRequestError(
        400,
        "resource_request_invalid",
        "The Drawsy resource request contains a protected field."
      );
    }
    const requestBody = { ...body };
    if (operation === "kanban_read_current_board") {
      if (session.surfaceKind !== "kanban" || !session.surfaceId) {
        throw new BridgeRequestError(
          400,
          "resource_request_invalid",
          "No current Kanban board is attached to this chat."
        );
      }
      requestBody.operation = "kanban_read_board";
      requestBody.boardId = session.surfaceId;
    }
    if (operation === "kanban_link_current_canvas") {
      if (session.surfaceKind !== "canvas" || !session.canvasId) {
        throw new BridgeRequestError(
          400,
          "resource_request_invalid",
          "Only a Drawsy canvas can be linked to a Kanban card."
        );
      }
      requestBody.operation = "kanban_link_canvas";
      requestBody.canvasId = session.canvasId;
    }
    if (operation === "kanban_create_card") {
      const linkCurrentCanvas = requestBody.linkCurrentCanvas;
      delete requestBody.linkCurrentCanvas;
      if (linkCurrentCanvas === true) {
        if (session.surfaceKind !== "canvas" || !session.canvasId) {
          throw new BridgeRequestError(
            400,
            "resource_request_invalid",
            "Only a Drawsy canvas can be linked to a Kanban card."
          );
        }
        requestBody.linkCanvasId = session.canvasId;
      } else if (
        linkCurrentCanvas !== undefined &&
        linkCurrentCanvas !== false
      ) {
        throw new BridgeRequestError(
          400,
          "resource_request_invalid",
          "linkCurrentCanvas must be true or false."
        );
      }
    }
    const response = await fetch(
      new URL("/v1/ai/resources/execute", connectorBackendUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${active.grant}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          ...requestBody,
          sessionId: session.id,
          turnId: active.turnId
        }),
        signal: AbortSignal.timeout(30_000)
      }
    );
    const text = await readFetchText(response, 512 * 1024);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new BridgeRequestError(
        502,
        "resource_response_invalid",
        "The Drawsy resource returned an invalid response."
      );
    }
    if (!response.ok) {
      const message =
        isRecord(payload) &&
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
          ? payload.error.message
          : `Drawsy resource request failed (${response.status}).`;
      throw new BridgeRequestError(
        response.status >= 400 && response.status < 500 ? response.status : 502,
        "resource_request_failed",
        message
      );
    }
    return payload;
  };

  const storeContextAsset = async (
    session: Session,
    input: {
      captureId: string;
      role: "preview" | "source";
      assetId: string;
      bytes: Buffer;
    }
  ) => {
    if (
      !/^[a-f0-9-]{36}$/i.test(input.captureId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.assetId)
    ) {
      throw new Error("Canvas context asset identifier is invalid.");
    }
    const metadata = inspectCanvasImage(input.bytes);
    if (input.role === "preview" && metadata.mimeType !== "image/png") {
      throw new Error("Canvas context previews must be PNG images.");
    }
    const capture = session.contextCaptures.get(input.captureId) || {
      id: input.captureId,
      sources: new Map<string, StoredContextAsset>(),
      createdAt: Date.now()
    };
    if (
      input.role === "source" &&
      !capture.sources.has(input.assetId) &&
      capture.sources.size >= 4
    ) {
      throw new Error("A canvas context can include at most 4 source images.");
    }
    const extension =
      metadata.mimeType === "image/jpeg"
        ? "jpg"
        : metadata.mimeType.slice("image/".length);
    const digest = createHash("sha256")
      .update(input.bytes)
      .digest("hex")
      .slice(0, 24);
    const directory = path.join(sessionContextPath(session), input.captureId);
    await mkdir(directory, { recursive: true });
    const assetPath = path.join(
      directory,
      `${input.role}-${input.assetId}-${digest}.${extension}`
    );
    await writeFile(assetPath, input.bytes, { flag: "wx" }).catch((error) => {
      if (!isRecord(error) || error.code !== "EEXIST") throw error;
    });
    const asset: StoredContextAsset = {
      id: input.assetId,
      path: assetPath,
      mimeType: metadata.mimeType
    };
    if (input.role === "preview") capture.preview = asset;
    else capture.sources.set(input.assetId, asset);
    session.contextCaptures.set(input.captureId, capture);
    return asset;
  };

  const resolveContextCaptures = (
    session: Session,
    references: CanvasContextReference[]
  ) =>
    references.map((reference) => {
      const stored = session.contextCaptures.get(reference.id);
      if (!stored?.preview) {
        throw new Error("Canvas context is missing its selection preview.");
      }
      return {
        ...reference,
        previewPath: stored.preview.path,
        sourceImages: [...stored.sources.values()].map((source) => ({
          id: source.id,
          path: source.path
        }))
      };
    });

  const requestCanvas = (
    session: Session,
    action:
      | "read"
      | "apply"
      | "inspect"
      | "capture"
      | "replaceImage"
      | "preview",
    options: {
      operations?: CanvasOperations;
      contextRequest?: CanvasContextRequest;
      imageReplacement?: CanvasImageReplacement;
      previewRequest?: LivePreviewRequest;
    } = {}
  ) => {
    if (
      (session.surfaceKind !== "canvas" &&
        session.surfaceKind !== "presentation") ||
      !session.canvasId
    ) {
      throw new Error("No Drawsy canvas is attached to this chat.");
    }
    if (!session.clients.size) {
      throw new Error("The Drawsy canvas is not connected.");
    }
    const requestId = randomUUID();
    emit(session, {
      type: "canvas.request",
      data: {
        requestId,
        action,
        canvasId: session.canvasId,
        ...options
      }
    });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.canvasPending.delete(requestId);
        reject(new Error("Canvas response timed out."));
      }, configuredCanvasRequestTimeout);
      session.canvasPending.set(requestId, { resolve, reject, timer });
    });
  };

  const readImportableImage = async (session: Session, sourcePath: string) => {
    const normalizedSource = path.isAbsolute(sourcePath)
      ? path.resolve(sourcePath)
      : null;
    const generated =
      sourcePath === "imagegen://latest"
        ? session.generatedImages.at(-1)
        : session.generatedImages.find(
            (image) =>
              image.savedPath &&
              path.resolve(image.savedPath) === normalizedSource
          );
    if (generated) {
      let bytes: Buffer;
      if (generated.result?.startsWith("data:image/")) {
        const separator = generated.result.indexOf(",");
        if (
          separator < 0 ||
          !generated.result.slice(0, separator).endsWith(";base64")
        ) {
          throw new Error("The generated image payload is invalid.");
        }
        bytes = Buffer.from(generated.result.slice(separator + 1), "base64");
      } else if (generated.savedPath) {
        const details = await stat(generated.savedPath);
        if (!details.isFile() || details.size > MAX_CANVAS_ASSET_BYTES) {
          throw new Error(
            `The generated image must be at most ${
              MAX_CANVAS_ASSET_BYTES / (1024 * 1024)
            } MiB.`
          );
        }
        bytes = await readFile(generated.savedPath);
      } else {
        throw new Error("The generated image has no readable raster output.");
      }
      return {
        bytes,
        sourceName: generated.savedPath
          ? path.basename(generated.savedPath)
          : `${generated.id}.png`
      };
    }
    const asset = await createCanvasImageAsset({
      workspaceRoot: session.folder.path,
      sourcePath,
      x: 0,
      y: 0,
      maxWidth: 1
    });
    const separator = asset.file.dataURL.indexOf(",");
    return {
      bytes: Buffer.from(asset.file.dataURL.slice(separator + 1), "base64"),
      sourceName: path.basename(sourcePath)
    };
  };

  const importCanvasImage = async (session: Session, value: unknown) => {
    const input = parseCanvasImageRequest(value);
    const source = await readImportableImage(session, input.sourcePath);
    const asset = createCanvasImageAssetFromBytes({ ...input, ...source });
    await requestCanvas(session, "apply", {
      operations: {
        upsertElements: [asset.element],
        deleteElementIds: [],
        files: [asset.file]
      }
    });
    return {
      elementId: asset.elementId,
      width: asset.width,
      height: asset.height
    };
  };

  const replaceCanvasImage = async (session: Session, value: unknown) => {
    if (
      !isRecord(value) ||
      typeof value.targetElementId !== "string" ||
      !value.targetElementId.trim() ||
      value.targetElementId.length > 128 ||
      typeof value.sourcePath !== "string" ||
      !value.sourcePath.trim()
    ) {
      throw new Error("Canvas image replacement is invalid.");
    }
    const source = await readImportableImage(session, value.sourcePath.trim());
    const { file, metadata } = createCanvasImageFileFromBytes(source.bytes);
    await requestCanvas(session, "replaceImage", {
      imageReplacement: {
        targetElementId: value.targetElementId.trim(),
        file,
        naturalWidth: metadata.width,
        naturalHeight: metadata.height
      }
    });
    return { targetElementId: value.targetElementId.trim(), fileId: file.id };
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", bridgeUrl);

      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          ok: true,
          service: "drawsy-ai-bridge",
          version: "0.1.0"
        });
        return;
      }

      if (request.method === "OPTIONS") {
        if (!requirePublicOrigin(request, response)) return;
        response.setHeader(
          "access-control-allow-methods",
          "GET,POST,PUT,DELETE,OPTIONS"
        );
        response.setHeader(
          "access-control-allow-headers",
          "authorization,content-type"
        );
        response.writeHead(204);
        response.end();
        return;
      }

      const internalCanvas = url.pathname.match(
        /^\/internal\/sessions\/([^/]+)\/canvas\/(read|apply|inspect|image|context|replace-image|preview)$/
      );
      if (request.method === "POST" && internalCanvas) {
        const session = internalSession(
          request,
          response,
          decodeURIComponent(internalCanvas[1]!)
        );
        if (!session) return;
        const action = internalCanvas[2] as
          | "read"
          | "apply"
          | "inspect"
          | "image"
          | "context"
          | "replace-image"
          | "preview";
        const body = await readJson(request);
        const parsedPreview =
          action === "preview" ? parseLivePreviewRequest(body) : null;
        if (parsedPreview && session.previewPort !== null) {
          const requestedPort = Number(new URL(parsedPreview.url).port);
          if (requestedPort !== session.previewPort) {
            throw new BridgeRequestError(
              409,
              "preview_port_mismatch",
              `This session's live preview must use port ${session.previewPort}.`
            );
          }
        }
        const result =
          action === "image"
            ? await importCanvasImage(session, body)
            : action === "replace-image"
            ? await replaceCanvasImage(session, body)
            : action === "preview"
            ? await requestCanvas(session, "preview", {
                previewRequest: parsedPreview!
              })
            : action === "context"
            ? resolveContextCaptures(session, [
                parseCanvasContextReference(
                  await requestCanvas(session, "capture", {
                    contextRequest: parseCanvasContextRequest(body)
                  })
                )
              ])[0]
            : await requestCanvas(
                session,
                action,
                action === "apply"
                  ? { operations: parseCanvasOperations(body) }
                  : undefined
              );
        json(response, 200, result);
        return;
      }

      const internalConnector = url.pathname.match(
        /^\/internal\/sessions\/([^/]+)\/connectors\/(list|search|read|query|mcp-tools|mcp-call)$/
      );
      if (request.method === "POST" && internalConnector) {
        const session = internalSession(
          request,
          response,
          decodeURIComponent(internalConnector[1]!)
        );
        if (!session) return;
        const action = internalConnector[2] as
          | "list"
          | "search"
          | "read"
          | "query"
          | "mcp-tools"
          | "mcp-call";
        const body = await readJson(request);
        if (action === "list") {
          if (Object.keys(body).length) {
            throw new BridgeRequestError(
              400,
              "connector_request_invalid",
              "The source list request must be empty."
            );
          }
          json(response, 200, {
            sources: session.activeConnectorTurn?.sources || []
          });
          return;
        }
        json(
          response,
          200,
          await executeConnectorRequest(session, action, body)
        );
        return;
      }

      const internalResource = url.pathname.match(
        /^\/internal\/sessions\/([^/]+)\/resources\/execute$/
      );
      if (request.method === "POST" && internalResource) {
        const session = internalSession(
          request,
          response,
          decodeURIComponent(internalResource[1]!)
        );
        if (!session) return;
        json(
          response,
          200,
          await executeResourceRequest(session, await readJson(request))
        );
        return;
      }

      if (!requirePublicOrigin(request, response)) return;

      if (request.method === "GET" && url.pathname === "/v1/engines") {
        json(response, 200, { engines: readLocalEngineStatus() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/preferences") {
        json(response, 200, {
          preferences: await localConversations.getPreferences()
        });
        return;
      }

      if (request.method === "PUT" && url.pathname === "/v1/preferences") {
        const preferences = await localConversations.setPreferences(
          parseLocalPreferences(await readJson(request))
        );
        json(response, 200, { preferences });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/conversations") {
        const scope = url.searchParams.get("scope");
        const canvasId = url.searchParams.get("canvasId");
        if (
          (scope !== "canvas" && scope !== "general") ||
          (scope === "canvas" && !canvasId)
        ) {
          json(response, 400, {
            error: {
              code: "conversation_scope_invalid",
              message: "Choose a valid conversation history scope."
            }
          });
          return;
        }
        if (scope === "general") {
          json(response, 200, { conversations: [] });
          return;
        }
        json(response, 200, {
          conversations: await localConversations.list(scope, canvasId)
        });
        return;
      }

      const contextAssetMatch = url.pathname.match(
        /^\/v1\/sessions\/([^/]+)\/context-assets\/([^/]+)\/(preview|source)\/([^/]+)$/
      );
      if (request.method === "POST" && contextAssetMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(contextAssetMatch[1]!)
        );
        if (!session) return;
        const asset = await storeContextAsset(session, {
          captureId: decodeURIComponent(contextAssetMatch[2]!),
          role: contextAssetMatch[3] as "preview" | "source",
          assetId: decodeURIComponent(contextAssetMatch[4]!),
          bytes: await readBytes(request)
        });
        json(response, 201, {
          id: asset.id,
          mimeType: asset.mimeType
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/folders/pick") {
        const folder = await pickFolder();
        const selection: FolderSelection = {
          id: randomUUID(),
          ...folder,
          expiresAt: Date.now() + 60 * 60 * 1000
        };
        selections.set(selection.id, selection);
        json(response, 200, {
          selectionId: selection.id,
          name: selection.name
        });
        return;
      }

      const drawDocumentMatch = url.pathname.match(
        /^\/v1\/folders\/([^/]+)\/draw-document$/
      );
      if (request.method === "GET" && drawDocumentMatch) {
        const selectionId = decodeURIComponent(drawDocumentMatch[1]!);
        const folder = selections.get(selectionId);
        if (!folder || folder.expiresAt <= Date.now()) {
          selections.delete(selectionId);
          json(response, 400, {
            error: {
              code: "folder_expired",
              message: "Choose the folder again."
            }
          });
          return;
        }
        json(response, 200, await readDrawDocument(folder));
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const body = await readJson(request);
        const selectionId =
          typeof body.selectionId === "string" ? body.selectionId : "";
        const canvasId = typeof body.canvasId === "string" ? body.canvasId : "";
        const canvasName =
          typeof body.canvasName === "string" ? body.canvasName : "Untitled";
        const conversationId =
          typeof body.conversationId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            body.conversationId
          )
            ? body.conversationId
            : null;
        const clientId =
          typeof body.clientId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            body.clientId
          )
            ? body.clientId
            : null;
        const engine = body.engine === undefined ? "codex" : body.engine;
        const surfaceKind = body.surfaceKind ?? "canvas";
        const surfaceId =
          typeof body.surfaceId === "string" && body.surfaceId.trim()
            ? body.surfaceId.trim()
            : null;
        const surfaceName =
          typeof body.surfaceName === "string" && body.surfaceName.trim()
            ? body.surfaceName.trim().slice(0, 200)
            : surfaceKind === "neutral"
            ? "Drawsy"
            : canvasName;
        if (
          (surfaceKind === "canvas" || surfaceKind === "presentation") &&
          !canvasId
        ) {
          json(response, 400, {
            error: {
              code: "canvas_required",
              message: "A current canvas is required."
            }
          });
          return;
        }
        if (
          surfaceKind !== "canvas" &&
          surfaceKind !== "presentation" &&
          surfaceKind !== "kanban" &&
          surfaceKind !== "jira" &&
          surfaceKind !== "neutral"
        ) {
          json(response, 400, {
            error: {
              code: "surface_invalid",
              message: "The Drawsy surface type is invalid."
            }
          });
          return;
        }
        const validatedSurfaceKind = surfaceKind as DrawsySurfaceKind;
        if (engine !== "codex" && engine !== "opencode") {
          json(response, 400, {
            error: {
              code: "engine_invalid",
              message: "The Drawsy agent engine is invalid."
            }
          });
          return;
        }
        if (!conversationId) {
          json(response, 400, {
            error: {
              code: "conversation_required",
              message: "A local conversation id is required."
            }
          });
          return;
        }
        const previousStart = conversationStartLocks.get(conversationId);
        let releaseStart!: () => void;
        const currentStart = new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
        const startTail = (previousStart || Promise.resolve()).then(
          () => currentStart
        );
        conversationStartLocks.set(conversationId, startTail);
        if (previousStart) await previousStart;
        try {
          const scope = canvasId ? "canvas" : "general";
          const existingConversation = await localConversations.get(
            conversationId
          );
          if (
            existingConversation &&
            (existingConversation.engine !== engine ||
              existingConversation.scope !== scope ||
              existingConversation.canvasId !== (canvasId || null))
          ) {
            json(response, 409, {
              error: {
                code: "conversation_scope_conflict",
                message:
                  "This conversation belongs to a different Drawsy scope."
              }
            });
            return;
          }
          let localConversation = await localConversations.upsert({
            id: conversationId,
            scope,
            canvasId: canvasId || null,
            canvasName: canvasId ? canvasName : null,
            engine,
            title: "New conversation",
            createdAt: existingConversation?.createdAt || Date.now(),
            updatedAt: existingConversation?.updatedAt || Date.now(),
            messageCount: existingConversation?.messageCount || 0
          });
          let hadNativeSession = Boolean(
            engine === "codex"
              ? localConversation.codexThreadId
              : localConversation.openCodeSessionId
          );
          const existingConversationSession = conversationId
            ? conversationSessions.get(conversationId)
            : null;
          if (existingConversationSession) {
            if (existingConversationSession.clientId !== clientId) {
              json(response, 409, {
                error: {
                  code: "conversation_active_elsewhere",
                  message:
                    "This chat is already open in another tab. Close it there, then retry here."
                }
              });
              return;
            }
            if (existingConversationSession.engine !== engine) {
              json(response, 409, {
                error: {
                  code: "conversation_scope_conflict",
                  message:
                    "This conversation belongs to a different Drawsy engine."
                }
              });
              return;
            }
            const requestedCanvasId = canvasId || null;
            if (existingConversationSession.canvasId !== requestedCanvasId) {
              json(response, 409, {
                error: {
                  code: "conversation_scope_conflict",
                  message:
                    "This conversation belongs to a different Drawsy canvas."
                }
              });
              return;
            }
            const matchesCurrentSurface =
              existingConversationSession.surfaceKind ===
                validatedSurfaceKind &&
              existingConversationSession.surfaceId === surfaceId;
            if (requestedCanvasId && !matchesCurrentSurface) {
              json(response, 409, {
                error: {
                  code: "conversation_scope_conflict",
                  message:
                    "This conversation belongs to a different Drawsy canvas."
                }
              });
              return;
            }
            if (matchesCurrentSurface) {
              try {
                const messages =
                  await existingConversationSession.agent.getConversationMessages();
                existingConversationSession.token =
                  randomBytes(32).toString("base64url");
                existingConversationSession.touchedAt = Date.now();
                json(response, 200, {
                  id: existingConversationSession.id,
                  token: existingConversationSession.token,
                  folderName: existingConversationSession.folder.name,
                  resumed: true,
                  conversation: localConversation,
                  messages
                });
                return;
              } catch (error) {
                console.warn(
                  "Drawsy native conversation runtime was unavailable; recreating it.",
                  error
                );
                closeSession(existingConversationSession);
              }
            }
            // General history can be resumed in a different non-canvas surface.
            // It gets a new correctly-scoped runtime while retaining its native
            // local Codex/OpenCode session identity.
            const replacementFolder = selections.get(selectionId);
            if (
              !replacementFolder ||
              replacementFolder.expiresAt <= Date.now()
            ) {
              json(response, 400, {
                error: {
                  code: "folder_expired",
                  message: "Choose the folder again."
                }
              });
              return;
            }
            closeSession(existingConversationSession);
          }
          const folder = selections.get(selectionId);
          if (!folder || folder.expiresAt <= Date.now()) {
            json(response, 400, {
              error: {
                code: "folder_expired",
                message: "Choose the folder again."
              }
            });
            return;
          }
          if (
            surfaceId &&
            (surfaceId.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(surfaceId))
          ) {
            json(response, 400, {
              error: {
                code: "surface_invalid",
                message: "The Drawsy surface id is invalid."
              }
            });
            return;
          }
          const id = randomUUID();
          const token = randomBytes(32).toString("base64url");
          const internalSecret = randomBytes(32).toString("base64url");
          let sessionRef: Session | null = null;
          let agent: CodexAppServer | OpenCodeAppServer;
          try {
            await prepareContextStore(folder.path);
            const agentOptions = {
              id,
              secret: internalSecret,
              bridgeUrl,
              surfaceKind: validatedSurfaceKind,
              surfaceId,
              surfaceName,
              isolateProcessGroup: false,
              previewPort: null
            };
            if (engine === "opencode") {
              agent = await OpenCodeAppServer.start(
                folder.path,
                {
                  ...agentOptions,
                  runtimePath: path.join(
                    localConversations.stateDirectory,
                    "opencode",
                    conversationId
                  ),
                  nativeSessionId: localConversation.openCodeSessionId
                },
                (event) => sessionRef && emit(sessionRef, event)
              );
              hadNativeSession = agent.resumed;
            } else {
              const startCodex = (nativeThreadId: string | null) =>
                CodexAppServer.start(
                  folder.path,
                  { ...agentOptions, nativeThreadId },
                  (event) => sessionRef && emit(sessionRef, event),
                  (image) => {
                    if (!sessionRef) return;
                    const savedPath =
                      image.savedPath && path.isAbsolute(image.savedPath)
                        ? path.resolve(image.savedPath)
                        : undefined;
                    const maxDataUrlLength =
                      Math.ceil((MAX_CANVAS_ASSET_BYTES * 4) / 3) + 64;
                    const result =
                      image.result?.startsWith("data:image/") &&
                      image.result.length <= maxDataUrlLength
                        ? image.result
                        : undefined;
                    if (!savedPath && !result) return;
                    sessionRef.generatedImages.push({
                      id: image.id,
                      savedPath,
                      result,
                      createdAt: Date.now()
                    });
                    if (sessionRef.generatedImages.length > 8) {
                      sessionRef.generatedImages.shift();
                    }
                  }
                );
              try {
                agent = await startCodex(localConversation.codexThreadId);
              } catch (error) {
                if (
                  !localConversation.codexThreadId ||
                !isCodexThreadMissingError(error)
                ) {
                  throw error;
                }
                localConversation = await localConversations.setNativeSession(
                  conversationId,
                  "codex",
                  null
                );
                hadNativeSession = false;
                agent = await startCodex(null);
              }
            }
          } catch (error) {
            throw error;
          }
          const session: Session = {
            id,
            conversationId,
            clientId,
            token,
            internalSecret,
            canvasId: canvasId || null,
            canvasName,
            surfaceKind: validatedSurfaceKind,
            surfaceId,
            surfaceName,
            folder,
            clients: new Set(),
            canvasPending: new Map(),
            generatedImages: [],
            contextCaptures: new Map(),
            activeConnectorTurn: null,
            activeResourceTurn: null,
            engine,
            agent,
            previewPort: null,
            touchedAt: Date.now()
          };
          sessionRef = session;
          sessions.set(id, session);
          if (conversationId) conversationSessions.set(conversationId, session);
          localConversation = await localConversations.setNativeSession(
            conversationId,
            engine,
            agent.nativeSessionId
          );
          let messages;
          try {
            messages = await agent.getConversationMessages();
          } catch (error) {
            closeSession(session);
            throw error;
          }
          json(response, 201, {
            id,
            token,
            folderName: folder.name,
            resumed: hadNativeSession,
            conversation: localConversation,
            messages
          });
          return;
        } finally {
          releaseStart();
          if (conversationStartLocks.get(conversationId) === startTail) {
            conversationStartLocks.delete(conversationId);
          }
        }
      }

      const eventsMatch = url.pathname.match(
        /^\/v1\/sessions\/([^/]+)\/events$/
      );
      if (request.method === "GET" && eventsMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(eventsMatch[1]!)
        );
        if (!session) return;
        response.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive"
        });
        session.clients.add(response);
        response.write(
          `${JSON.stringify({
            type: "session.ready",
            data: {
              folderName: session.folder.name,
              agent: session.agent.metadata
            }
          })}\n`
        );
        const heartbeat = setInterval(() => response.write("\n"), 15_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          session.clients.delete(response);
        });
        return;
      }

      const turnMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/turns$/);
      if (request.method === "POST" && turnMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(turnMatch[1]!)
        );
        if (!session) return;
        const body = await readJson(request);
        const message =
          typeof body.message === "string" ? body.message.trim() : "";
        if (!message || message.length > 20_000) {
          json(response, 400, {
            error: {
              code: "invalid_message",
              message: "Message is empty or too long."
            }
          });
          return;
        }
        const connectorTurn = parseAgentConnectorTurn(body.connectors);
        const resourceTurn = parseAgentResourceTurn(body.resources);
        session.activeConnectorTurn = connectorTurn;
        session.activeResourceTurn = resourceTurn;
        try {
          await session.agent.startTurn(
            message,
            {
              skills: parsePromptTags(body.skills, "skills"),
              plugins: parsePromptTags(body.plugins, "plugins")
            },
            resolveContextCaptures(
              session,
              parseContextReferences(body.contexts)
            ),
            connectorTurn?.sources || [],
            resourceTurn?.resources || []
          );
          if (session.conversationId) {
            await localConversations
              .recordUserMessage(session.conversationId, message)
              .catch((error) =>
                console.warn(
                  "Drawsy local conversation title could not be saved.",
                  error
                )
              );
          }
        } catch (error) {
          session.activeConnectorTurn = null;
          session.activeResourceTurn = null;
          throw error;
        }
        json(response, 202, { accepted: true });
        return;
      }

      const controlsMatch = url.pathname.match(
        /^\/v1\/sessions\/([^/]+)\/controls$/
      );
      if (request.method === "GET" && controlsMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(controlsMatch[1]!)
        );
        if (!session) return;
        json(response, 200, await session.agent.getControls());
        return;
      }

      const settingsMatch = url.pathname.match(
        /^\/v1\/sessions\/([^/]+)\/settings$/
      );
      if (request.method === "POST" && settingsMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(settingsMatch[1]!)
        );
        if (!session) return;
        const body = await readJson(request);
        const allowedKeys = new Set([
          "model",
          "modelProvider",
          "effort",
          "accessMode",
          "internetEnabled"
        ]);
        if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
          json(response, 400, {
            error: {
              code: "invalid_settings",
              message: "Unknown agent setting."
            }
          });
          return;
        }
        if (
          (body.model !== undefined && typeof body.model !== "string") ||
          (body.modelProvider !== undefined &&
            typeof body.modelProvider !== "string") ||
          (body.effort !== undefined && typeof body.effort !== "string") ||
          (body.accessMode !== undefined &&
            body.accessMode !== "workspace" &&
            body.accessMode !== "readOnly") ||
          (body.internetEnabled !== undefined &&
            typeof body.internetEnabled !== "boolean")
        ) {
          json(response, 400, {
            error: {
              code: "invalid_settings",
              message: "Invalid agent setting value."
            }
          });
          return;
        }
        const result = await session.agent.updateSettings(
          body as AgentSettingsPatch
        );
        if (session.conversationId) {
          await localConversations.setNativeSession(
            session.conversationId,
            session.engine,
            session.agent.nativeSessionId
          );
        }
        json(response, 200, result);
        return;
      }

      const providerKeyMatch = url.pathname.match(
        /^\/v1\/sessions\/([^/]+)\/provider-key$/
      );
      if (request.method === "POST" && providerKeyMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(providerKeyMatch[1]!)
        );
        if (!session) return;
        if (
          session.engine !== "opencode" ||
          !(session.agent instanceof OpenCodeAppServer)
        ) {
          json(response, 400, {
            error: {
              code: "provider_key_unsupported",
              message: "Session-only API keys are available with OpenCode."
            }
          });
          return;
        }
        const body = await readJson(request);
        const metadata = body.metadata === undefined ? {} : body.metadata;
        if (
          Object.keys(body).some(
            (key) =>
              key !== "providerId" && key !== "apiKey" && key !== "metadata"
          ) ||
          typeof body.providerId !== "string" ||
          typeof body.apiKey !== "string" ||
          !isRecord(metadata) ||
          Object.keys(metadata).length > 16 ||
          Object.entries(metadata).some(
            ([key, value]) =>
              !key ||
              key.length > 128 ||
              typeof value !== "string" ||
              value.length > 16_384
          )
        ) {
          json(response, 400, {
            error: {
              code: "provider_key_invalid",
              message:
                "A provider, API key, and valid provider fields are required."
            }
          });
          return;
        }
        json(
          response,
          200,
          await session.agent.setProviderApiKey({
            providerId: body.providerId,
            apiKey: body.apiKey,
            metadata: metadata as Record<string, string>
          })
        );
        return;
      }

      const canvasResponseMatch = url.pathname.match(
        /^\/v1\/sessions\/([^/]+)\/canvas-responses$/
      );
      if (request.method === "POST" && canvasResponseMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(canvasResponseMatch[1]!)
        );
        if (!session) return;
        const body = await readJson(request);
        const requestId =
          typeof body.requestId === "string" ? body.requestId : "";
        const pending = session.canvasPending.get(requestId);
        if (!pending) {
          json(response, 404, {
            error: {
              code: "request_not_found",
              message: "Canvas request expired."
            }
          });
          return;
        }
        session.canvasPending.delete(requestId);
        clearTimeout(pending.timer);
        if (body.ok === true) {
          pending.resolve(body.data ?? { ok: true });
        } else {
          pending.reject(
            new Error(
              typeof body.error === "string"
                ? body.error
                : "Canvas operation failed."
            )
          );
        }
        json(response, 200, { accepted: true });
        return;
      }

      const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
      if (request.method === "DELETE" && sessionMatch) {
        const session = publicSession(
          request,
          response,
          decodeURIComponent(sessionMatch[1]!)
        );
        if (!session) return;
        closeSession(session);
        response.writeHead(204);
        response.end();
        return;
      }

      json(response, 404, {
        error: { code: "not_found", message: "Route not found." }
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected bridge error.";
      const status =
        error instanceof BridgeRequestError
          ? error.status
          : message.includes("cancelled")
          ? 409
          : message.includes("MiB")
          ? 413
          : 500;
      json(response, status, {
        error: {
          code:
            error instanceof BridgeRequestError ? error.code : "bridge_error",
          message
        }
      });
    }
  });

  server.on("upgrade", (_request, socket) => socket.destroy());

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, selection] of selections) {
      if (selection.expiresAt <= now) selections.delete(id);
    }
    for (const session of sessions.values()) {
      if (now - session.touchedAt > 30 * 60 * 1000) closeSession(session);
    }
  }, 60_000);
  cleanup.unref();

  return {
    server,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(cleanup);
        for (const session of [...sessions.values()]) closeSession(session);
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    address: bridgeUrl
  };
};
