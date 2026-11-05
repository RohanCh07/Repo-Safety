# Test fixtures

- `malicious-like/`: harmless samples that **imitate** trap patterns. They must only ever use harmless commands such as `echo hello`. Never add real malware.
- `benign/`: normal project layouts that must produce no findings.

One folder per case, named after the rule it tests.
