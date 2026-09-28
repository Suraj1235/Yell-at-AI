# Security Policy

## Supported Versions

Security fixes target the latest released version while the project is pre-1.0.

## Reporting

Please report vulnerabilities privately to the maintainers before public disclosure. Use GitHub's
private vulnerability reporting: open **"Report a vulnerability"** from the repo's Security tab, or go
directly to https://github.com/Suraj1235/Yell-at-AI/security/advisories/new.

Include:

- affected version or commit
- operating system
- reproduction steps
- whether audio, transcript, or local file access is involved

## Security Principles

- no default network egress from the core engine
- no hidden audio recording
- no persistent debug audio unless explicitly enabled
- visible and editable vocal-context output
- local-only calibration data
