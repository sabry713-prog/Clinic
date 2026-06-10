import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@clinical-copilot/shared-types$":
      "<rootDir>/../../packages/shared-types/src/index.ts",
    "^@clinical-copilot/audit$":
      "<rootDir>/../../packages/audit/src/index.ts",
    "^@clinical-copilot/fhir-client$":
      "<rootDir>/../../packages/fhir-client/src/index.ts",
  },
};

export default config;
