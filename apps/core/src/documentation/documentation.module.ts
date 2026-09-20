import { Module } from "@nestjs/common";
import { DocumentationController } from "./documentation.controller";
import { DocumentationService } from "./documentation.service";
import { PatientModule } from "../patient/patient.module";

@Module({
  imports: [PatientModule],
  controllers: [DocumentationController],
  providers: [DocumentationService],
})
export class DocumentationModule {}
