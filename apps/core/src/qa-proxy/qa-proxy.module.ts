import { Module } from "@nestjs/common";
import { QAProxyController, ConversationController } from "./qa-proxy.controller";
import { QAProxyService } from "./qa-proxy.service";
import { PatientModule } from "../patient/patient.module";
import { DatabaseModule } from "../database/database.module";

@Module({
  imports: [DatabaseModule, PatientModule],
  controllers: [QAProxyController, ConversationController],
  providers: [QAProxyService],
  exports: [QAProxyService],
})
export class QAProxyModule {}
