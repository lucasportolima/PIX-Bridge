/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce scope to clearly identify what part of the system changed
    'scope-enum': [
      2,
      'always',
      [
        'bank-a',      // NestJS backend / Bank A
        'bank-b',      // FastAPI backend / Bank B
        'infra',       // Docker, Kafka, MongoDB, Postgres configs
        'ci',          // CI/CD pipeline
        'docs',        // Documentation (RFC, PRD, README)
        'deps',        // Dependency updates
        'release',     // Version bumps
      ],
    ],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
