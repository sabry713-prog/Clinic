import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { RedisModule } from "../redis/redis.module";
import { DocumentationModule } from "./documentation.module";

/**
 * A module that compiles is not a module that boots.
 *
 * Nest resolves the dependency graph at runtime, so an import the guards need but the module does not
 * declare fails at startup — with the build green, the service tests green, and the API simply not
 * listening. This is not hypothetical: DocumentationModule was added without RbacModule/AuthModule and did exactly
 * that. Compiling the module is the cheapest check that catches it.
 */
// The app supplies these at the root: ConfigModule.forRoot() in AppModule, and RedisModule. A
// feature module booted on its own needs them, or it fails on dependencies the app always provides
// -- which made this guard fail for every module rather than only for one that forgot an import.
process.env.DATABASE_URL ??= "postgres://app@127.0.0.1:5432/clinical_copilot";

describe("DocumentationModule (boots)", () => {
  it("resolves its dependency graph", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), RedisModule, DocumentationModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
