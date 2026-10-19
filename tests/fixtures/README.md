# Test fixtures

| Path | Origin | License |
| --- | --- | --- |
| `repos/acme-support/` | `agent-reliability-analyzer/testdata/deterministic-fixture` (trustabl/agent-reliability-analyzer) | Apache-2.0 |
| `repos/research-tools/` | `agent-network-access-probe/demo/{research-assistant,refund-tool}` (trustabl/agent-network-access-probe) | Apache-2.0 |
| `cli/` | Real output of `trustabl` 0.1.14 and `autofix` 0.2.2 run on the repos above (see `cli/README.md`) | Apache-2.0 |

The repos are inputs only. Nothing here is executed by the Console except by
the pinned CLIs during tests.
