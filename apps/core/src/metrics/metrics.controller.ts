import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";
import { metricsRegistry } from "./metrics.registry";

/**
 * Exposes GET /metrics for Prometheus scraping.
 *
 * Security: this endpoint is protected at the K8s NetworkPolicy level —
 * only the Prometheus pod within the cluster can reach it. It intentionally
 * has no authentication middleware applied so the scrape can succeed without
 * a service-account token.
 *
 * In production, ensure the Kubernetes NetworkPolicy restricts ingress on
 * this path to the prometheus namespace only.
 */
@Controller()
export class MetricsController {
  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async metrics(@Res() res: Response): Promise<void> {
    const output = await metricsRegistry.metrics();
    res.send(output);
  }
}
