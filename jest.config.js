/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['*.js', '!jest.config.js'],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
};
