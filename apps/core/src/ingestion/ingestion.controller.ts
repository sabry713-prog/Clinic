import {
  Controller,
  Post,
  HttpCode,
  Req,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IngestionService, type IngestionRunResult } from "./ingestion.service";
import { SessionService } from "../auth/session.service";

@ApiTags("admin")
@Controller("admin/ingestion")
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly sessionService: SessionService,
  ) {}

  @Post("trigger")
  @HttpCode(202)
  @ApiOperation({ summary: "Manually trigger an ingestion run (admin only)" })
  async trigger(@Req() req: Request): Promise<{ run_id: string; message: string }> {
    const sessionId = req.cookies["session_id"] as string | undefined;
    if (!sessionId) throw new ForbiddenException("Unauthenticated");

    const session = this.sessionService.get(sessionId);
    if (!session) throw new ForbiddenException("Session expired");

    const isAdmin =
      session.roles.includes("hospital_admin") ||
      session.roles.includes("sysadmin");

    if (!isAdmin) {
      throw new ForbiddenException("Admin role required for manual ingestion trigger");
    }

    this.logger.log({
      event: "ingestion_manual_trigger",
      user_id: session.userId,
    });

    // Start async — respond immediately with run ID
    let runIdCapture = "";
    this.ingestionService
      .runIngestion()
      .then((result: IngestionRunResult) => {
        this.logger.log({
          event: "manual_ingestion_completed",
          run_id: result.runId,
          status: result.status,
        });
      })
      .catch((err: unknown) => {
        this.logger.error({ event: "manual_ingestion_error", err });
      });

    // We can't easily get the run_id here since it's generated inside the service.
    // Return a placeholder — in production use a job queue with pre-assigned IDs.
    void runIdCapture;
    return { run_id: "pending", message: "Ingestion run started" };
  }
}
