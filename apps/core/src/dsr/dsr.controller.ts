/**
 * DSR endpoints
 *
 * POST /api/v1/dsr/access -- access request
 * POST /api/v1/dsr/erase  -- erasure request
 * GET  /api/v1/dsr/:id    -- status check
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  HttpCode,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";
import type { Request } from "express";
import { DsrService } from "./dsr.service";
import { v4 as uuidv4 } from "uuid";
import type { RequestId } from "@clinical-copilot/shared-types";

class DsrAccessDto {
  @IsString()
  @MinLength(1)
  subject_id!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}

class DsrEraseDto {
  @IsString()
  @MinLength(1)
  subject_id!: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}

@ApiTags("dsr")
@Controller("dsr")
export class DsrController {
  constructor(private readonly dsrService: DsrService) {}

  @Post("access")
  @HttpCode(201)
  @ApiOperation({ summary: "Submit a data access request" })
  async access(@Req() req: Request, @Body() body: DsrAccessDto) {
    const requestId = uuidv4() as RequestId;
    const actorId = req.authenticatedUserId ?? null;
    const actorRole = req.authenticatedUserRole ?? null;
    return this.dsrService.createAccess(body.subject_id, body.reason, actorId, actorRole as string | null, requestId);
  }

  @Post("erase")
  @HttpCode(201)
  @ApiOperation({ summary: "Submit a data erasure request" })
  async erase(@Req() req: Request, @Body() body: DsrEraseDto) {
    const requestId = uuidv4() as RequestId;
    const actorId = req.authenticatedUserId ?? null;
    const actorRole = req.authenticatedUserRole ?? null;
    const result = await this.dsrService.createErase(body.subject_id, body.reason, actorId, actorRole as string | null, requestId);
    return {
      ...result,
      note: "Erasure request received. Processing is subject to medical record retention requirements.",
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get DSR request status" })
  async getStatus(@Param("id") id: string) {
    return this.dsrService.getStatus(id);
  }
}
