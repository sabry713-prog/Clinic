// Must be first import so OTel patches happen before any other requires
import "./tracing";

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Pino structured logger
  app.useLogger(app.get(Logger));

  // CORS -- allow the React dev server (port 3000) to call the API with cookies
  app.enableCors({
    origin: process.env["WEB_URL"] ?? "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });

  // Cookie parser (for session_id cookie)
  app.use(cookieParser());

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix("api/v1");

  // Swagger docs
  const config = new DocumentBuilder()
    .setTitle("Clinical Copilot Core API")
    .setDescription("Hospital-grade clinical AI backend")
    .setVersion("0.1.0")
    .addCookieAuth("session_id")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = parseInt(process.env["CORE_PORT"] ?? "4000", 10);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(
    { event: "server_started", port, service: "clinical-copilot-core" },
    "AppBootstrap",
  );
}

void bootstrap();
