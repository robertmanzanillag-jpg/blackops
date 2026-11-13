import "../server/env-loader";
import { buildMetricoolMcpClientConfig, getMetricoolConfigStatus, getMetricoolTrackingPlan } from "../server/metricool-tracking";

const status = getMetricoolConfigStatus();
const plan = getMetricoolTrackingPlan();

const output = {
  status,
  plan: {
    brandCount: plan.brandCount,
    socialProfileCount: plan.socialProfileCount,
    networks: plan.networks,
    recommendedPlan: plan.recommendedPlan,
    directPlatformApisNeeded: plan.directPlatformApisNeeded,
    optionalDirectPlatformApis: plan.optionalDirectPlatformApis,
    brands: plan.brands.map((brand) => ({
      id: brand.id,
      name: brand.name,
      networks: brand.networks,
      status: brand.status,
      ownerAgent: brand.ownerAgent,
    })),
    setupActions: plan.setupActions,
  },
  mcpClientConfigTemplate: buildMetricoolMcpClientConfig(),
};

console.log(JSON.stringify(output, null, 2));
