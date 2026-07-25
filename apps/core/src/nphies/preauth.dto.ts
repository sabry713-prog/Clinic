import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Body for POST /patients/:id/nphies/pre-auth.
 *
 * Codes are passed through to the FHIR bundle verbatim -- this layer never
 * infers, maps, or substitutes a code (CLAUDE.md §1). The caller sends the
 * clinician-confirmed ICD-10-AM and SBS codes it already holds.
 */
export class SubmitPreAuthDto {
  @IsString()
  @MaxLength(100)
  encounter_id!: string;

  @IsString()
  @MaxLength(100)
  order_id!: string;

  @IsString()
  @MaxLength(20)
  icd10_code!: string;

  @IsString()
  @MaxLength(40)
  sbs_code!: string;

  /** Draft SOAP note attached to the claim as the clinical justification. */
  @IsString()
  @MaxLength(20000)
  clinical_document!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  patient_civil_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  payer_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  icd10_display?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sbs_display?: string;
}
