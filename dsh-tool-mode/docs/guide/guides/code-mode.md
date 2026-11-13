---
title: Code Mode
description: Run a bounded program that chains Tool Mode tools.
---

# Code Mode

Code Mode lets a single tool call run a small program that calls other tools and
returns the program's result. The tool is `tool_mode_run`.

It is **advanced and conditional**. It is not the default way to use Tool Mode.

## What it does

A Code Mode call receives a program description, the tools it may call, and a
result shape. The runner:

- executes a bounded program;
- records an ordered sub-call trace;
- returns the result plus trace metadata.

The trace shows each sub-call, whether it succeeded, how long it took, and a
bounded preview. It is provenance, not a full data dump.

## Why it is off by default

Code execution is a separate consent from ordinary model-tool access. Two
independent conditions must hold:

1. **The operator grants hosted code** with `hostedCode: true`.
2. **Confinement evidence is valid** for this package version and platform.

Flipping the grant alone is not enough. If the evidence is missing, malformed,
failed, stale, or partial, `tool_mode_run` refuses with the reason.

The refusal is deliberate: a skipped confinement test never proved anything.

## When to use it

Use Code Mode when:

- one task needs several tool calls in a fixed sequence;
- intermediate values should stay inside the program;
- the sub-call trace is useful for audit or debugging.

Use ordinary tool calls when:

- one tool is enough;
- you need a human-readable intermediate result;
- the task is open-ended reasoning rather than a bounded program.

## Reading a refusal

A withheld `tool_mode_run` explains which condition is missing. The common cases
are:

- no operator grant;
- no confinement evidence configured;
- evidence for a different package version;
- evidence recorded with skipped arms.

Do not try to bypass the gate. Fix the deployment condition or use a normal tool.

## Safety limits

The runtime is mounted only when the release conditions hold. Programs run under
the host's confinement configuration, with bounded execution and a sub-call
allowlist. Tool calls still go through the same registry, grants, and receipts as
native calls.

## Next

- [Using tools in DSH](using-tools-in-dsh.md)
- [Security and permissions](security-and-permissions.md)
- [Troubleshooting](../help/troubleshooting.md)
