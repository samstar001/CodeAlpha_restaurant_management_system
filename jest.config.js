export default {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  transform: {}, // no Babel: run native ES Modules
  setupFiles: ["<rootDir>/tests/setup.js"],
};
