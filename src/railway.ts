import {
  getPlaudRailwayEnvironmentId,
  getPlaudRailwayProjectId,
  getPlaudRailwayProjectToken,
  getPlaudRailwayServiceId,
} from "./process-env.js";

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

type RailwayGraphqlResponse<T> = {
  readonly data?: T;
  readonly errors?: ReadonlyArray<{
    readonly message?: string;
  }>;
};

type ServiceInstanceRedeployResponse = {
  readonly serviceInstanceRedeploy: boolean;
};

export async function triggerPlaudTranscriberRun(): Promise<void> {
  const response = await fetch(RAILWAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getPlaudRailwayProjectToken()}`,
    },
    body: JSON.stringify({
      query: `
        mutation ServiceInstanceRedeploy($environmentId: String!, $serviceId: String!) {
          serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId)
        }
      `,
      variables: {
        projectId: getPlaudRailwayProjectId(),
        environmentId: getPlaudRailwayEnvironmentId(),
        serviceId: getPlaudRailwayServiceId(),
      },
      operationName: "ServiceInstanceRedeploy",
    }),
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Railway trigger failed with status ${response.status.toString()}: ${rawText}`);
  }

  const parsed = parseRailwayResponse(rawText);

  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    const errorMessage = parsed.errors.map((error) => error.message ?? "Unknown Railway API error.").join(" ");
    throw new Error(`Railway trigger failed: ${errorMessage}`);
  }

  if (parsed.data?.serviceInstanceRedeploy !== true) {
    throw new Error("Railway trigger was not accepted.");
  }
}

function parseRailwayResponse(rawText: string): RailwayGraphqlResponse<ServiceInstanceRedeployResponse> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Railway trigger returned invalid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Railway trigger returned an invalid response shape.");
  }

  const data = parsed["data"];
  const errors = parsed["errors"];

  if (data !== undefined) {
    if (!isRecord(data) || typeof data["serviceInstanceRedeploy"] !== "boolean") {
      throw new Error("Railway trigger response data was invalid.");
    }
  }

  if (errors !== undefined) {
    if (!Array.isArray(errors) || errors.some((error) => !isRecord(error))) {
      throw new Error("Railway trigger response errors were invalid.");
    }
  }

  const result: {
    data?: ServiceInstanceRedeployResponse;
    errors?: ReadonlyArray<{
      readonly message?: string;
    }>;
  } = {};

  if (data !== undefined) {
    const serviceInstanceRedeploy = data["serviceInstanceRedeploy"];

    if (typeof serviceInstanceRedeploy !== "boolean") {
      throw new Error("Railway trigger response data was invalid.");
    }

    result.data = { serviceInstanceRedeploy };
  }

  if (errors !== undefined) {
    result.errors = errors.map((error) => {
      const message = getErrorMessage(error);

      if (message === null) {
        return {};
      }

      return { message };
    });
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const message = value["message"];
  return typeof message === "string" ? message : null;
}
