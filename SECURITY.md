# Security Policy

## Supported versions

Agent Graph is pre-1.0. Security fixes are applied to the latest published minor line.

| Version | Supported |
| --- | --- |
| 0.2.x | Yes |
| 0.1.x | No |

## Reporting a vulnerability

Do not open a public Issue for a suspected vulnerability.

Use GitHub's [private vulnerability reporting](https://github.com/context4ai/agent-graph/security/advisories/new) to send the maintainers a confidential report. Include:

- the affected version and component;
- reproduction steps or a proof of concept;
- the security impact;
- any suggested mitigation;
- whether the issue has been disclosed elsewhere.

We aim to acknowledge reports within five business days. After validation, maintainers will coordinate remediation, disclosure timing, and credit with the reporter.

## Scope

Relevant reports include unsafe file access, command execution, path traversal, integrity failures, trust-boundary bypasses, and vulnerabilities in the published CLI, SDK, schemas, or build artifacts.

General support questions and non-security bugs should use GitHub Discussions or Issues.
