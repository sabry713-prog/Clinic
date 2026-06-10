import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { DevSessionController } from "./dev-session.controller";

@Module({
  controllers: [AuthController, DevSessionController],
  providers: [AuthService, SessionService],
  exports: [SessionService],
})
export class AuthModule {}
