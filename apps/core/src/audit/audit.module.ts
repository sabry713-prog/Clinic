import { Module } from "@nestjs/common";
import { AuditMiddleware } from "./audit.middleware";

@Module({
  providers: [AuditMiddleware],
  exports: [AuditMiddleware],
})
export class AuditModule {}
