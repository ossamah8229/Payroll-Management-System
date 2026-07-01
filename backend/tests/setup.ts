// Integration tests in this suite talk to a real Postgres instance (per
// docs/architecture/tech-stack.md's testing philosophy — correctness over mocking the database),
// so allow more time than Jest's 5s default for connection setup + queries.
jest.setTimeout(15000);
