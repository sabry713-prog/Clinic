import { Module } from "@nestjs/common";
import { QAProxyController, ConversationController } from "./qa-proxy.controller";
import { QAProxyService } from "./qa-proxy.service";
import { PatientModule } from "../patient/patient.module";
import { DatabaseModule } from "../database/database.module";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [DatabaseModule, PatientModule, RbacModule],
  controllers: [QAProxyController, ConversationController],
  providers: [QAProxyService],
  exports: [QAProxyService],
})
export class QAProxyModule {}
