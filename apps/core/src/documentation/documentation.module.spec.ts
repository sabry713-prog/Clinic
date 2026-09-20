import { Test } from "@nestjs/testing";
import { DocumentationModule } from "./documentation.module";

/**
 * A module that compiles is not a module that boots.
 *
 * Nest resolves the dependency graph at runtime, so an import the guards need but the module does not
 * declare fails at startup — with the build green, the service tests green, and the API simply not
 * listening. This is not hypothetical: DocumentationModule was added without RbacModule/AuthModule and did exactly
 * that. Compiling the module is the cheapest check that catches it.
 */
describe("DocumentationModule (boots)", () => {
  it("resolves its dependency graph", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DocumentationModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
