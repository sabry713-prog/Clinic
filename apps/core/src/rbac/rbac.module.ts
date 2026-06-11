import { Module } from "@nestjs/common";
import { RbacGuard } from "./rbac.guard";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  providers: [RbacGuard],
  exports: [RbacGuard, AuthModule],
})
export class RbacModule {}
