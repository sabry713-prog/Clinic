import { Module } from "@nestjs/common";
import { AuditMiddleware } from "./audit.middleware";
import { AuditOutboxService } from "./audit-outbox.service";

@Module({
  providers: [AuditMiddleware, AuditOutboxService],
  exports: [AuditMiddleware, AuditOutboxService],
})
export class AuditModule {}
