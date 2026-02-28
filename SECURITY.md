# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous minor release | Yes |
| Older versions | No |

We recommend always running the latest version to benefit from security patches.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities by email:

**security@humanrail.dev**

Include the following in your report:

- A description of the vulnerability and its potential impact.
- Steps to reproduce the issue or a proof of concept.
- The affected component(s) and version(s), if known.
- Your contact information for follow-up.

## What to Expect

- **Acknowledgment:** We will confirm receipt of your report within 48 hours.
- **Assessment:** We will evaluate the severity and determine a fix timeline,
  typically within 7 business days of acknowledgment.
- **Resolution:** Critical vulnerabilities will be patched as quickly as
  possible. We will coordinate disclosure timing with you.
- **Credit:** With your permission, we will credit you in the release notes
  for the fix.

## Bug Bounty

A formal bug bounty program is coming soon. In the meantime, we appreciate
responsible disclosure and will recognize contributors who report valid
security issues.

## Scope

The following are in scope for security reports:

- HumanRail API services (gateway, task-engine, verification, payments)
- SDK client libraries (Python, TypeScript, Go)
- Worker application
- Authentication and authorization flows
- Payment processing and Lightning integration

The following are out of scope:

- Denial-of-service attacks against production infrastructure.
- Social engineering of HumanRail staff or users.
- Issues in third-party dependencies (report these upstream; let us know if
  they affect HumanRail specifically).

## Contact

For security matters: security@humanrail.dev
For general inquiries: contact@humanrail.dev
