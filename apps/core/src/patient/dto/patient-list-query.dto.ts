import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export class PatientListQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Free-text search on display_name or MRN */
  @IsOptional()
  @IsString()
  q?: string;

  /** Filter by ward name */
  @IsOptional()
  @IsString()
  ward?: string;
}
