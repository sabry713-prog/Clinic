import { Module } from "@nestjs/common";
import { ClaimIntegrityController } from "./claim-integrity.controller";
import { ClaimSimulatorService } from "./claim-simulator.service";
import { CoderQueueService } from "./coder-queue.service";
import { NphiesModule } from "../nphies/nphies.module";
import { AuthModule } from "../auth/auth.module";

/**
 * Claim-integrity bounded context (E3): the claim simulator ("check before
 * you send") and the RCM coder review queue. Administrative surface only —
 * reuses NphiesModule's deterministic readiness checks; adds no clinical
 * features (CLAUDE.md §2). Loaded in BOTH deployment profiles: it is part of
 * the claim-integrity product surface and an admin tool under the clinical
 * profile.
 */
@Module({
  imports: [NphiesModule, AuthModule],
  controllers: [ClaimIntegrityController],
  providers: [ClaimSimulatorService, CoderQueueService],
})
export class ClaimIntegrityModule {}
