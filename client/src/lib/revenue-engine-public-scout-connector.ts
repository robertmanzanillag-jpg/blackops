export type RevenuePublicScoutConnectorContext = {
  activeScoutArea: string;
  activeScoutNiche: string;
  missionId: string;
  sourceTaskId: string;
  connectorName: string;
  connectorRunId: string;
};

export const publicScoutConnectorIntakeEndpoint = "/api/revenue-engine/public-scout-connector-intake";

type ConnectorPayloadObject = {
  area?: unknown;
  niche?: unknown;
  missionId?: unknown;
  sourceTaskId?: unknown;
  connectorName?: unknown;
  connectorRunId?: unknown;
  results?: unknown;
  notes?: unknown;
};

function valueOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function buildPublicScoutConnectorIntakePayload(rawJson: string, context: RevenuePublicScoutConnectorContext) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("JSON del connector invalido");
  }

  const payload = Array.isArray(parsed) ? null : parsed && typeof parsed === "object" ? parsed as ConnectorPayloadObject : null;
  const results = Array.isArray(parsed) ? parsed : payload?.results;
  if (!Array.isArray(results)) {
    throw new Error("El connector debe enviar un array de resultados o el payload completo con results[]");
  }

  return {
    area: valueOrFallback(payload?.area, context.activeScoutArea),
    niche: valueOrFallback(payload?.niche, context.activeScoutNiche),
    missionId: valueOrFallback(payload?.missionId, context.missionId),
    sourceTaskId: valueOrFallback(payload?.sourceTaskId, context.sourceTaskId),
    connectorName: valueOrFallback(payload?.connectorName, context.connectorName),
    connectorRunId: valueOrFallback(payload?.connectorRunId, context.connectorRunId),
    results,
    notes: valueOrFallback(payload?.notes, "Recorded from Revenue Engine verified connector intake UI."),
  };
}

export function buildPublicScoutConnectorIntakeRequest(rawJson: string, context: RevenuePublicScoutConnectorContext) {
  return {
    endpoint: publicScoutConnectorIntakeEndpoint,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPublicScoutConnectorIntakePayload(rawJson, context)),
    },
  };
}
