# What others have done: S/4HANA Public Cloud + MCP + AI agents

First research pass, 2026-10-11. About 8 web searches plus 3 pages read in full. A partial sample, not a complete market survey.
Legend: **read** = page opened and read; **summary** = only search-result summary, page not opened.

## 1. SAP's own route

| What | How it connects | Status / effort | Source |
|---|---|---|---|
| **MCP Gateway in SAP Integration Suite**: turn an API, HTTP endpoint or RFC destination into an MCP server, governed in API Management | Integration Suite + BTP destination (e.g. OAuth2SAMLBearer, so calls run as the signed-in user) + IAS | Needs Integration Suite. **Not available to me.** Release status not stated on the SAP page | [SAP ref. architecture: third-party MCP access](https://architecture.learning.sap.com/docs/ref-arch/137800) (read, updated 2026-06-08); [Community: Integration Suite MCP for Public Cloud API](https://community.sap.com/t5/integration-blog-posts/mcp-server-with-integration-suite-expose-s-4hana-public-cloud-api-via/ba-p/14487408) (summary, page blocked by bot check); [Community: Integration Suite MCP with Public Cloud sandbox](https://community.sap.com/t5/integration-blog-posts/sap-integration-suite-mcp-in-action-integrating-sap-s-4hana-public-cloud/ba-p/14491515) (summary) |
| **SAP-generated MCP servers for Joule Studio agents**, built from SAP's semantic API catalog | Inside Joule Studio on BTP | For Joule agents only | Same ref. architecture (read) |
| **Joule agents / assistants** in S/4HANA Cloud (e.g. accrual proposals, GR/IR items blocking the close, disputes) | Built in, Joule Premium (paid, AI units) | Counts and GA status differ between sources (40+ to 200+ agents) | [SAP Sapphire 2026 announcements](https://community.sap.com/t5/technology-blog-posts-by-sap/sap-sapphire-2026-announcements-only/ba-p/14396190) (summary); [SAP webinar: AI agents and Cloud ERP](https://www.sap.com/events/2026-09-22-online-powering-the-autonomous-enterprise-with-ai-agents-and-cloud-erp-private-americas.html) (summary); third-party guides, not authoritative |
| **ABAP MCP server** (Sapphire 2026) | Eclipse / VS Code | For ABAP *developers*, not business data | [rotecodefraktion](https://www.rotecodefraktion.de/en/blog/abap-mcp-server-agentic-ai-sapphire-2026/) (summary) |

**Key SAP warning (read):** connecting MCP directly to *raw* transactional APIs without semantic context gives "poor entity discovery accuracy, excessive token consumption" and, for writes, "a significant risk of incorrect business transactions". → Our answer: a few **purpose-built, business-named tools** (not "any OData entity"), read-mostly, and human approval for any write (the sap-basis-agent pattern).

## 2. Community and vendor MCP servers

| Project | What it does | Connection | Gaps | Source |
|---|---|---|---|---|
| HelpCode-ai/sap-mcp-server | 20 read-only S/4HANA Cloud tools (5 generic OData + 15 business: BP, sales/purchase orders, billing, deliveries, journal entries, products, PRs) | OData, OAuth 2.0 "via BTP" | **Not verified live** (own README), 0 stars, AGPL, no approval flow | [GitHub](https://github.com/HelpCode-ai/sap-mcp-server) (read) |
| HelpCode-ai/odata-to-mcp | Any OData V2/V4 service → MCP tools from `$metadata` | OData | Generic, raw-API style | [GitHub](https://github.com/HelpCode-ai/odata-to-mcp) (summary) |
| GutjahrAI/sap-odata-mcp-server | Generic SAP OData MCP server | Base URL + basic auth | Generic | [GitHub](https://github.com/GutjahrAI/sap-odata-mcp-server) (summary) |
| SAP Community: CAP Node.js MCP over S/4HANA Cloud Outbound Delivery API | One API wrapped as MCP with CAP | CAP on BTP | One API, tutorial | [Community](https://community.sap.com/t5/technology-blog-posts-by-sap/expose-s-4hana-cloud-odata-api-as-an-mcp-server-via-cap-node-js/ba-p/14451429) (summary) |
| Logali-Group/cap-mcp-s4, BrendanEgan/S-4-MCP-Example | Purchase orders / sales orders via CAP | BTP destination + Cloud Connector (on-premise) | On-premise | [cap-mcp-s4](https://github.com/Logali-Group/cap-mcp-s4), [S-4-MCP-Example](https://github.com/BrendanEgan/S-4-MCP-Example) (summary) |
| AWS SAP MCP server (Bedrock AgentCore) | 3 generic tools: odata_read / write / create | OData V2 | Not confirmed for Public Edition | [YASH blog](https://www.yash.com/blog/connecting-ai-agents-to-sap-s-4hana-via-mcp/) (summary) |
| odata-mcp-proxy (used in my ci-mcp-server) | OData → MCP from a JSON config | BTP destination, or locally env vars with **OAuth client credentials** (token URL, client ID/secret); basic auth not documented | Checked in the installed README (local copy) |

## 3. Demos close to my use cases

- **No public demo found combining S/4HANA + MCP + Claude + GR/IR or reconciliation.** That's a gap we can fill.
- SAP's own GR/IR angle: a Joule financial-closing assistant that resolves GR/IR items blocking the period close (webinar 2026-09-22, summary only).
- Claude for month-end close, but not SAP: Kognitos (Claude + MCP, reconciliation, variance analysis, exception routing), ChatFin (Claude + MCP for SAP **Business One**). Summary only: [Kognitos webinar](https://www.kognitos.com/webinars/how-to-use-claude-for-month-end-close/), [ChatFin B1](https://chatfin.ai/blog/sap-business-one-mcp-integration-connect-claude-ai-to-sap-b1/).
- Practitioner caution: agents fail when PO and GR data is not clean, so a demo needs prepared data. [procindex](https://procindex.com/blog/ai-agents-sap-ap-matching) (summary).
- GR/IR background: [SAP Community guide to GR/IR clearing](https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-sap/mastering-goods-receipt-invoice-receipt-account-clearing-in-sap-a-complete/ba-p/14320890) (summary).

## 4. What this means for us (first take, to discuss)

1. **Without Integration Suite, the simple path is direct:** our own MCP server (Node, like sap-basis-agent) → tenant OData APIs through a **communication arrangement + communication user**. No BTP in between. (General knowledge, to verify on the tenant: Public Cloud communication users support basic auth, and OAuth for some scenarios.)
2. **Differentiation, consistent with what we found:**
   - business-named tools instead of a raw OData proxy (SAP's own warning);
   - "AI proposes, human decides" for any write;
   - verify after write and an audit log;
   - **live-verified on a real Public Cloud tenant**, which the closest GitHub project hasn't done.
3. Open: which communication scenarios / APIs the tenant has active for the chosen use case (check on the tenant: Communication Arrangements app).
