import { Module } from "@nestjs/common";
import { HandoffController } from "./handoff.controller";
import { HandoffService } from "./handoff.service";
import { RbacModule } from "../rbac/rbac.module";

@Module({
  imports: [RbacModule],
  controllers: [HandoffController],
  providers: [HandoffService],
  exports: [HandoffService],
})
export class HandoffModule {}
