import { Injectable, Logger } from "@nestjs/common";
import { IngestionService } from "./ingestion.service";

/**
 * Scheduled ingestion runner.
 *
 * NestJS @nestjs/schedule is not included in Slice 0 deps, so we use
 * a plain setInterval approach that is safe for a single-instance deployment.
 * The interval is every 15 minutes (900_000 ms).
 *
 * In a multi-instance deployment, the ingestion lock should be handled via
 * a PostgreSQL advisory lock -- deferred to Slice 2.
 */
@Injectable()
export class IngestionScheduler {
  private readonly logger = new Logger(IngestionScheduler.name);
  private readonly intervalMs = 15 * 60 * 1_000; // 15 minutes
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly ingestionService: IngestionService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.running) {
        this.logger.warn({ event: "ingestion_skipped_still_running" });
        return;
      }
      this.running = true;
      this.ingestionService
        .runIngestion()
        .catch((err: unknown) => {
          this.logger.error({ event: "ingestion_schedule_error", err });
        })
        .finally(() => {
          this.running = false;
        });
    }, this.intervalMs);

    this.logger.log({
      event: "ingestion_scheduler_started",
      interval_ms: this.intervalMs,
    });
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
