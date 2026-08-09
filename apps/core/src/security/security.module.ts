import { Module } from "@nestjs/common";
import { EncryptionService } from "./encryption.service";
import { LocalKeyProviderService } from "./local-key-provider.service";
import { CustomerKeyProviderService } from "./customer-key-provider.service";

@Module({
  providers: [EncryptionService, LocalKeyProviderService, CustomerKeyProviderService],
  exports: [EncryptionService],
})
export class SecurityModule {}
