import type { Config } from "jest";
const config: Config = { preset: "ts-jest/presets/default-esm", testEnvironment: "node", extensionsToTreatAsEsm: [".ts"], moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" }, globalSetup: "<rootDir>/tests/helpers/postgres-integration.global-setup.mjs" };
export default config;
