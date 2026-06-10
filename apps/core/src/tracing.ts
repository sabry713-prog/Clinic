import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  serviceName: process.env["OTEL_SERVICE_NAME"] ?? "clinical-copilot-core",
  traceExporter: new OTLPTraceExporter({
    url:
      (process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318") +
      "/v1/traces",
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on("SIGTERM", () => {
  sdk.shutdown().finally(() => process.exit(0));
});
