import { IsOptional, IsString } from "class-validator";

export class MedicationsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}
