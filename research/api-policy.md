# SAP API Policy and custom MCP servers: what it means for a customer implementation

Written 2026-10-11, after the POC was built. Question: could a customer run a **custom MCP server like this one** (for example deployed on BTP Cloud Foundry) in production, and is it compliant with the SAP API Policy?

**Short answer:** not automatically. Neither this note nor the POC can certify compliance; only SAP can, case by case (FAQ 25). What the documents do make clear is listed below.

## Sources

| Source | What was read |
|---|---|
| SAP, *Frequently Asked Questions on SAP API Policy* (web page, saved copy) | Questions 17 to 37 read in full (AI, custom APIs, endorsed architectures) |
| SAP user group deck *SAP API Policy* (2026-05-30, PUBLIC) | Text extracted; slides on API controls, endorsed architectures and the MCP Gateway read |
| [SAP Architecture Center: Third-Party MCP Access to SAP Solutions](https://architecture.learning.sap.com/docs/ref-arch/137800) (updated 2026-06-08) | Read through an automatic summary tool; check quotes on the page before reusing them |
| The API Policy itself (v4/2026, section 2.2.2) and SAP Note 3255746 | **Not read.** Known only through the FAQ, the deck and analyst articles |

Not answered by any of these: whether a test tenant or a proof of concept is treated differently.

## What SAP says (FAQ numbers refer to the FAQ page)

1. **AI-driven access needs an endorsed route** (FAQ 34, deck "General Controls"). The policy requires SAP endorsement for AI-driven, agentic or automated access patterns. The restriction targets uncontrolled, undocumented access patterns, "not agentic AI in general" (FAQ 34).
2. **The target pattern** (FAQ 36): AI agent orchestrators running long sequences of calls against productive SAP APIs without a governance layer in between.
3. **Normal integration is not affected** (FAQ 32). Integration Suite is not mandatory; middleware or custom tools calling published APIs within the general API controls are aligned with the policy. Redesign is needed only for non-published APIs or for the section 2.2.2 cases (autonomous AI access, mass extraction).
4. **Hosting on BTP changes nothing** (FAQ 37): custom AI agents and MCP implementations on SAP BTP are subject to the policy when they access SAP APIs, wherever they run.
5. **A custom wrapper is not a way around it** (FAQ 27): custom code must not open a path for unendorsed agentic AI interactions.
6. **Endorsed routes for AI agents** (FAQ 35), described as production-validated:
   - MCP Gateway in SAP Integration Suite (authentication, authorization, rate limits, audit logging; external AI platforms can connect through it);
   - SAP-generated MCP servers in Joule Studio, described as production-ready and SAP-managed;
   - the A2A (Agent2Agent) protocol, for delegating tasks to SAP-managed agents.
7. **Risks SAP names** (FAQ 34): MCP servers with static long-lived credentials, and supply-chain attacks on SAP-ecosystem npm packages (SAP Note 3747787).
8. **Third-party MCP servers are allowed on conditions** (Architecture Center page): the API Policy is followed in full, authentication and authorization on every connection, rate limits respected, security hardening in place. The customer carries the full operational responsibility. The same page forbids passing the caller's token straight through and storing long-lived credentials in the MCP server.

## The grey zone for a custom MCP server

- **Against:** FAQ 35's explicit list of endorsed routes does not name customer-built MCP servers.
- **For:** FAQ 34 says endorsed patterns are documented in the reference architectures on the SAP Architecture Center, and "Third-Party MCP Access to SAP Solutions" is one of them (the deck lists it among SAP's agentic AI architectures).
- **Our reading (inference, not stated by SAP):** a custom MCP server that follows that reference architecture in full has a reasonable claim to being a documented, governed pattern. **This POC does not**, because it uses a stored password, one technical user for all tools, no token exchange, and logs only write calls.

## Options for a customer

| Option | Compliance | What carries over from this POC |
|---|---|---|
| A. Business tools behind the MCP Gateway in Integration Suite | Named as endorsed (FAQ 35) | The business tools, approval and audit design. How a custom MCP server sits behind the Gateway is not confirmed in these sources |
| B. Joule Studio (SAP-generated MCP servers) | Named as endorsed | The use case and the approval idea; the agent becomes Joule instead of Claude |
| C. Custom MCP server on BTP following the reference architecture in full | Grey zone: confirm with SAP | Nearly everything. BTP helps meet the security conditions (identity services, destinations with user propagation, audit logging), not the compliance question |
| D. This POC unchanged on a customer production system | Most likely falls under section 2.2.2 | – |

## Gaps to close before any customer use (option C)

| Requirement (Architecture Center page, FAQ 34) | POC today |
|---|---|
| No long-lived credentials in the MCP server | Communication user and password in a local `.env` |
| Real user's identity carried to SAP (token exchange) | SAP sees every call as the communication user; the real person is only in our audit log |
| Permissions scoped per tool | One communication user for all 8 tools |
| Every tool call logged (caller, parameters, API, status) | Only write requests are logged |
| Rate limits respected | Not enforced |
| Supply-chain hygiene for npm dependencies | Not addressed |

Kept from the POC in every option: business-level tools instead of raw APIs, human approval before every write, read-back after the change, audit trail. SAP's documents do not require human approval; it is our addition.

## What to say to a customer

> Hosting on BTP doesn't make a custom AI agent compliant; SAP's FAQ is explicit about that. AI access to SAP has to go through an endorsed route, mainly the MCP Gateway in Integration Suite. A custom MCP server can follow SAP's "Third-Party MCP Access" reference architecture, but we would confirm that design with SAP before production. Business-level tools, human approval, verify after write and audit stay the same whichever route is chosen.
