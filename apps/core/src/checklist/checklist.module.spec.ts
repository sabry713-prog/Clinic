import { Test } from "@nestjs/testing";
import { ChecklistModule } from "./checklist.module";

/**
 * A module that compiles is not a module that boots.
 *
 * Nest resolves the dependency graph at runtime, so an import the guards need but the module does not
 * declare fails at startup — with the build green, the service tests green, and the API simply not
 * listening. This is not hypothetical: ChecklistModule was added without RbacModule/AuthModule and did exactly
 * that. Compiling the module is the cheapest check that catches it.
 */
describe("ChecklistModule (boots)", () => {
  it("resolves its dependency graph", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ChecklistModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
