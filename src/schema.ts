import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import actionSchema from "../schemas/action.schema.json" with { type: "json" };
import bundleSchema from "../schemas/bundle.schema.json" with { type: "json" };
import codeCatalogSchema from "../schemas/code-catalog.schema.json" with { type: "json" };
import codeLocationSchema from "../schemas/code-location.schema.json" with { type: "json" };
import errorSchema from "../schemas/error.schema.json" with { type: "json" };
import evaluationSchema from "../schemas/evaluation.schema.json" with { type: "json" };
import graphSchema from "../schemas/graph.schema.json" with { type: "json" };
import hostActionResultSchema from "../schemas/host-action-result.schema.json" with { type: "json" };
import providerSchema from "../schemas/provider.schema.json" with { type: "json" };
import resourceSchema from "../schemas/resource.schema.json" with { type: "json" };
import resourceLocationSchema from "../schemas/resource-location.schema.json" with { type: "json" };
import resourceReadReceiptsSchema from "../schemas/resource-read-receipts.schema.json" with { type: "json" };
import routeSchema from "../schemas/route.schema.json" with { type: "json" };
import runSchema from "../schemas/run.schema.json" with { type: "json" };
import skillBindingSchema from "../schemas/skill-binding.schema.json" with { type: "json" };
import testCaseSchema from "../schemas/test-case.schema.json" with { type: "json" };
import { AgentGraphError } from "./errors.js";
import type { Diagnostic } from "./types.js";

export type SchemaName =
  | "provider"
  | "graph"
  | "host-action-result"
  | "action"
  | "resource"
  | "run"
  | "test-case"
  | "bundle"
  | "code-catalog"
  | "code-location"
  | "error"
  | "evaluation"
  | "route"
  | "resource-location"
  | "resource-read-receipts"
  | "skill-binding";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const schemaRoot = resolve(moduleDir, "../schemas");
const validators = new Map<SchemaName, ValidateFunction>();
const addFormats = addFormatsModule as unknown as FormatsPlugin;
const schemas: Record<SchemaName, object> = {
  action: actionSchema,
  bundle: bundleSchema,
  "code-catalog": codeCatalogSchema,
  "code-location": codeLocationSchema,
  error: errorSchema,
  evaluation: evaluationSchema,
  graph: graphSchema,
  "host-action-result": hostActionResultSchema,
  provider: providerSchema,
  resource: resourceSchema,
  "resource-location": resourceLocationSchema,
  "resource-read-receipts": resourceReadReceiptsSchema,
  route: routeSchema,
  run: runSchema,
  "skill-binding": skillBindingSchema,
  "test-case": testCaseSchema,
};

function diagnosticsFor(errors: ErrorObject[] | null | undefined, path: string): Diagnostic[] {
  return (errors ?? []).map((error) => ({
    code: `schema.${error.keyword}`,
    severity: "error",
    message: `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    path,
    detail: {
      schemaPath: error.schemaPath,
      params: error.params as Record<string, never>,
    },
  }));
}

function isSchemaName(name: string): name is SchemaName {
  return Object.hasOwn(schemas, name);
}

async function validatorFor(name: string): Promise<ValidateFunction> {
  if (!isSchemaName(name)) throw new AgentGraphError("schema-type-unknown", `Unknown schema type: ${name}`);
  const cached = validators.get(name);
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  const id = (schemas[name] as { $id: string }).$id;
  const validator = ajv.getSchema(id);
  if (!validator) throw new AgentGraphError("schema-compile-failed", `Cannot compile schema type: ${name}`);
  validators.set(name, validator);
  return validator;
}

export async function validateSchema(name: string, value: unknown, path: string): Promise<void> {
  const validator = await validatorFor(name);
  if (validator(value)) return;
  const diagnostics = diagnosticsFor(validator.errors, path);
  throw new AgentGraphError("schema-invalid", `${path} does not match ${name}.schema.json`, diagnostics);
}

function compileSchemaDocument(schema: object, path: string): ValidateFunction {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
    addFormats(ajv);
    return ajv.compile(schema);
  } catch (error) {
    throw new AgentGraphError(
      "schema-compile-failed",
      `Cannot compile referenced schema ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function schemaProtocolIdentity(schema: object, path: string): string {
  const document = schema as {
    $id?: unknown;
    properties?: { schema?: { const?: unknown } };
  };
  const protocol = document.properties?.schema?.const;
  const identity = typeof protocol === "string" && protocol.length > 0
    ? protocol
    : typeof document.$id === "string" && document.$id.length > 0
      ? document.$id
      : undefined;
  if (!identity) {
    throw new AgentGraphError(
      "schema-protocol-id-missing",
      `Referenced schema ${path} must declare properties.schema.const or $id`,
    );
  }
  if (!/(?:[./]v[1-9][0-9]*)$/.test(identity)) {
    throw new AgentGraphError(
      "schema-protocol-id-unversioned",
      `Referenced schema ${path} identity must end in /vN or .vN: ${identity}`,
    );
  }
  return identity;
}

export function assertSchemaDocument(schema: object, path: string): void {
  compileSchemaDocument(schema, path);
  schemaProtocolIdentity(schema, path);
}

export function validateSchemaDocument(schema: object, value: unknown, path: string): void {
  const validator = compileSchemaDocument(schema, path);
  if (validator(value)) return;
  const diagnostics = diagnosticsFor(validator.errors, path);
  throw new AgentGraphError("schema-invalid", `${path} does not match its referenced schema`, diagnostics);
}

export function publicSchemaRoot(): string {
  return schemaRoot;
}

export function schemaTypes(): SchemaName[] {
  return Object.keys(schemas).sort() as SchemaName[];
}

export function schemaPath(name: string): string {
  if (!isSchemaName(name)) throw new AgentGraphError("schema-type-unknown", `Unknown schema type: ${name}`);
  return resolve(schemaRoot, `${name}.schema.json`);
}

export function schemaDocument(name: string): object {
  if (!isSchemaName(name)) throw new AgentGraphError("schema-type-unknown", `Unknown schema type: ${name}`);
  return structuredClone(schemas[name]);
}
