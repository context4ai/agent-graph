import { AgentGraphError } from "./errors.js";
import { digestValue } from "./io.js";
import { validateSchema } from "./schema.js";
import type {
  HostActionResult,
  ResourceLocation,
  ResourceLocationV2,
  ResourceReadReceipt,
} from "./types.js";

function hostLocation(location: ResourceLocation): ResourceLocationV2 {
  if (location.schema !== "agent-graph.resource-location.v2") {
    throw new AgentGraphError(
      "host-action-location-invalid",
      `Resource ${location.id} is not a resource-location.v2 host action`,
    );
  }
  return location;
}

export function hostActionInputDigest(location: ResourceLocation): string {
  const expected = hostLocation(location);
  return digestValue({
    handler: expected.materialize.handler,
    input: expected.materialize.input,
  });
}

export function hostActionOutputDigest(result: HostActionResult): string {
  return "inline" in result.output
    ? digestValue(result.output.inline)
    : result.output.resource.digest;
}

export async function validateHostActionResult(
  location: ResourceLocation,
  result: HostActionResult,
): Promise<void> {
  const expected = hostLocation(location);
  await validateSchema("host-action-result", result, "host-action-result");
  if (result.handler !== expected.materialize.handler) {
    throw new AgentGraphError(
      "host-action-handler-mismatch",
      `Expected host handler ${expected.materialize.handler}, received ${result.handler}`,
    );
  }
  const expectedInputDigest = hostActionInputDigest(expected);
  if (result.input_digest !== expectedInputDigest) {
    throw new AgentGraphError(
      "host-action-input-stale",
      `Host result input digest ${result.input_digest} does not match current input ${expectedInputDigest}`,
    );
  }
  if (result.output.schema !== expected.materialize.output_schema) {
    throw new AgentGraphError(
      "host-action-output-schema-mismatch",
      `Expected output schema ${expected.materialize.output_schema}, received ${result.output.schema}`,
    );
  }
}

export async function hostActionResourceReadReceipt(
  location: ResourceLocation,
  result: HostActionResult,
): Promise<ResourceReadReceipt> {
  const expected = hostLocation(location);
  await validateHostActionResult(expected, result);
  return {
    id: expected.id,
    digest: hostActionOutputDigest(result),
    ...(expected.revision ? { revision: expected.revision } : {}),
  };
}
