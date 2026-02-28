# Contributing to HumanRail

Thank you for your interest in contributing to HumanRail. This document explains
how to get involved and what to expect during the process.

## Licensing Context

HumanRail uses a split licensing model:

- **SDK (`sdk/` directory):** MIT licensed. Community contributions are welcome.
- **Platform (everything else):** Proprietary. Contributions to the platform
  services require prior discussion with the maintainers before submitting a PR.

If you are unsure whether your contribution falls under the SDK or the platform,
please open an issue to ask before starting work.

## Reporting Bugs

1. Search [existing issues](https://github.com/prime001/humanrail/issues) to
   check if the bug has already been reported.
2. If not, open a new issue using the **Bug Report** template.
3. Include steps to reproduce, expected behavior, actual behavior, and your
   environment details (OS, language version, SDK version).

## Requesting Features

1. Open a new issue using the **Feature Request** template.
2. Describe the problem you are trying to solve, not just the solution you have
   in mind.
3. For platform-level features, expect discussion before any implementation
   begins.

## Development Setup

Refer to the project README and `CLAUDE.md` for full setup instructions.
The short version:

```bash
# Prerequisites: Go 1.22+, Python 3.12+, Node 20+, Docker, Docker Compose
cp .env.example .env
docker compose up -d postgres redis nats
make migrate-all
make dev
```

## Pull Request Process

1. **Branch from `main`.** Use a descriptive branch name
   (e.g., `fix/task-routing-timeout`, `feat/sdk-retry-logic`).
2. **Write tests.** Every PR must include tests that cover the changed behavior.
   Unit tests are required; integration tests are strongly encouraged.
3. **Follow the code conventions** listed below.
4. **Keep PRs focused.** One logical change per pull request. Avoid mixing
   refactors with feature work.
5. **Fill out the PR template.** Describe what changed and why.
6. A maintainer will review your PR. Address feedback promptly. PRs that go
   stale for more than 14 days may be closed.

## Code Style

| Language | Tool | Command |
|----------|------|---------|
| Go | `gofmt`, `golint`, `go vet` | `make lint-go` |
| Python | `ruff` | `make lint-python` |
| TypeScript | `biome` | `make lint-ts` |

Run the appropriate linter before submitting your PR. CI will enforce these
checks automatically.

## Commit Message Format

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<optional body>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`

**Scope examples:** `gateway`, `task-engine`, `sdk-python`, `sdk-ts`, `payments`

Examples:

```
feat(sdk-python): add retry configuration to client constructor
fix(task-engine): prevent duplicate task assignment under concurrent load
docs(contributing): clarify PR review process
```

## Contributor License Agreement

By submitting a pull request, you agree that your contributions are provided
under the following terms:

- **SDK contributions** are licensed under the MIT License.
- **Platform contributions** are assigned to HumanRail and subject to the
  proprietary license.

You represent that you have the right to grant this license and that your
contribution does not violate any third-party rights.

## Questions

If you have questions about contributing, open a discussion on the
[GitHub repository](https://github.com/prime001/humanrail) or email
contact@humanrail.dev.
