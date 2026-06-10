import { Module } from "@nestjs/common";
import { IngestionService } from "./ingestion.service";
import { IngestionScheduler } from "./ingestion.scheduler";
import { IngestionController } from "./ingestion.controller";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  providers: [IngestionService, IngestionScheduler],
  controllers: [IngestionController],
  exports: [IngestionService],
})
export class IngestionModule {}
