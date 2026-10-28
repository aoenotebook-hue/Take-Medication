import { writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  medicationSchema,
  regimenSchema,
  profileSchema,
} from "../packages/domain/src";
import { operationSchema } from "../apps/api/src/service";
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const json = (schema: any) => ({ "application/json": { schema } });
const paths: any = {};
const add = (
  path: string,
  method: string,
  summary: string,
  request?: any,
  response?: any,
) => {
  paths[path] ||= {};
  paths[path][method] = {
    summary,
    security: [{ bearerAuth: [] }],
    ...(request
      ? { requestBody: { required: true, content: json(request) } }
      : {}),
    responses: {
      200: {
        description: "Authorized response",
        content: json(response || { type: "object" }),
      },
      401: { description: "Sign in required" },
      403: { description: "Patient or device access denied" },
      409: {
        description:
          "Optimistic concurrency conflict; authorized current version returned",
      },
      422: { description: "Field validation failed" },
      429: { description: "Rate limited" },
      503: { description: "Integration unavailable" },
    },
  };
  for (const param of path.matchAll(/\{(\w+)\}/g)) {
    paths[path][method].parameters ||= [];
    paths[path][method].parameters.push({
      in: "path",
      name: param[1],
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  }
};
add(
  "/api/patients/{id}/medications/{medicationId}/information",
  "get",
  "Read separately saved education source; needs-review after medicine identity changes",
);
add(
  "/api/patients/{id}/medications/{medicationId}/information/search",
  "post",
  "Authorized drug lookup; external requests contain only search text, never patient details",
  {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 2, maxLength: 100 },
      remote: { type: "boolean", default: false },
    },
  },
);
add(
  "/api/patients/{id}/medications/{medicationId}/information/match",
  "post",
  "Owner/editor confirms a source association; prescription fields stay unchanged",
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "identityKey", "confirmed"],
    properties: {
      id: { type: "string", pattern: "^(catalog:[a-z]+|label:[a-f0-9-]{36})$" },
      identityKey: { type: "string", maxLength: 2000 },
      confirmed: { type: "boolean", const: true },
    },
  },
);
add("/api/patients", "get", "List explicitly authorized patient profiles");
add("/api/patients", "post", "Create the one owner profile", {
  type: "object",
  required: ["displayName"],
  properties: { displayName: { type: "string" } },
});
add(
  "/api/patients/{id}/snapshot",
  "get",
  "Consistent repeatable-read snapshot for offline and UI",
);
add(
  "/api/patients/{id}/summary",
  "get",
  "The same snapshot used for screen and offline PDF",
);
add(
  "/api/sync/push",
  "post",
  "Ordered per-operation idempotent mutations; never acknowledges rejected/conflicted entries",
  {
    type: "object",
    required: ["operations"],
    properties: {
      operations: { type: "array", maxItems: 50, items: ref("Operation") },
    },
  },
  {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            status: { enum: ["acknowledged", "conflict", "rejected"] },
            version: { type: "integer" },
            current: { type: "object" },
            error: { type: "string" },
          },
        },
      },
    },
  },
);
add(
  "/api/sync/pull",
  "get",
  "Authorized monotonic change feed; client follows references with snapshots",
);
paths["/api/sync/pull"].get.parameters = [
  { in: "query", name: "cursor", schema: { type: "integer", minimum: 0 } },
];
add(
  "/api/devices",
  "get",
  "List own device bindings without endpoint/key disclosure",
);
add(
  "/api/devices/{id}",
  "delete",
  "Revoke own device and server reminder binding",
);
add(
  "/api/push/config",
  "get",
  "Public VAPID key and explicitly identified adapter",
);
add(
  "/api/push-subscriptions",
  "post",
  "Register owned browser device with separate patient reminder consent",
  {
    type: "object",
    required: ["deviceId", "patientId", "label", "consent", "subscription"],
    properties: {
      deviceId: { type: "string", format: "uuid" },
      patientId: { type: "string", format: "uuid" },
      label: { type: "string" },
      consent: { const: true },
      subscription: {
        type: "object",
        required: ["endpoint", "keys"],
        properties: {
          endpoint: { type: "string", format: "uri" },
          keys: {
            type: "object",
            required: ["p256dh", "auth"],
            properties: {
              p256dh: { type: "string" },
              auth: { type: "string" },
            },
          },
        },
      },
    },
  },
);
add("/api/push/test", "post", "Queue own device test; does not claim display", {
  type: "object",
  required: ["deviceId", "patientId"],
  properties: {
    deviceId: { type: "string", format: "uuid" },
    patientId: { type: "string", format: "uuid" },
  },
});
add(
  "/api/patients/{id}/invitations",
  "post",
  "Owner creates email-bound 48-hour single-use opaque invitation",
  {
    type: "object",
    required: ["recipient", "role"],
    properties: {
      recipient: { type: "string", format: "email" },
      role: { enum: ["viewer", "editor"] },
    },
  },
);
add(
  "/api/invitations/accept",
  "post",
  "Authenticated intended recipient explicitly agrees",
  {
    type: "object",
    required: ["token", "agreed"],
    properties: { token: { type: "string" }, agreed: { const: true } },
  },
);
add("/api/patients/{id}/memberships", "get", "Owner membership administration");
add(
  "/api/patients/{id}/memberships/{user}",
  "delete",
  "Owner revokes caregiver; downloaded offline data purges at next sync",
);
add(
  "/api/patients/{id}/memberships/{user}",
  "patch",
  "Owner changes caregiver role",
  {
    type: "object",
    required: ["role"],
    properties: { role: { enum: ["viewer", "editor"] } },
  },
);
add(
  "/api/photos/{id}",
  "get",
  "Authenticated authorized photo bytes; never a public URL",
);
paths["/api/photos/{id}"].get.responses[200] = {
  description: "Photo bytes",
  content: {
    "image/jpeg": { schema: { type: "string", contentEncoding: "binary" } },
  },
};
add(
  "/api/patients/{id}/photos",
  "post",
  "Atomic upload/validation/EXIF removal; UUID photoId makes retries idempotent",
);
paths["/api/patients/{id}/photos"].post.requestBody = {
  required: true,
  description: "JPEG/PNG/WebP up to 2 MiB after client-side compression",
  content: Object.fromEntries(
    ["image/jpeg", "image/png", "image/webp"].map((t) => [
      t,
      { schema: { type: "string", contentEncoding: "binary" } },
    ]),
  ),
};
paths["/api/patients/{id}/photos"].post.parameters.push(
  {
    name: "medicationId",
    in: "query",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  { name: "photoId", in: "query", schema: { type: "string", format: "uuid" } },
);
add(
  "/api/account/export",
  "post",
  "Owner-controlled JSON export of all owned snapshots",
);
add(
  "/api/account",
  "delete",
  "Recent authentication and DELETE confirmation; immediate tombstone and device revocation",
  {
    type: "object",
    required: ["confirm"],
    properties: { confirm: { const: "DELETE" } },
  },
);
add(
  "/api/health",
  "get",
  "Coarse database/worker health without patient information",
);
paths["/api/health"].get.security = [];
for (const [path, summary] of [
  [
    "/api/internal/reminders",
    "Protected bounded reminder batch; requires the separate scheduler secret",
  ],
  [
    "/api/internal/maintenance",
    "Protected account-retention batch; requires the separate scheduler secret",
  ],
]) {
  add(path, "post", summary);
  paths[path].post.security = [{ schedulerBearer: [] }];
}
add(
  "/api/push/observations",
  "post",
  "Own-device observed notification open or explicit test confirmation",
  {
    type: "object",
    required: ["jobId", "deviceId", "kind"],
    properties: {
      jobId: { type: "string", format: "uuid" },
      deviceId: { type: "string", format: "uuid" },
      kind: { enum: ["opened", "test-seen"] },
    },
  },
);
add(
  "/api/push/resolve/{id}",
  "get",
  "Resolve own authorized opaque notification to explicit patient selection",
);
const schemas = {
  Medication: z.toJSONSchema(medicationSchema),
  Regimen: z.toJSONSchema(regimenSchema),
  Profile: z.toJSONSchema(profileSchema),
  Operation: z.toJSONSchema(operationSchema),
};
schemas.Operation.properties!.data = {
  description:
    "kind determines data: profile=Profile; medication=Medication; regimen=Regimen; dose={occurrenceId,medicationId,action,baseEventIds,actualAt,backdateConfirmed,status}; snooze={occurrenceId,minutes:10|30}. Actor is always derived server-side.",
};
await writeFile(
  "docs/openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "My Medicine",
        version: "0.1.0",
        description:
          "Snapshot plus operation API adapts the specification route outline: profile/medication/regimen/dose/status/snooze mutations share one idempotent transaction handler.",
      },
      servers: [{ url: "http://localhost:3001" }],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          schedulerBearer: {
            type: "http",
            scheme: "bearer",
            description: "Backend-only CRON_SECRET, not a Supabase user token",
          },
        },
        schemas,
      },
    },
    null,
    2,
  ) + "\n",
);
process.exit();
