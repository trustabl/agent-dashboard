---
name: trustabl-pre-coding
description: >-
  Pre-coding reliability constraints, used for writing and reviewing agent definitions with: openai_sdk
allowed-tools: Read
disable-model-invocation: false
---

# Trustabl Pre-Coding Reliability Constraints

<!-- generated: 2026-10-19 | rules: f57df3f914d3a14dbf6a254b68a2292a5804d798 | schema: 23 | sdks: openai_sdk | template: 3 -->

Before writing any agent code, apply every constraint below. Rules are
ordered by severity. A violation here will fire the corresponding finding
in post-build scan — prevent it now.

## How to Apply These Constraints

Work against this document; do not assume a definition is correct because it
looks right. After writing or changing any tool, agent, subagent, or skill
definition, run this loop before moving on.

1. CHECK YOUR WORK
   Re-read the definition you just wrote against every constraint in this
   document whose "When this applies" matches it. Check explicitly — do not
   assume the constraint was satisfied.

2. NAME THE VIOLATION
   State the specific rule ID, not "this looks wrong". "CSDK-005 — this tool
   raises without a structured error contract" is actionable; "error handling
   needs work" is not. If nothing matches, the definition passes; move on.

3. MATCH THE REPAIR TO THE VIOLATION
   Apply that rule's own Directive. Where the repair goes is set by scope,
   and how to proceed is set by severity:

     tool   → change the tool definition
     agent  → change the agent constructor call
     repo   → change project configuration, not code

     critical / high  → make the change, then state which rule required it
     medium / low     → apply the directive directly

   If the Directive cannot be applied as written — it conflicts with another
   constraint here, or the fix is outside the file you are editing — stop and
   say so rather than approximating it.

4. KEEP A TRAIL
   Note the rule ID and the change that cleared it. Do not reintroduce a
   pattern you already repaired in this session, and do not re-apply a repair
   that did not clear the violation — report it instead.

Scope: this loop applies to agent, tool, subagent, and skill definitions —
the surfaces the constraints below govern. It is not a general code-review
procedure.

## Runtime Tracing

This section makes the agent observable at run time. It has two layers: the
agent emits OpenTelemetry spans (Step 1), and `agent-reliability-otel-labels`
adds labels to those spans (Step 2). `agent-reliability-otel-labels` never
creates a span, so Step 1 comes first. Work through the steps in order once the
agent and its tools pass the loop above.

### Step 1 — Emit spans (OpenTelemetry)

Before adding anything, look for tracing that is already set up in this repo.
If a tracer provider is already created, reuse it; never create a second one.
Still turn on the framework's instrumentation below if it is not on yet, and
run the confirm step either way.

Each language block below is followed by framework sections where a verified
setup exists. For a framework with no section, turn on its own OpenTelemetry
instrumentation, or add an OpenTelemetry-based instrumentor for it, then run
the confirm step.

#### Python

Install: `pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http`

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)
tracer = provider.get_tracer("agent")
```

Create the provider once, at startup. For production traffic, use the SDK's
batching span processor in place of the simple one.

##### OpenAI Agents SDK

Install: `pip install openinference-instrumentation-openai-agents`

```python
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

OpenAIAgentsInstrumentor().instrument(tracer_provider=provider)
```

#### Confirm

Before Step 2, run the agent once and check that it emits one tool span per
tool call, usually under an agent span. How to recognise them depends on the
instrumentation:

- `gen_ai` conventions (Google ADK, Pydantic AI, Vercel AI SDK, OpenLLMetry
  for LangChain): spans named `invoke_agent` and `execute_tool`, with
  `gen_ai.operation.name` set to match.
- OpenInference instrumentors (OpenAI Agents SDK, LangChain, CrewAI, AutoGen):
  `openinference.span.kind` is `AGENT` or `TOOL`, and the span is named after
  the agent or the tool.
- OpenLLMetry's MCP instrumentor: `traceloop.span.kind` is `tool`, with no
  agent span.

If no tool spans appear, fix that first; the labels in Step 2 have nothing to
attach to. To send spans to a collector, set `OTEL_EXPORTER_OTLP_ENDPOINT`;
the exporter reads it from the environment.

### Step 2 — Add the Trustabl labels (agent-reliability-otel-labels)

| Span | Labels |
|---|---|
| The agent's root span (`invoke_agent`, or the instrumentor's agent span) | `trustabl.run_id`, `trustabl.exit_reason`, one `trustabl.policy.binding` event per policy |
| Each tool span (`execute_tool`, or a span whose kind is tool) | `trustabl.tool.input_fp`, `trustabl.tool.output_fp`, `trustabl.tool.attempt`, `trustabl.tool.side_effect`, `trustabl.tool.error_class`, `trustabl.step_index`, `trustabl.run_id` |
| A delegated agent's span | `trustabl.handoff_id` |

Arguments and results are fingerprinted, never copied onto the span.

Policy bindings: call the bind-authority function only for a signed policy
that really exists in the deployment. Never invent an id, a version or a
sha256. With no policies, leave the call out.

If the framework's own agent span cannot be reached where the run starts, wrap
the run in a root span the application creates, and set
`gen_ai.operation.name` to `invoke_agent` and `gen_ai.agent.name` on it.

#### Python

Install: `pip install agent-reliability-otel-labels`

```python
import warnings

from opentelemetry import trace
from agent_reliability_otel_labels import Run, canonical_fp, mark_run_end, mark_tool_span


def run_agent(prompt):
    run = Run()        # one per run, never shared between runs
    attempts = {}      # calls so far in this run, per arguments fingerprint

    def search_flights(args: dict) -> dict:
        """Search flights between two airports on a date."""
        try:
            key = canonical_fp(args)
        except Exception:
            key = "search_flights (no fingerprint)"
        attempts[key] = attempts.get(key, 0) + 1
        step = run.next_step()
        span = trace.get_current_span()   # the framework's tool span
        result = None
        try:
            result = find_flights(args)
            return result
        finally:
            try:
                mark_tool_span(span, args=args, result=result,
                               attempt=attempts[key], side_effect="read",
                               step_index=step, run_id=run.run_id)
            except ValueError as err:
                warnings.warn(f"trustabl: could not label the tool span: {err}")

    with tracer.start_as_current_span("invoke_agent travel-booker") as root:
        root.set_attribute("gen_ai.operation.name", "invoke_agent")
        root.set_attribute("gen_ai.agent.name", "travel-booker")
        run.mark_start(root)
        try:
            answer = call_the_agent(prompt, tools=[search_flights])
            mark_run_end(root, exit_reason="final_answer")
            return answer
        except Exception:
            mark_run_end(root, exit_reason="error")
            raise
```

When the failure class is known, also pass `error_class`, for example
`error_class="timeout"`. For a delegated agent, call
`mark_handoff(span, handoff_id=...)` on the child agent's span. For signed
policies, call `bind_authority(root, bindings=[Binding(...)])` right after
`run.mark_start(root)`.

### Step 3 — Choose the values

- `trustabl.tool.attempt`: how many times this run has made the same call.
  Keep a count per run, keyed by the arguments fingerprint. Different
  arguments start again at 1.
- `trustabl.tool.side_effect`: one of `pure`, `read`, `write`, `irreversible`.
  `pure` means no I/O and the same input gives the same output. `read` means
  it reads outside state and changes nothing. `write` means it changes outside
  state in a way that can be undone. `irreversible` means it cannot be undone,
  such as a send, a payment or a delete. Leave it out when the class is not
  known; `pure` is a claim, not a default.
- `trustabl.tool.error_class`: one of `timeout`, `4xx`, `5xx`, `empty`, `schema`, `auth`.
  Set it only when the failure class is known. Leave it out rather than guess.
- `trustabl.exit_reason`: one of `final_answer`, `max_steps`, `policy_stop`, `error`.
  Use `error` when the run raised, `max_steps` when a step cap stopped a run
  that still wanted tools, `policy_stop` when a policy halted it, and
  `final_answer` otherwise.

### Step 4 — Check before moving on

- The labels are on the framework's own spans. Export one run and look for
  `trustabl.tool.input_fp` on each tool span. With no current span, each call
  is a silent no-op.
- No tool label, such as `trustabl.tool.input_fp`, appears on the root span or
  on any span that is not a tool span. If one does, the tool's span was not
  current inside the tool: say so, and do not create a span to hold the labels.
- A tool that fails is still labelled: label in a `finally` block or a `defer`.
- A labelling error never fails the tool: catch it, report it, and return the
  tool's own result.
- The run's end is marked before the root span ends; an ended span drops it.
- No argument or result text appears in any `trustabl.*` value. The
  framework's own content capture is a separate setting.

Python:

- Create one `Run` per run. Never share one between concurrent runs.

---

## OpenAI Agents SDK agent wiring safety

### Tool Rules

---

#### [OAI-005] Network call has no timeout
**Severity:** high | **Confidence:** 0.85

**Directive:** Pass timeout= (typically 5-30 seconds depending on the endpoint).

**Why:** An OpenAI Agents SDK tool that makes a network request without a timeout can hang indefinitely, blocking the agent's run loop and consuming the conversation's wall-clock budget.

**When this applies:** When defining a tool.

---

#### [OAI-006] Tool accepts path without normalization
**Severity:** high | **Confidence:** 0.70

**Directive:** Normalize the path before use: p = Path(file_path).resolve().

**Why:** The tool accepts a path-like parameter and flows it into a filesystem call (open, Path(...), shutil.*, os.*) without calling .resolve() or os.path.realpath() on it first.

**When this applies:** When defining a tool.

---

#### [OAI-011] urllib network call has no timeout
**Severity:** high | **Confidence:** 0.85

**Directive:** Pass timeout= (typically 5-30 seconds depending on the endpoint) to every urllib.request.urlopen call.

**Why:** An OpenAI Agents SDK tool that calls urllib.request.urlopen without timeout= can hang on a slow or unresponsive host.

**When this applies:** When defining a tool.

---

#### [OAI-012] Tool body spawns a subprocess
**Severity:** high | **Confidence:** 0.90

**Directive:** Replace process spawn with a typed library API where possible (e.g.

**Why:** The @function_tool body spawns an OS process.

**When this applies:** When defining a tool.

---

#### [OAI-013] Tool body calls eval/exec/compile on dynamic input
**Severity:** high | **Confidence:** 0.90

**Directive:** Remove eval/exec/compile from the tool.

**Why:** The @function_tool body invokes Python's eval, exec, or compile.

**When this applies:** When defining a tool.

---

#### [OAI-014] Privileged tool has no needs_approval gate
**Severity:** high | **Confidence:** 0.70

**Directive:** Pass needs_approval=True to the @function_tool decorator for tools that execute commands, run code, or mutate the filesystem, and handle the resulting approval items in your run loop.

**Why:** This @function_tool shells out, executes dynamic code, or writes the filesystem, but has no needs_approval gate — the kwarg is absent or explicitly set to False.

**When this applies:** When defining a tool.

---

#### [OAI-015] Tool sets failure_error_function=None
**Severity:** high | **Confidence:** 0.85

**Directive:** Remove failure_error_function=None, or replace it with a function that returns a structured error string the model can react to.

**Why:** Passing failure_error_function=None to @function_tool is the opposite of the default: instead of surfacing a structured error to the model, the SDK re-raises the exception, which aborts the entire agent run.

**When this applies:** When defining a tool.

---

#### [OAI-030] Side-effecting tool lets the model choose the recipient or amount with no visible bound
**Severity:** high | **Confidence:** 0.50

**Directive:** Do not let the model supply the recipient or the amount unconstrained.

**Why:** This @function_tool's name signals a send/notify or a refund/charge/pay side effect, and it takes a free-form recipient or amount parameter with no visible bound: no allow-list constraining who the message reaches, no cap, range, or enum constraining how much money moves, and no needs_approval gate.

**When this applies:** When defining a tool.

---

#### [OAI-002] Tool function has no type-annotated parameters
**Severity:** medium | **Confidence:** 0.85

**Directive:** Add type hints to every parameter (def fetch(url: str, timeout: int = 10) -> dict).

**Why:** The OpenAI Agents SDK auto-generates a JSON schema for the tool from Python type annotations.

**When this applies:** When defining a tool.

---

#### [OAI-003] Tool sets strict_mode=False
**Severity:** medium | **Confidence:** 0.95

**Directive:** Remove the strict_mode=False kwarg (the default True is the safe setting).

**Why:** Setting strict_mode=False on @function_tool relaxes JSON-schema enforcement at runtime.

**When this applies:** When defining a tool.

---

#### [OAI-009] Mutating tool has no idempotency key
**Severity:** medium | **Confidence:** 0.55

**Directive:** Add an `idempotency_key: str` parameter and pass it to the backing API.

**Why:** Tool name suggests a side effect (create/send/refund/…).

**When this applies:** When defining a tool.

---

#### [OAI-018] Tool builds outbound URL from non-literal value
**Severity:** medium | **Confidence:** 0.55

**Directive:** Treat the model-supplied value as untrusted input to URL construction.

**Why:** An OpenAI Agents SDK tool builds its outbound HTTP URL from a non-literal value — typically a tool parameter interpolated into an f-string or concatenated onto a base URL.

**When this applies:** When defining a tool.

---

#### [OAI-032] OpenAI Agents SDK tool fetches an allow-listed host without pinning https://
**Severity:** medium | **Confidence:** 0.60

**Directive:** Pin the scheme: build the URL from a literal "https://" prefix, or reject any URL whose urlparse(url).scheme is not "https" before the request.

**Why:** This OpenAI Agents SDK tool checks the destination host against an allow-list (so OAI-018 stays silent) but builds its outbound request URL without a literal https:// prefix and without checking the URL scheme.

**When this applies:** When defining a tool.

---

#### [OAI-001] Tool function has no docstring
**Severity:** low | **Confidence:** 0.90

**Directive:** Add a one-line docstring describing what this tool does and when the model should call it.

**Why:** The OpenAI Agents SDK uses the @function_tool's docstring as the description sent to the model when it decides whether to call this tool.

**When this applies:** When defining a tool.

---

#### [OAI-004] Tool has no failure_error_function
**Severity:** low | **Confidence:** 0.70

**Directive:** Pass failure_error_function= to the decorator.

**Why:** When a tool raises an exception, the OpenAI Agents SDK surfaces the exception's string representation to the model by default.

**When this applies:** When defining a tool.

---

#### [OAI-007] Ambiguous tool name
**Severity:** low | **Confidence:** 0.90

**Directive:** Rename to a verb-object form, e.g.

**Why:** Tool names like `process`, `handle`, or `run` give the model no signal about intent.

**When this applies:** When defining a tool.

---

#### [OAI-008] Tool raises exceptions without a structured error contract
**Severity:** low | **Confidence:** 0.60

**Directive:** Catch known failure modes and return a structured payload such as `{"error": "...", "retryable": False}` instead of raising.

**Why:** When a @function_tool raises, the SDK surfaces the exception to the model as an opaque string.

**When this applies:** When defining a tool.

---

#### [OAI-010] Tool function prints to stdout for diagnostics
**Severity:** low | **Confidence:** 0.65

**Directive:** Remove the print() calls.

**Why:** The @function_tool body calls print(), which writes diagnostics to the process's stdout.

**When this applies:** When defining a tool.

---

#### [OAI-025] Tool description is a placeholder
**Severity:** low | **Confidence:** 0.85

**Directive:** Replace the placeholder with a real description covering what the tool does, what it returns, and when the model should call it rather than a neighboring tool.

**Why:** The docstring passes the OAI-001 has-a-description check but carries a placeholder marker instead of real content.

**When this applies:** When defining a tool.

---

#### [OAI-026] Tool description is too short to guide model selection
**Severity:** low | **Confidence:** 0.80

**Directive:** Expand the description to at least a full sentence covering inputs, outputs, and the situation in which this tool should be used over the alternatives.

**Why:** A description under 40 characters is rarely enough to convey what a tool does, what it returns, and when to call it rather than a similarly named neighbor.

**When this applies:** When defining a tool.

### Agent Rules

---

#### [OAI-101] Agent has no input_guardrails AND wires shell or filesystem-touching tools
**Severity:** high | **Confidence:** 0.85

**Directive:** Add at least one @input_guardrail validating that the user input is safe to dispatch to shell tools, and wire it via input_guardrails=[...] on the Agent(...) constructor.

**Why:** This agent is wired with tools that execute shell commands or touch the filesystem, but has no input_guardrails configured.

**When this applies:** When declaring an agent.

---

#### [OAI-102] Agent uses tool_use_behavior="stop_on_first_tool"
**Severity:** high | **Confidence:** 0.95

**Directive:** Remove the tool_use_behavior="stop_on_first_tool" kwarg (the default "run_llm_again" is safe) or constrain it via StopAtTools(...) listing only tools whose outputs you control.

**Why:** With tool_use_behavior="stop_on_first_tool", the first tool's raw output becomes the agent's final response without any model post-processing.

**When this applies:** When declaring an agent.

---

#### [OAI-103] tool_choice="required" combined with reset_tool_choice=False
**Severity:** high | **Confidence:** 0.95

**Directive:** Either drop reset_tool_choice=False (the default True breaks the loop) or change tool_choice to "auto".

**Why:** The agent forces tool use on every turn (tool_choice="required") AND does not reset the tool choice after each call (reset_tool_choice=False).

**When this applies:** When declaring an agent.

---

#### [OAI-106] Agent wires MCP servers without input_guardrails
**Severity:** high | **Confidence:** 0.90

**Directive:** Add at least one @input_guardrail that inspects the user's input AND the resolved tool list before the model is invoked.

**Why:** The agent imports tools from one or more MCP servers (mcp_servers=) but has no input_guardrails.

**When this applies:** When declaring an agent.

---

#### [OAI-109] Agent uses WebSearchTool without input_guardrails
**Severity:** high | **Confidence:** 0.85

**Directive:** Add at least one @input_guardrail that validates user queries before they reach WebSearchTool.

**Why:** This agent is wired with WebSearchTool, which fetches content from the public internet, but has no input_guardrails configured.

**When this applies:** When declaring an agent.

---

#### [OAI-111] Agent wires a privileged hosted tool without needs_approval
**Severity:** high | **Confidence:** 0.75

**Directive:** Construct the privileged tool with needs_approval=True and handle the resulting approval items in your run loop, or wrap the agent with input_guardrails that screen what can reach it.

**Why:** This agent wires a privileged hosted tool — ShellTool or LocalShellTool (run shell commands), CodeInterpreterTool (run code), or ApplyPatchTool (edit files) — with no needs_approval gate: the kwarg is absent or explicitly False.

**When this applies:** When declaring an agent.

---

#### [OAI-115] Agent wires a HostedMCPTool with no allowed_tools allow-list
**Severity:** high | **Confidence:** 0.70

**Directive:** Add allowed_tools to the tool_config dict, naming the specific tools this agent is allowed to call, e.g.

**Why:** This agent wires a HostedMCPTool whose tool_config names a hosted MCP server but sets no allowed_tools.

**When this applies:** When declaring an agent.

---

#### [OAI-118] Agent wires an MCP server with no tool_filter allow-list
**Severity:** high | **Confidence:** 0.75

**Directive:** Pass tool_filter=create_static_tool_filter(allowed_tool_names=[...]) to the MCP server constructor, naming the specific tool names this agent is allowed to call, e.g.

**Why:** This agent wires an MCP server (MCPServerStdio, MCPServerSse, or MCPServerStreamableHttp) with no tool_filter.

**When this applies:** When declaring an agent.

---

#### [OAI-104] Raw Agent (not SandboxAgent) wires shell or filesystem-touching tools
**Severity:** medium | **Confidence:** 0.75

**Directive:** Switch from Agent(...) to SandboxAgent(...) and define a Manifest restricting the file paths and commands the agent can reach.

**Why:** This agent uses the plain Agent class with tools that touch the shell or filesystem.

**When this applies:** When declaring an agent.

---

#### [OAI-110] Agent wires a content-fetching tool without output_guardrails
**Severity:** medium | **Confidence:** 0.60

**Directive:** Add at least one output guardrail (a function decorated @output_guardrail or an OutputGuardrail instance) and wire it via output_guardrails=[...] on the Agent(...) constructor.

**Why:** This agent pulls in untrusted external content (web search, file search, or a code interpreter) but has no output_guardrails.

**When this applies:** When declaring an agent.

---

#### [OAI-112] OpenAI Agents SDK agent has no explicit max_turns limit
**Severity:** low | **Confidence:** 0.60

**Directive:** Pass max_turns= to Runner.run(...) (or run_sync/run_streamed), sized to the work this agent actually does — a handful of turns for a single-lookup agent, more for a multi-step task.

**Why:** No Runner.run/run_sync/run_streamed call that executes this agent sets max_turns, so the loop runs to whatever ceiling the SDK's DEFAULT_MAX_TURNS applies rather than to a bound sized for this task.

**When this applies:** When declaring an agent.

---

#### [OAI-120] OpenAI Agents SDK run call has no wall-clock timeout
**Severity:** low | **Confidence:** 0.55

**Directive:** Wrap the call: await asyncio.wait_for(Runner.run(agent, input, max_turns=...), timeout=...) or run it inside async with asyncio.timeout(...): sized to the task.

**Why:** No Runner.run/run_sync/run_streamed call that executes this agent is wrapped in a wall-clock timeout (asyncio.wait_for, asyncio.timeout, or anyio.move_on_after / fail_after).

**When this applies:** When declaring an agent.

### Repo Rules

---

#### [OAI-201] Project uses default OpenAI tracing
**Severity:** medium | **Confidence:** 0.80

**Directive:** Either disable tracing entirely (set OPENAI_AGENTS_DISABLE_TRACING=1 in the environment) OR register a custom trace processor via agents.tracing.add_trace_processor(...) that redacts sensitive fields before they leave the process.

**Why:** The project uses the OpenAI Agents SDK with default tracing enabled.

**When this applies:** For any repo using this SDK.

---

#### [OAI-202] OpenAI Agents project ships no agent-guidance doc (AGENTS.md/CLAUDE.md)
**Severity:** low | **Confidence:** 0.90

**Directive:** Add an AGENTS.md at the repo root (the cross-vendor standard; a CLAUDE.md also satisfies this rule).

**Why:** The project uses the OpenAI Agents SDK in code but ships no agent-guidance doc (AGENTS.md or CLAUDE.md) at the repo root.

**When this applies:** For any repo using this SDK.

---

#### [OAI-203] OpenAI Agents SDK project wires no observability
**Severity:** low | **Confidence:** 0.75

**Directive:** Wire a trace backend.

**Why:** This project runs OpenAI Agents SDK agents but wires no observability backend: no OpenTelemetry provider, no Langfuse, Logfire, Phoenix, Braintrust, Weave, or AgentOps instrumentation appears anywhere in the parsed source.

**When this applies:** For any repo using this SDK.

