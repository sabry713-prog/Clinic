import { Module } from "@nestjs/common";
import { ChecklistController } from "./checklist.controller";
import { ChecklistService } from "./checklist.service";
import { PatientModule } from "../patient/patient.module";

@Module({
  imports: [PatientModule],
  controllers: [ChecklistController],
  providers: [ChecklistService],
})
export class ChecklistModule {}
