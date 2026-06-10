import { IsString, IsOptional, Length, Matches } from "class-validator";

export class AskQuestionDto {
  @IsString()
  @Length(1, 2000)
  question!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(en|ar)$/, { message: "language must be 'en' or 'ar'" })
  language?: string;

  @IsOptional()
  @IsString()
  conversation_id?: string;
}
